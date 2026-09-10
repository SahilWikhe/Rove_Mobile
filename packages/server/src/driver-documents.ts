import type { Pool } from 'pg';
import type { Actor } from './rides';
import { driverOnly } from './drivers';
import { transaction } from './transactions';
import { DomainError } from './errors';
import { DriverDocumentReservation as Reservation, DriverDocumentSummary as Summary } from '@rove/contracts';

/** Metadata only. Returned summaries intentionally exclude keys, checksums and private storage versions. */
export class DriverDocumentService {
  constructor(private pool: Pool) {}
  async reserve(actor: Actor, raw: unknown) {
    driverOnly(actor);
    const input = Reservation.parse(raw);
    return transaction(this.pool, async (client) => {
      // Serialize quotas and account state with other driver mutations.
      const driver = (
        await client.query(
          'SELECT d.id,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d,u',
          [actor.id],
        )
      ).rows[0];
      if (!driver || driver.disabled)
        throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
      const prior = (await client.query('SELECT * FROM driver_documents WHERE id=$1', [input.id])).rows[0];
      if (prior) {
        if (prior.driver_id !== actor.id)
          throw new DomainError(
            'DOCUMENT_CONFLICT',
            'This upload request is unavailable. Start a new upload.',
            409,
          );
        if (
          prior.kind !== input.kind ||
          prior.content_type !== input.contentType ||
          prior.expected_sha256 !== input.sha256 ||
          prior.expected_bytes !== input.bytes
        )
          throw new DomainError('DOCUMENT_CONFLICT', 'The file changed. Start a new upload.', 409);
        return this.summary(prior);
      }
      const recent = await client.query(
        "SELECT count(*)::int AS count FROM driver_documents WHERE driver_id=$1 AND created_at > now()-interval '24 hours'",
        [actor.id],
      );
      if (recent.rows[0].count >= 10)
        throw new DomainError(
          'DOCUMENT_LIMIT',
          'Too many document uploads. Try again later or contact support.',
          429,
        );
      const row = (
        await client.query(
          "INSERT INTO driver_documents(id,driver_id,kind,content_type,expected_sha256,expected_bytes,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '15 minutes') RETURNING *",
          [input.id, actor.id, input.kind, input.contentType, input.sha256, input.bytes],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'driver.document_reserved',$2,$3)",
        [actor.id, input.id, JSON.stringify({ kind: input.kind })],
      );
      return this.summary(row);
    });
  }
  async list(actor: Actor) {
    driverOnly(actor);
    const result = await this.pool.query(
      'SELECT x.* FROM driver_documents x JOIN users u ON u.id=x.driver_id WHERE x.driver_id=$1 AND NOT u.disabled ORDER BY x.created_at DESC,x.id DESC LIMIT 30',
      [actor.id],
    );
    return { documents: result.rows.map((row) => this.summary(row)) };
  }
  private summary(row: Record<string, unknown>) {
    const expiresAt = row.expires_at as Date;
    return Summary.parse({
      id: row.id,
      kind: row.kind,
      state: row.state === 'reserved' && expiresAt.getTime() <= Date.now() ? 'expired' : row.state,
      createdAt: (row.created_at as Date).toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }
}
