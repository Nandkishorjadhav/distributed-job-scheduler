import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import { WorkerRepository, ProjectRepository, getPool } from '@job-scheduler/backend-shared';
import { OrgRole, WorkerStatus } from '@job-scheduler/shared';

let workerRepo: WorkerRepository;
let projectRepo: ProjectRepository;

function getWorkerRepository(): WorkerRepository {
  if (!workerRepo) workerRepo = new WorkerRepository(getPool());
  return workerRepo;
}

function getProjectRepository(): ProjectRepository {
  if (!projectRepo) projectRepo = new ProjectRepository(getPool());
  return projectRepo;
}

/**
 * Verify user has minimum role on target organization.
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
 * GET /api/v1/workers — List all workers with calculated health status and pagination.
 */
export async function listWorkers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { page, pageSize, projectId, status } = req.query as {
      page?: string;
      pageSize?: string;
      projectId?: string;
      status?: string;
    };

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    const repo = getWorkerRepository();
    const result = await repo.list({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      projectId,
      status,
      userId: req.user.id,
      heartbeatTimeoutSeconds: 30,
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
 * GET /api/v1/workers/:workerId — Get single worker details with running jobs and heartbeats.
 */
export async function getWorker(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { workerId } = req.params;
    const repo = getWorkerRepository();
    const worker = await repo.findById(workerId, 30);

    if (!worker) {
      throw new AppError(404, 'Worker not found', 'WORKER_NOT_FOUND');
    }

    const proj = await getProjectRepository().findById(worker.projectId);
    if (!proj) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);

    const [recentHeartbeats, runningJobs] = await Promise.all([
      repo.getRecentHeartbeats(workerId, 20),
      repo.getRunningJobs(workerId),
    ]);

    res.status(200).json({
      success: true,
      data: {
        worker,
        runningJobs,
        recentHeartbeats,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/workers/register — Register a new worker process.
 */
export async function registerWorker(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId, hostname, pid, ipAddress, version, maxConcurrency } = req.body;

    const proj = await getProjectRepository().findById(projectId);
    if (!proj) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);

    const repo = getWorkerRepository();
    const worker = await repo.register({
      projectId,
      hostname,
      pid,
      ipAddress,
      version,
      maxConcurrency,
    });

    res.status(201).json({
      success: true,
      message: 'Worker registered successfully',
      data: { worker },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/workers/:workerId/heartbeat — Submit heartbeat update from worker.
 */
export async function sendWorkerHeartbeat(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { workerId } = req.params;
    const { currentJobCount, metadata, status } = req.body;

    const repo = getWorkerRepository();
    const worker = await repo.findById(workerId);
    if (!worker) {
      throw new AppError(404, 'Worker not found', 'WORKER_NOT_FOUND');
    }

    const proj = await getProjectRepository().findById(worker.projectId);
    if (!proj) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);

    const updated = await repo.heartbeat(workerId, {
      currentJobCount,
      metadata,
      status,
    });

    res.status(200).json({
      success: true,
      message: 'Heartbeat recorded',
      data: { worker: updated },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/workers/:workerId/stop — Mark worker as stopped.
 */
export async function stopWorker(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { workerId } = req.params;
    const repo = getWorkerRepository();
    const worker = await repo.findById(workerId);
    if (!worker) {
      throw new AppError(404, 'Worker not found', 'WORKER_NOT_FOUND');
    }

    const proj = await getProjectRepository().findById(worker.projectId);
    if (!proj) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);

    await repo.deregister(workerId);

    res.status(200).json({
      success: true,
      message: 'Worker marked as stopped',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/workers/stale/scan — Scan and detect stale workers whose heartbeat has expired.
 */
export async function scanStaleWorkers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const timeoutSeconds = req.query.timeoutSeconds
      ? parseInt(req.query.timeoutSeconds as string, 10)
      : 30;
    const projectId = req.query.projectId as string | undefined;

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.MEMBER);
    }

    const repo = getWorkerRepository();
    const staleWorkers = await repo.markStaleWorkers(timeoutSeconds, req.user.id, projectId);

    res.status(200).json({
      success: true,
      message: `Detected and marked ${staleWorkers.length} stale workers as unhealthy`,
      data: {
        staleWorkers,
        count: staleWorkers.length,
      },
    });
  } catch (err) {
    next(err);
  }
}
