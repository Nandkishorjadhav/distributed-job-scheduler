import { OrgRole } from '@job-scheduler/shared';
import { OrgRepository, getPool } from '@job-scheduler/backend-shared';
import { AppError } from './errorHandler';

const ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.OWNER]: 4,
  [OrgRole.ADMIN]: 3,
  [OrgRole.MEMBER]: 2,
  [OrgRole.VIEWER]: 1,
};

/**
 * Ensures the authenticated user belongs to the specified organization
 * and possesses at least the required minimum role.
 * Throws 403 AppError if unauthorized.
 */
export async function checkOrgPermission(
  userId: string,
  orgId: string,
  minRole: OrgRole = OrgRole.VIEWER
): Promise<OrgRole> {
  const orgRepo = new OrgRepository(getPool());
  const userRole = await orgRepo.getUserRole(orgId, userId);

  if (!userRole) {
    throw new AppError(403, 'You do not have access to this organization', 'FORBIDDEN');
  }

  if (ROLE_RANK[userRole] < ROLE_RANK[minRole]) {
    throw new AppError(403, 'Insufficient permissions for this operation', 'FORBIDDEN');
  }

  return userRole;
}
