import { Router } from 'express';
import { CreateOrgSchema, UpdateOrgSchema, PaginationSchema } from '@job-scheduler/shared';
import { validate, validateQuery } from '../middleware/validate';
import { createOrg, listOrgs, getOrg, updateOrg } from '../controllers/org.controller';

export const orgsRouter = Router();

// POST /api/v1/orgs
orgsRouter.post('/', validate(CreateOrgSchema), createOrg);

// GET /api/v1/orgs
orgsRouter.get('/', validateQuery(PaginationSchema), listOrgs);

// GET /api/v1/orgs/:orgId
orgsRouter.get('/:orgId', getOrg);

// PATCH /api/v1/orgs/:orgId
orgsRouter.patch('/:orgId', validate(UpdateOrgSchema), updateOrg);
