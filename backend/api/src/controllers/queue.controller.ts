import { Response, NextFunction } from 'express';
import {
  OrgRole,
  CreateQueueInput,
  UpdateQueueInput,
  QueueQueryInput,
} from '@job-scheduler/shared';
import { QueueRepository, ProjectRepository, getPool } from '@job-scheduler/backend-shared';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { checkOrgPermission } from '../middleware/authorization';
import { AppError } from '../middleware/errorHandler';

const getQueueRepository = () => new QueueRepository(getPool());
const getProjectRepository = () => new ProjectRepository(getPool());

export async function createQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId, name, description, priority, concurrencyLimit, retryPolicy, dlqEnabled } =
      req.body as CreateQueueInput;

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(projectId);

    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    const queueRepo = getQueueRepository();
    const existingQueue = await queueRepo.findByProjectAndName(projectId, name);

    if (existingQueue) {
      throw new AppError(
        409,
        'A queue with this name already exists in this project',
        'QUEUE_NAME_EXISTS'
      );
    }

    const queue = await queueRepo.create({
      projectId,
      name,
      description,
      priority,
      concurrencyLimit,
      retryPolicy,
      dlqEnabled,
    });

    res.status(201).json({
      success: true,
      data: { queue },
    });
  } catch (err) {
    next(err);
  }
}

export async function listQueues(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const query = (req as AuthenticatedRequest & { parsedQuery: QueueQueryInput }).parsedQuery || {
      page: 1,
      pageSize: 20,
    };

    const { page, pageSize, projectId } = query;

    if (projectId) {
      const projectRepo = getProjectRepository();
      const project = await projectRepo.findById(projectId);
      if (!project) {
        throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
      }
      await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);
    }

    const queueRepo = getQueueRepository();
    const { data, total } = await queueRepo.listByUser(req.user.id, page, pageSize, projectId);

    const totalPages = Math.ceil(total / pageSize) || 1;

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(queueId);

    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    res.status(200).json({
      success: true,
      data: { queue },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const { name, description, priority, concurrencyLimit, dlqEnabled } =
      req.body as UpdateQueueInput;

    const queueRepo = getQueueRepository();
    const existingQueue = await queueRepo.findById(queueId);

    if (!existingQueue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(existingQueue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    if (name) {
      const nameCheck = await queueRepo.findByProjectAndName(existingQueue.projectId, name);
      if (nameCheck && nameCheck.id !== queueId) {
        throw new AppError(
          409,
          'A queue with this name already exists in this project',
          'QUEUE_NAME_EXISTS'
        );
      }
    }

    const queue = await queueRepo.update(queueId, {
      name,
      description,
      priority,
      concurrencyLimit,
      dlqEnabled,
    });

    res.status(200).json({
      success: true,
      data: { queue },
    });
  } catch (err) {
    next(err);
  }
}

export async function pauseQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(queueId);

    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    const updatedQueue = await queueRepo.pause(queueId);

    res.status(200).json({
      success: true,
      data: { queue: updatedQueue },
    });
  } catch (err) {
    next(err);
  }
}

export async function resumeQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(queueId);

    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    const updatedQueue = await queueRepo.resume(queueId);

    res.status(200).json({
      success: true,
      data: { queue: updatedQueue },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(queueId);

    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    const deleteResult = await queueRepo.delete(queueId);

    if (!deleteResult.success) {
      throw new AppError(409, deleteResult.reason || 'Cannot delete queue', 'CANNOT_DELETE_QUEUE');
    }

    res.status(200).json({
      success: true,
      message: 'Queue deleted successfully',
    });
  } catch (err) {
    next(err);
  }
}

export async function getQueueStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(queueId);

    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    const stats = await queueRepo.getQueueStats(queueId);

    res.status(200).json({
      success: true,
      data: { stats },
    });
  } catch (err) {
    next(err);
  }
}
