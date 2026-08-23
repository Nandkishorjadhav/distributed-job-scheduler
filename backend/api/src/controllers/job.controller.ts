import { Response, NextFunction } from 'express';
import { OrgRole, SubmitJobInput, SubmitBatchInput, CreateJobDirectInput, CreateRecurringJobInput, JobFilterInput, LogLevel } from '@job-scheduler/shared';
import { JobRepository, QueueRepository, ProjectRepository, getPool } from '@job-scheduler/backend-shared';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { checkOrgPermission } from '../middleware/authorization';
import { AppError } from '../middleware/errorHandler';

const getJobRepository = () => new JobRepository(getPool());
const getQueueRepository = () => new QueueRepository(getPool());
const getProjectRepository = () => new ProjectRepository(getPool());

export async function createJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const queueId = req.params.queueId || (req.body as CreateJobDirectInput).queueId;
    if (!queueId) {
      throw new AppError(400, 'queueId is required', 'QUEUE_ID_REQUIRED');
    }

    const { name, type, payload, priority, scheduledAt, maxAttempts, timeoutMs } = req.body as SubmitJobInput;

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

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.MEMBER);

    const jobRepo = getJobRepository();
    const job = await jobRepo.create({
      queueId,
      name,
      type,
      payload,
      priority,
      scheduledAt,
      maxAttempts,
      timeoutMs,
    });

    res.status(201).json({
      success: true,
      data: { job },
    });
  } catch (err) {
    next(err);
  }
}

export async function createBatchJobs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const { name, jobs } = req.body as SubmitBatchInput;
    const description = (req.body as { description?: string }).description;

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

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.MEMBER);

    const jobRepo = getJobRepository();
    const batchResult = await jobRepo.createBatch(
      { queueId, name, description, jobs },
      project.id
    );

    res.status(201).json({
      success: true,
      data: batchResult,
    });
  } catch (err) {
    next(err);
  }
}

export async function createRecurringJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { queueId } = req.params;
    const input = req.body as CreateRecurringJobInput;

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

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.MEMBER);

    const jobRepo = getJobRepository();
    const scheduledJob = await jobRepo.createRecurring({
      ...input,
      queueId,
    });

    res.status(201).json({
      success: true,
      data: { scheduledJob },
    });
  } catch (err) {
    next(err);
  }
}

export async function getJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
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
      data: { job },
    });
  } catch (err) {
    next(err);
  }
}

export async function listJobs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const query = (req as AuthenticatedRequest & { parsedQuery: JobFilterInput }).parsedQuery || {
      page: 1,
      pageSize: 20,
    };

    const { page, pageSize, status, search, type, projectId } = query;
    const queueId = (req.params.queueId || query.queueId);

    if (queueId) {
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
    }

    const jobRepo = getJobRepository();
    const { data, total } = await jobRepo.listByUser(req.user.id, page, pageSize, {
      queueId,
      projectId,
      status,
      type,
      search,
    });

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

export async function cancelJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.MEMBER);

    try {
      const cancelledJob = await jobRepo.cancel(jobId);
      res.status(200).json({
        success: true,
        data: { job: cancelledJob },
      });
    } catch (err: unknown) {
      throw new AppError(400, (err as Error).message || 'Job cannot be cancelled', 'JOB_CANNOT_BE_CANCELLED');
    }
  } catch (err) {
    next(err);
  }
}

export async function retryJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.MEMBER);

    try {
      const retriedJob = await jobRepo.retry(jobId);
      res.status(200).json({
        success: true,
        data: { job: retriedJob },
      });
    } catch (err: unknown) {
      throw new AppError(400, (err as Error).message || 'Job cannot be retried', 'JOB_CANNOT_BE_RETRIED');
    }
  } catch (err) {
    next(err);
  }
}

export async function getExecutionHistory(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    const executions = await jobRepo.getExecutionHistory(jobId);

    res.status(200).json({
      success: true,
      data: { executions },
    });
  } catch (err) {
    next(err);
  }
}

export async function getJobLogs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const level = req.query.level as LogLevel | undefined;

    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    const logs = await jobRepo.getJobLogs(jobId, level);

    res.status(200).json({
      success: true,
      data: { logs },
    });
  } catch (err) {
    next(err);
  }
}

export async function getJobHistory(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { jobId } = req.params;
    const jobRepo = getJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
      throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    const queueRepo = getQueueRepository();
    const queue = await queueRepo.findById(job.queueId);
    if (!queue) {
      throw new AppError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }

    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(queue.projectId);
    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    const history = await jobRepo.getJobHistory(jobId);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (err) {
    next(err);
  }
}
