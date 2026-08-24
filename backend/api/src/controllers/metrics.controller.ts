import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import {
  MetricsRepository,
  ProjectRepository,
  QueueRepository,
  getPool,
} from '@job-scheduler/backend-shared';
import { OrgRole } from '@job-scheduler/shared';

let metricsRepo: MetricsRepository;
let projectRepo: ProjectRepository;
let queueRepo: QueueRepository;

function getMetricsRepository(): MetricsRepository {
  if (!metricsRepo) metricsRepo = new MetricsRepository(getPool());
  return metricsRepo;
}

function getProjectRepository(): ProjectRepository {
  if (!projectRepo) projectRepo = new ProjectRepository(getPool());
  return projectRepo;
}

function getQueueRepository(): QueueRepository {
  if (!queueRepo) queueRepo = new QueueRepository(getPool());
  return queueRepo;
}

/**
 * Check user org role permission.
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
 * GET /api/v1/metrics — Retrieve aggregate system or project metrics.
 */
export async function getSystemMetrics(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId, queueId } = req.query as {
      projectId?: string;
      queueId?: string;
    };

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    if (queueId) {
      const q = await getQueueRepository().findById(queueId);
      if (!q) {
        throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
      }
      const proj = await getProjectRepository().findById(q.projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    const repo = getMetricsRepository();
    const metrics = await repo.getSystemMetrics({ projectId, queueId });

    res.status(200).json({
      success: true,
      data: metrics,
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/metrics/queues/:queueId — Retrieve queue-specific metrics.
 */
export async function getQueueMetrics(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const q = await getQueueRepository().findById(queueId);
    if (!q) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const proj = await getProjectRepository().findById(q.projectId);
    if (!proj) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);

    const repo = getMetricsRepository();
    const metrics = await repo.getSystemMetrics({ queueId });

    res.status(200).json({
      success: true,
      data: metrics,
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/metrics/prometheus — Export metrics in Prometheus exposition text format.
 */
export async function getPrometheusMetrics(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId } = req.query as { projectId?: string };

    if (projectId) {
      const proj = await getProjectRepository().findById(projectId);
      if (!proj) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, proj.organizationId, OrgRole.VIEWER);
    }

    const repo = getMetricsRepository();
    const prometheusText = await repo.getPrometheusMetrics({ projectId });

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(prometheusText);
  } catch (err) {
    next(err);
  }
}
