import type { Pool } from 'pg';
import { Place, SavedPlaces, type SavedPlaceKind } from '@rove/contracts';
import { DomainError } from './errors';
import { transaction } from './transactions';
import type { Actor } from './rides';
import type { MapsProvider } from './quotes';
function rider(actor: Actor) {
  if (actor.role !== 'rider')
    throw new DomainError('FORBIDDEN', 'Saved places are only available to riders.', 403);
}
export class SavedPlaceService {
  constructor(
    private pool: Pool,
    private maps: MapsProvider,
  ) {}
  async list(actor: Actor) {
    rider(actor);
    const result = await this.pool.query(
      'SELECT kind,place_id AS "placeId" FROM saved_places WHERE rider_id=$1 ORDER BY kind',
      [actor.id],
    );
    return SavedPlaces.parse({ places: result.rows });
  }
  async resolve(actor: Actor, kind: SavedPlaceKind) {
    rider(actor);
    const result = await this.pool.query<{ place_id: string }>(
      'SELECT place_id FROM saved_places WHERE rider_id=$1 AND kind=$2',
      [actor.id, kind],
    );
    if (!result.rows[0]) throw new DomainError('NOT_FOUND', 'Save this place before using it.', 404);
    return Place.parse(await this.maps.resolve(result.rows[0].place_id));
  }
  async update(actor: Actor, kind: SavedPlaceKind, placeId: string, expectedPlaceId: string | null) {
    rider(actor);
    // Verify the provider ID before writing, without keeping returned addresses or coordinates.
    Place.parse(await this.maps.resolve(placeId));
    return this.change(actor, kind, placeId, expectedPlaceId);
  }
  async remove(actor: Actor, kind: SavedPlaceKind, expectedPlaceId: string) {
    rider(actor);
    return this.change(actor, kind, null, expectedPlaceId);
  }
  private async change(
    actor: Actor,
    kind: SavedPlaceKind,
    placeId: string | null,
    expectedPlaceId: string | null,
  ) {
    await transaction(this.pool, async (client) => {
      // Lock the owner even when the slot does not yet exist; concurrent first writes must serialize.
      const owner = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='rider' AND disabled=false FOR UPDATE",
        [actor.id],
      );
      if (!owner.rowCount)
        throw new DomainError('FORBIDDEN', 'This account cannot change saved places.', 403);
      const result = await client.query<{ place_id: string }>(
        'SELECT place_id FROM saved_places WHERE rider_id=$1 AND kind=$2',
        [actor.id, kind],
      );
      const current = result.rows[0]?.place_id ?? null;
      if (current === placeId) return; // A repeated completed operation is safe.
      if (current !== expectedPlaceId)
        throw new DomainError(
          'SAVED_PLACE_CHANGED',
          'This saved place changed. Reload before replacing it.',
          409,
        );
      if (placeId === null)
        await client.query('DELETE FROM saved_places WHERE rider_id=$1 AND kind=$2', [actor.id, kind]);
      else
        await client.query(
          'INSERT INTO saved_places(rider_id,kind,place_id) VALUES($1,$2,$3) ON CONFLICT(rider_id,kind) DO UPDATE SET place_id=EXCLUDED.place_id',
          [actor.id, kind, placeId],
        );
    });
    return { ok: true as const };
  }
}
