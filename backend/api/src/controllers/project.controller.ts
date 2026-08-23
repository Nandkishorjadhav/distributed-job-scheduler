import { Response, NextFunction } from 'express';
import { OrgRole, CreateProjectInput, UpdateProjectInput, ProjectQueryInput } from '@job-scheduler/shared';
import { ProjectRepository, getPool } from '@job-scheduler/backend-shared';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { checkOrgPermission } from '../middleware/authorization';
import { AppError } from '../middleware/errorHandler';

const getProjectRepository = () => new ProjectRepository(getPool());

export async function createProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { organizationId, name, slug, description } = req.body as CreateProjectInput;

    await checkOrgPermission(req.user.id, organizationId, OrgRole.ADMIN);

    const projectRepo = getProjectRepository();
    const existingSlug = await projectRepo.findByOrgAndSlug(organizationId, slug);

    if (existingSlug) {
      throw new AppError(409, 'A project with this slug already exists in this organization', 'PROJECT_SLUG_EXISTS');
    }

    const project = await projectRepo.create({
      organizationId,
      name,
      slug,
      description,
    });

    res.status(201).json({
      success: true,
      data: { project },
    });
  } catch (err) {
    next(err);
  }
}

export async function listProjects(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const query = (req as AuthenticatedRequest & { parsedQuery: ProjectQueryInput }).parsedQuery || {
      page: 1,
      pageSize: 20,
    };

    const { page, pageSize, organizationId } = query;

    if (organizationId) {
      await checkOrgPermission(req.user.id, organizationId, OrgRole.VIEWER);
    }

    const projectRepo = getProjectRepository();
    const { data, total } = await projectRepo.listByUser(req.user.id, page, pageSize, organizationId);

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

export async function getProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId } = req.params;
    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(projectId);

    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.VIEWER);

    res.status(200).json({
      success: true,
      data: { project },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId } = req.params;
    const { name, slug, description } = req.body as UpdateProjectInput;

    const projectRepo = getProjectRepository();
    const existingProject = await projectRepo.findById(projectId);

    if (!existingProject) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, existingProject.organizationId, OrgRole.ADMIN);

    if (slug) {
      const slugCheck = await projectRepo.findByOrgAndSlug(existingProject.organizationId, slug);
      if (slugCheck && slugCheck.id !== projectId) {
        throw new AppError(409, 'A project with this slug already exists in this organization', 'PROJECT_SLUG_EXISTS');
      }
    }

    const project = await projectRepo.update(projectId, { name, slug, description });

    res.status(200).json({
      success: true,
      data: { project },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { projectId } = req.params;
    const projectRepo = getProjectRepository();
    const project = await projectRepo.findById(projectId);

    if (!project) {
      throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
    }

    await checkOrgPermission(req.user.id, project.organizationId, OrgRole.ADMIN);

    const deleteResult = await projectRepo.delete(projectId);

    if (!deleteResult.success) {
      throw new AppError(409, deleteResult.reason || 'Cannot delete project', 'PROJECT_DELETE_FAILED');
    }

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (err) {
    next(err);
  }
}
