import { Response, NextFunction } from 'express';
import { OrgRole, CreateOrgInput, UpdateOrgInput, PaginationInput } from '@job-scheduler/shared';
import { OrgRepository, getPool } from '@job-scheduler/backend-shared';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { checkOrgPermission } from '../middleware/authorization';
import { AppError } from '../middleware/errorHandler';

const getOrgRepository = () => new OrgRepository(getPool());

export async function createOrg(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { name, slug } = req.body as CreateOrgInput;
    const orgRepo = getOrgRepository();

    const existingSlug = await orgRepo.findBySlug(slug);
    if (existingSlug) {
      throw new AppError(409, 'An organization with this slug already exists', 'ORG_SLUG_EXISTS');
    }

    const organization = await orgRepo.create({ name, slug }, req.user.id);

    res.status(201).json({
      success: true,
      data: { organization },
    });
  } catch (err: any) {
    if (err?.code === '23503') {
      return next(
        new AppError(
          401,
          'Session user does not exist in database. Please log in again.',
          'SESSION_INVALID'
        )
      );
    }
    next(err);
  }
}

export async function listOrgs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { page, pageSize } = (req as AuthenticatedRequest & { parsedQuery: PaginationInput })
      .parsedQuery || {
      page: 1,
      pageSize: 20,
    };

    const orgRepo = getOrgRepository();
    const { data, total } = await orgRepo.listUserOrgs(req.user.id, page, pageSize);

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

export async function getOrg(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { orgId } = req.params;
    const userRole = await checkOrgPermission(req.user.id, orgId, OrgRole.VIEWER);

    const orgRepo = getOrgRepository();
    const organization = await orgRepo.findById(orgId);

    if (!organization) {
      throw new AppError(404, 'Organization not found', 'ORG_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        organization: {
          ...organization,
          role: userRole,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateOrg(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { orgId } = req.params;
    const { name, slug } = req.body as UpdateOrgInput;

    await checkOrgPermission(req.user.id, orgId, OrgRole.ADMIN);

    const orgRepo = getOrgRepository();

    if (slug) {
      const existingSlug = await orgRepo.findBySlug(slug);
      if (existingSlug && existingSlug.id !== orgId) {
        throw new AppError(409, 'An organization with this slug already exists', 'ORG_SLUG_EXISTS');
      }
    }

    const organization = await orgRepo.update(orgId, { name, slug });

    if (!organization) {
      throw new AppError(404, 'Organization not found', 'ORG_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: { organization },
    });
  } catch (err) {
    next(err);
  }
}
