import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import {
  DeadLetterJobRepository,
  JobRepository,
  ProjectRepository,
  getPool,
} from '@job-scheduler/backend-shared';
import { OrgRole, DLQStatus } from '@job-scheduler/shared';

let dlqRepo: DeadLetterJobRepository;
let jobRepo: JobRepository;
let projectRepo: ProjectRepository;

function getDlqRepository(): DeadLetterJobRepository {
  if (!dlqRepo) dlqRepo = new DeadLetterJobRepository(getPool());
  return dlqRepo;
}

function getJobRepository(): JobRepository {
  if (!jobRepo) jobRepo = new JobRepository(getPool());
  return jobRepo;
}

function getProjectRepository(): ProjectRepository {
  if (!projectRepo) projectRepo = new ProjectRepository(getPool());
  return projectRepo;
}

/**
 * Check if the authenticated user has sufficient role on the organization.
 */
async function checkOrgPermission(
  userId: string,
  organizationId: string,
  minRole: OrgRole = OrgRole.VIEWER
): Promise<void> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  );

  if (res.rows.length === 0) {
    throw new AppError(403, 'You do not have access to this resource', 'FORBIDDEN');
  }

  const roleHierarchy: Record<OrgRole, number> = {
    [OrgRole.VIEWER]: 1,
    [OrgRole.MEMBER]: 2,
    [OrgRole.ADMIN]: 3,
    [OrgRole.OWNER]: 4,
  };

  const userRole = res.rows[0].role as OrgRole;
  if (roleHierarchy[userRole] < roleHierarchy[minRole]) {
    throw new AppError(403, `Requires ${minRole} permissions or higher`, 'FORBIDDEN');
  }
}

/**
 * Verify queue access for authenticated user.
 */
async function verifyQueueAccess(
  userId: string,
  queueId: string,
  minRole: OrgRole = OrgRole.VIEWER
): Promise<void> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT q.project_id, p.organization_id
     FROM queues q
     JOIN projects p ON p.id = q.project_id
     WHERE q.id = $1`,
    [queueId]
  );
  if (res.rows.length === 0) {
    throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
  }
  await checkOrgPermission(userId, res.rows[0].organization_id, minRole);
}

/**
 * GET /api/v1/dlq — List DLQ jobs with filtering and pagination.
 */
export async function listDlqJobs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { page, pageSize, queueId, projectId, status, search } = req.query as {
      page?: string;
      pageSize?: string;
      queueId?: string;
      projectId?: string;
      status?: DLQStatus;
      search?: string;
    };

    const targetQueueId = (req.params.queueId as string) || queueId;
    if (targetQueueId) {
      await verifyQueueAccess(req.user.id, targetQueueId, OrgRole.VIEWER);
    }

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    const repo = getDlqRepository();

    const result = await repo.list({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      queueId: targetQueueId,
      projectId,
      status,
      search,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/dlq/stats — Get dashboard-ready DLQ statistics.
 */
export async function getDlqStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId, projectId } = req.query as {
      queueId?: string;
      projectId?: string;
    };

    const targetQueueId = (req.params.queueId as string) || queueId;
    if (targetQueueId) {
      await verifyQueueAccess(req.user.id, targetQueueId, OrgRole.VIEWER);
    }

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    const repo = getDlqRepository();

    const stats = await repo.getStats({
      queueId: targetQueueId,
      projectId,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/dlq/:dlqId — Inspect a single DLQ job with executions and logs.
 */
export async function getDlqJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { dlqId } = req.params;
    const repo = getDlqRepository();
    const dlq = await repo.findById(dlqId);

    if (!dlq) {
      throw new AppError(404, 'Dead Letter Queue record not found', 'DLQ_RECORD_NOT_FOUND');
    }

    // Verify project permission
    if (dlq.projectId) {
      const proj = await getProjectRepository().findById(dlq.projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    // Fetch full execution history and logs for inspection
    const jobService = getJobRepository();
    const [executions, logs] = await Promise.all([
      jobService.getExecutionHistory(dlq.jobId),
      jobService.getJobLogs(dlq.jobId),
    ]);

    res.status(200).json({
      success: true,
      data: {
        dlq,
        executions,
        logs,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/dlq/:dlqId/retry — Re-queue a DLQ job back to pending state.
 */
export async function requeueDlqJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { dlqId } = req.params;
    const repo = getDlqRepository();
    const dlq = await repo.findById(dlqId);

    if (!dlq) {
      throw new AppError(404, 'Dead Letter Queue record not found', 'DLQ_RECORD_NOT_FOUND');
    }

    if (dlq.projectId) {
      const proj = await getProjectRepository().findById(dlq.projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);
    }

    const result = await repo.requeue(dlqId, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Job re-queued successfully from Dead Letter Queue',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/dlq/:dlqId/archive — Archive a DLQ job.
 */
export async function archiveDlqJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { dlqId } = req.params;
    const repo = getDlqRepository();
    const dlq = await repo.findById(dlqId);

    if (!dlq) {
      throw new AppError(404, 'Dead Letter Queue record not found', 'DLQ_RECORD_NOT_FOUND');
    }

    if (dlq.projectId) {
      const proj = await getProjectRepository().findById(dlq.projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);
    }

    const updated = await repo.archive(dlqId, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Dead Letter Queue record archived',
      data: { dlq: updated },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/dlq/:dlqId — Delete a DLQ job.
 */
export async function deleteDlqJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { dlqId } = req.params;
    const repo = getDlqRepository();
    const dlq = await repo.findById(dlqId);

    if (!dlq) {
      throw new AppError(404, 'Dead Letter Queue record not found', 'DLQ_RECORD_NOT_FOUND');
    }

    if (dlq.projectId) {
      const proj = await getProjectRepository().findById(dlq.projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.ADMIN);
    }

    await repo.delete(dlqId);

    res.status(200).json({
      success: true,
      message: 'Dead Letter Queue record permanently deleted',
    });
  } catch (err) {
    next(err);
  }
}
