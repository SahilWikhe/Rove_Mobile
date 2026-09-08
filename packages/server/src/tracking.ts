import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { BackgroundLocation } from '@rove/contracts';
import { DomainError } from './errors';
import { driverOnly } from './drivers';
import type { Actor } from './rides';
import { transaction } from './transactions';

function digest(token: string) {
  if (!/^rt_[A-Za-z0-9_-]{43}$/.test(token))
    throw new DomainError('TRACKING_UNAUTHORIZED', 'Open the driver app to reconnect location.', 401);
  return createHash('sha256').update(token).digest('hex');
}
const unauthorized = () =>
  new DomainError('TRACKING_UNAUTHORIZED', 'Open the driver app to reconnect location.', 401);

/** A grant can submit only its own driver's location, or revoke itself.
 * It cannot read rides, accept offers, renew itself, or alter account/availability.
 */
export class TrackingService {
  constructor(
    private pool: Pool,
    private now: () => Date = () => new Date(),
  ) {}

  async issue(actor: Actor) {
    driverOnly(actor);
    const token = 'rt_' + randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + 12 * 60 * 60 * 1000);
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        'SELECT d.online,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d',
        [actor.id],
      );
      if (!result.rows[0]?.online || result.rows[0].disabled) throw unauthorized();
      // Rotation makes retries safe without storing a plaintext token in command results.
      await client.query(
        `INSERT INTO driver_tracking_sessions(driver_id,token_hash,expires_at)
        VALUES ($1,$2,$3) ON CONFLICT(driver_id) DO UPDATE SET
        token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,created_at=now(),sampled_at=NULL`,
        [actor.id, digest(token), expiresAt],
      );
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async revoke(token: string) {
    await this.pool.query('DELETE FROM driver_tracking_sessions WHERE token_hash=$1', [digest(token)]);
    return { revoked: true };
  }

  async location(token: string, raw: unknown) {
    const hash = digest(token);
    const parsed = BackgroundLocation.safeParse(raw);
    const now = this.now();
    if (!parsed.success)
      throw new DomainError('INVALID_LOCATION_SAMPLE', 'A fresh, accurate location is required.', 422);
    const sample = parsed.data;
    const age = now.getTime() - Date.parse(sample.sampledAt);
    if (age < -5000 || age > 30_000)
      throw new DomainError('INVALID_LOCATION_SAMPLE', 'A fresh, accurate location is required.', 422);
    return transaction(this.pool, async (client) => {
      // Lock order matches issue/availability: driver first, then tracking grant.
      const result = await client.query(
        `SELECT d.id,u.disabled,d.online FROM drivers d JOIN users u ON u.id=d.id
        JOIN driver_tracking_sessions s ON s.driver_id=d.id WHERE s.token_hash=$1 FOR UPDATE OF d`,
        [hash],
      );
      const driver = result.rows[0];
      if (!driver?.online || driver.disabled) throw unauthorized();
      const grant = (
        await client.query(
          'SELECT expires_at,sampled_at FROM driver_tracking_sessions WHERE driver_id=$1 AND token_hash=$2 FOR UPDATE',
          [driver.id, hash],
        )
      ).rows[0];
      if (!grant || grant.expires_at <= now) throw unauthorized();
      const sampledAt = new Date(sample.sampledAt);
      // Duplicate/out-of-order delivery is harmless and does not refresh matching eligibility.
      if (grant.sampled_at && grant.sampled_at >= sampledAt) return { accepted: false };
      await client.query('UPDATE driver_tracking_sessions SET sampled_at=$2 WHERE driver_id=$1', [
        driver.id,
        sampledAt,
      ]);
      await client.query(
        'UPDATE drivers SET location=$2,location_at=$3,location_sequence=location_sequence+1 WHERE id=$1',
        [driver.id, JSON.stringify(sample.coordinate), now],
      );
      return { accepted: true };
    });
  }
}
