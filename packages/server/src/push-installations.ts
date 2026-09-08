import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  NotificationDeviceRevoke,
  PushInstallationProof,
  PushInstallationUpdate,
  PushInstallationDelete,
} from '@rove/contracts';
import type { Pool } from 'pg';
import { transaction } from './transactions';
import { DomainError } from './errors';
import type { Actor } from './rides';
type Proof = z.infer<typeof PushInstallationProof>;
type Update = z.infer<typeof PushInstallationUpdate>;
type Remove = z.infer<typeof PushInstallationDelete>;
type Row = {
  id: string;
  secret_hash: string;
  owner_id: string;
  revision: number;
  enabled: boolean;
  mutation_id: string | null;
  mutation_hash: string | null;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const changed = () =>
  new DomainError(
    'PUSH_REGISTRATION_CHANGED',
    'Notification registration changed. Refresh before retrying.',
    409,
  );
function verify(row: Row, secret: string) {
  const actual = Buffer.from(row.secret_hash, 'hex');
  const expected = Buffer.from(hash(secret), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new DomainError('PUSH_INSTALLATION_FORBIDDEN', 'This installation could not be verified.', 403);
}
/** Project IDs are server configuration. Each deployment must use an isolated database. */
export class PushInstallations {
  constructor(
    private pool: Pool,
    private projects: Partial<Record<'rider' | 'driver', string>>,
  ) {
    for (const project of Object.values(projects)) z.uuid().parse(project);
    if (projects.rider && projects.rider === projects.driver)
      throw new Error('Rider and driver push projects must differ.');
  }
  private project(actor: Actor) {
    if (actor.role === 'staff')
      throw new DomainError('FORBIDDEN', 'Mobile notification account required.', 403);
    const project = this.projects[actor.role];
    if (!project) throw new DomainError('PUSH_UNAVAILABLE', 'Notifications are not configured yet.', 503);
    return project;
  }
  async status(actor: Actor, raw: Proof) {
    const input = PushInstallationProof.parse(raw);
    const project = this.project(actor);
    const owner = await this.pool.query('SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false', [
      actor.id,
      actor.role,
    ]);
    if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
    const row = (
      await this.pool.query<Row>(
        'SELECT * FROM push_installations WHERE project_id=$1 AND installation_id=$2',
        [project, input.installationId],
      )
    ).rows[0];
    if (row) verify(row, input.secret);
    return {
      installationId: input.installationId,
      revision: row?.revision ?? null,
      enabled: !!row && row.owner_id === actor.id && row.enabled,
    };
  }
  async devices(actor: Actor) {
    const project = this.project(actor);
    const rows = (
      await this.pool.query<{ id: string; revision: number; platform: 'ios' | 'android'; updated_at: Date }>(
        `SELECT p.id,p.revision,p.platform,p.updated_at FROM push_installations p JOIN users u ON u.id=p.owner_id
       WHERE p.owner_id=$1 AND p.project_id=$2 AND p.enabled=true AND u.disabled=false AND u.role=$3
       ORDER BY p.updated_at DESC,p.id LIMIT 10`,
        [actor.id, project, actor.role],
      )
    ).rows;
    return {
      devices: rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        platform: row.platform,
        registeredAt: row.updated_at.toISOString(),
      })),
    };
  }
  async revokeDevice(actor: Actor, id: string, raw: z.infer<typeof NotificationDeviceRevoke>) {
    z.uuid().parse(id);
    const input = NotificationDeviceRevoke.parse(raw);
    const project = this.project(actor);
    const fingerprint = hash(JSON.stringify({ action: 'remote-revoke', actorId: actor.id, id, input }));
    return transaction(this.pool, async (client) => {
      const owner = await client.query(
        'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR UPDATE',
        [actor.id, actor.role],
      );
      if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
      const row = (
        await client.query<Row>(
          'SELECT * FROM push_installations WHERE id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE',
          [id, actor.id, project],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Notification device was not found.', 404);
      if (row.mutation_id === input.mutationId) {
        if (row.mutation_hash !== fingerprint) throw changed();
        return { id, revision: row.revision, enabled: false as const };
      }
      if (row.revision !== input.expectedRevision) throw changed();
      await client.query(
        `UPDATE push_installations SET enabled=false,revision=revision+1,mutation_id=$2,
        mutation_hash=$3,updated_at=now() WHERE id=$1`,
        [id, input.mutationId, fingerprint],
      );
      return { id, revision: row.revision + 1, enabled: false as const };
    });
  }
  register(actor: Actor, raw: Update) {
    return this.change(actor, PushInstallationUpdate.parse(raw), true);
  }
  remove(actor: Actor, raw: Remove) {
    return this.change(actor, PushInstallationDelete.parse(raw), false);
  }
  private async change(actor: Actor, input: Update | Remove, enabled: boolean) {
    const project = this.project(actor);
    const fingerprint = hash(JSON.stringify({ actorId: actor.id, enabled, input }));
    try {
      return await transaction(this.pool, async (client) => {
        const owner = await client.query(
          'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR UPDATE',
          [actor.id, actor.role],
        );
        if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
        // Includes non-existent installations: first writes and account transfers serialize.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `push:${project}:${input.installationId}`,
        ]);
        const row = (
          await client.query<Row>(
            'SELECT * FROM push_installations WHERE project_id=$1 AND installation_id=$2 FOR UPDATE',
            [project, input.installationId],
          )
        ).rows[0];
        if (row) {
          verify(row, input.secret);
          if (row.mutation_id === input.mutationId) {
            if (row.mutation_hash !== fingerprint) throw changed();
            return { installationId: input.installationId, revision: row.revision, enabled: row.enabled };
          }
        }
        if ((row?.revision ?? null) !== input.expectedRevision) throw changed();
        if (!enabled && (!row || row.owner_id !== actor.id)) throw changed();
        if (enabled && (!row || !row.enabled || row.owner_id !== actor.id)) {
          const count = await client.query<{ count: string }>(
            'SELECT count(*) FROM push_installations WHERE owner_id=$1 AND enabled=true',
            [actor.id],
          );
          if (Number(count.rows[0]?.count) >= 10)
            throw new DomainError(
              'PUSH_INSTALLATION_LIMIT',
              'Remove an old notification installation before adding another.',
              409,
            );
        }
        if (enabled && 'token' in input) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `push-token:${project}:${hash(input.token)}`,
          ]);
          const duplicate = await client.query(
            'SELECT id FROM push_installations WHERE project_id=$1 AND token=$2 AND enabled=true AND installation_id<>$3',
            [project, input.token, input.installationId],
          );
          if (duplicate.rowCount) throw changed();

          if (!row) {
            await client.query(
              `INSERT INTO push_installations(project_id,installation_id,secret_hash,owner_id,token,platform,mutation_id,mutation_hash)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                project,
                input.installationId,
                hash(input.secret),
                actor.id,
                input.token,
                input.platform,
                input.mutationId,
                fingerprint,
              ],
            );
          } else {
            await client.query(
              `UPDATE push_installations SET owner_id=$2,token=$3,platform=$4,enabled=true,revision=revision+1,
              mutation_id=$5,mutation_hash=$6,updated_at=now() WHERE id=$1`,
              [row.id, actor.id, input.token, input.platform, input.mutationId, fingerprint],
            );
          }
        } else {
          await client.query(
            `UPDATE push_installations SET enabled=false,revision=revision+1,mutation_id=$2,mutation_hash=$3,updated_at=now() WHERE id=$1`,
            [row!.id, input.mutationId, fingerprint],
          );
        }
        return { installationId: input.installationId, revision: (row?.revision ?? 0) + 1, enabled };
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CONFLICT') throw changed();
      throw error;
    }
  }
  /** Receipt workers carry the exact registration ID/revision captured before sending. */
  async invalidate(id: string, revision: number) {
    z.uuid().parse(id);
    z.number().int().positive().parse(revision);
    const result = await this.pool.query(
      `UPDATE push_installations SET enabled=false,revision=revision+1,
      mutation_id=NULL,mutation_hash=NULL,updated_at=now() WHERE id=$1 AND revision=$2 AND enabled=true`,
      [id, revision],
    );
    return { changed: !!result.rowCount };
  }
}
