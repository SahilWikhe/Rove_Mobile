import type { PoolClient } from 'pg';
import type { Actor } from './rides';
import { DomainError } from './errors';

export async function requireStaffPermission(client: PoolClient, actor: Actor, permission: string) {
  if (actor.role !== 'staff' || actor.mfa !== true)
    throw new DomainError('FORBIDDEN', 'Verified MFA and staff permission are required.', 403);
  const result = await client.query(
    "SELECT u.id FROM users u JOIN staff_permissions p ON p.staff_id=u.id WHERE u.id=$1 AND u.role='staff' AND u.disabled=false AND p.permission=$2 FOR SHARE OF u,p",
    [actor.id, permission],
  );
  if (!result.rowCount)
    throw new DomainError('FORBIDDEN', 'Verified MFA and staff permission are required.', 403);
}
