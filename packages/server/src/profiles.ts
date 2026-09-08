import type { Pool } from 'pg';
import { Profile, ProfileNameUpdate } from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';

export async function updateProfileName(pool: Pool, actor: Actor, raw: unknown) {
  if (!['rider', 'driver'].includes(actor.role))
    throw new DomainError('FORBIDDEN', 'This profile cannot be edited here.', 403);
  const parsed = ProfileNameUpdate.safeParse(raw);
  if (!parsed.success) throw new DomainError('INVALID_PROFILE', 'Check your name and try again.', 400);
  const input = parsed.data;
  if (input.expectedProfileId !== actor.id)
    throw new DomainError('PROFILE_CHANGED', 'Your signed-in account changed. Reopen your profile.', 409);
  // Compare and update in one statement. A retry of an already applied value is
  // harmless; a different edit from another device must be reviewed first.
  const result = await pool.query(
    `UPDATE users SET name=$2 WHERE id=$1 AND role=$4 AND NOT disabled
     AND (name=$3 OR name=$2) RETURNING id,name,role`,
    [actor.id, input.name, input.expectedName, actor.role],
  );
  if (!result.rows[0])
    throw new DomainError('PROFILE_CHANGED', 'Your profile changed. Reload it before saving again.', 409);
  return Profile.parse(result.rows[0]);
}
