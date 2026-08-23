import { Router } from 'express';
import { CreateProjectSchema, UpdateProjectSchema, ProjectQuerySchema } from '@job-scheduler/shared';
import { validate, validateQuery } from '../middleware/validate';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/project.controller';

export const projectsRouter = Router();

// POST /api/v1/projects
projectsRouter.post('/', validate(CreateProjectSchema), createProject);

// GET /api/v1/projects
projectsRouter.get('/', validateQuery(ProjectQuerySchema), listProjects);

// GET /api/v1/projects/:projectId
projectsRouter.get('/:projectId', getProject);

// PATCH /api/v1/projects/:projectId
projectsRouter.patch('/:projectId', validate(UpdateProjectSchema), updateProject);

// DELETE /api/v1/projects/:projectId
projectsRouter.delete('/:projectId', deleteProject);
