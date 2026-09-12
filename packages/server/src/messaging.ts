import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  Conversation,
  ConversationList,
  ConversationQuery,
  ConversationThread,
  MessageInput,
  MessageRead,
  MessageReport,
  TripMessage,
} from '@rove/contracts';
import type { Actor } from './rides';
import { transaction } from './transactions';
import { DomainError } from './errors';

const active = ['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'];
const missing = () =>
  new DomainError('CONVERSATION_UNAVAILABLE', 'This conversation is no longer available.', 404);
function message(row: Record<string, unknown>, actor: Actor) {
  return TripMessage.parse({
    id: row.id,
    sequence: row.sequence,
    mine: row.sender_id === actor.id,
    text: row.text,
    createdAt: (row.created_at as Date).toISOString(),
  });
}
export class MessagingService {
  constructor(private pool: Pool) {}
  private async owner(client: PoolClient, actor: Actor) {
    if (!['rider', 'driver'].includes(actor.role)) throw missing();
    const found = await client.query(
      'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR SHARE',
      [actor.id, actor.role],
    );
    if (!found.rowCount) throw missing();
  }
  private async assignment(client: PoolClient, actor: Actor, offerId: string) {
    z.uuid().parse(offerId);
    await this.owner(client, actor);
    const result = await client.query(
      `SELECT o.id,r.id AS ride_id,r.rider_id,r.driver_id,r.state,r.created_at,
      u.name, EXISTS(SELECT 1 FROM trip_message_reports b WHERE b.offer_id=o.id) AS blocked
      FROM offers o JOIN rides r ON r.id=o.ride_id
      JOIN users u ON u.id=CASE WHEN $2=r.rider_id THEN r.driver_id ELSE r.rider_id END
      WHERE o.id=$1 AND o.status='accepted' AND r.driver_id=o.driver_id AND u.disabled=false
      AND (($3='rider' AND r.rider_id=$2) OR ($3='driver' AND r.driver_id=$2))
      AND (r.state=ANY($4) OR r.updated_at>now()-interval '30 days')
      FOR UPDATE OF r`,
      [offerId, actor.id, actor.role, active],
    );
    if (!result.rows[0]) throw missing();
    const blocked = await client.query('SELECT 1 FROM trip_message_reports WHERE offer_id=$1 LIMIT 1', [
      offerId,
    ]);
    return { ...result.rows[0], blocked: !!blocked.rowCount };
  }
  private async summary(client: PoolClient, actor: Actor, row: Record<string, unknown>) {
    const messages = await client.query(
      `SELECT * FROM trip_messages WHERE offer_id=$1 AND created_at>now()-interval '30 days' ORDER BY sequence DESC LIMIT 1`,
      [row.id],
    );
    const unread = await client.query(
      `SELECT count(*)::int AS count FROM trip_messages m WHERE offer_id=$1 AND sender_id<>$2
      AND created_at>now()-interval '30 days' AND sequence>COALESCE((SELECT through FROM trip_message_reads WHERE offer_id=$1 AND owner_id=$2),0)`,
      [row.id, actor.id],
    );
    const count = await client.query('SELECT count(*)::int AS count FROM trip_messages WHERE offer_id=$1', [
      row.id,
    ]);
    return Conversation.parse({
      id: row.id,
      rideId: row.ride_id,
      name: row.name,
      rideCreatedAt: (row.created_at as Date).toISOString(),
      state: row.state,
      blocked: row.blocked,
      canSend: active.includes(String(row.state)) && !row.blocked && count.rows[0].count < 200,
      unread: unread.rows[0].count,
      latest: messages.rows[0] ? message(messages.rows[0], actor) : null,
    });
  }
  async list(actor: Actor, raw: unknown = {}) {
    const parsed = ConversationQuery.safeParse(raw);
    if (!parsed.success) throw new DomainError('INVALID_QUERY', 'Invalid conversation cursor.', 400);
    const q = parsed.data;
    return transaction(this.pool, async (client) => {
      await this.owner(client, actor);
      const result = await client.query(
        `SELECT o.id,r.id AS ride_id,r.state,r.created_at,u.name,
        to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
        (SELECT row_to_json(m) FROM trip_messages m WHERE m.offer_id=o.id AND m.created_at>now()-interval '30 days' ORDER BY sequence DESC LIMIT 1) AS latest,
        (SELECT count(*)::int FROM trip_messages m WHERE m.offer_id=o.id) AS total,
        (SELECT count(*)::int FROM trip_messages m WHERE m.offer_id=o.id AND m.sender_id<>$1 AND m.created_at>now()-interval '30 days' AND m.sequence>COALESCE((SELECT through FROM trip_message_reads WHERE offer_id=o.id AND owner_id=$1),0)) AS unread,
        EXISTS(SELECT 1 FROM trip_message_reports b WHERE b.offer_id=o.id) AS blocked
        FROM offers o JOIN rides r ON r.id=o.ride_id
        JOIN users u ON u.id=CASE WHEN $1=r.rider_id THEN r.driver_id ELSE r.rider_id END
        WHERE o.status='accepted' AND r.driver_id=o.driver_id AND u.disabled=false
        AND (($2='rider' AND r.rider_id=$1) OR ($2='driver' AND r.driver_id=$1))
        AND (r.state=ANY($3) OR r.updated_at>now()-interval '30 days')
        AND ($4::timestamptz IS NULL OR (r.created_at,o.id)<($4::timestamptz,$5::uuid))
        ORDER BY r.created_at DESC,o.id DESC LIMIT 51`,
        [actor.id, actor.role, active, q.beforeCreatedAt ?? null, q.beforeId ?? null],
      );
      const rows = result.rows.slice(0, 50);
      const conversations = [];
      for (const row of rows)
        conversations.push(
          Conversation.parse({
            id: row.id,
            rideId: row.ride_id,
            name: row.name,
            rideCreatedAt: row.created_at.toISOString(),
            state: row.state,
            blocked: row.blocked,
            canSend: active.includes(row.state) && !row.blocked && row.total < 200,
            unread: row.unread,
            latest: row.latest
              ? message({ ...row.latest, created_at: new Date(row.latest.created_at) }, actor)
              : null,
          }),
        );
      const last = rows.at(-1);
      return ConversationList.parse({
        conversations,
        nextCursor:
          result.rows.length > 50 && last ? { beforeCreatedAt: last.cursor_time, beforeId: last.id } : null,
      });
    });
  }
  async unread(actor: Actor) {
    return transaction(this.pool, async (client) => {
      await this.owner(client, actor);
      const result = await client.query(
        `SELECT count(*)::int AS count FROM trip_messages m JOIN offers o ON o.id=m.offer_id JOIN rides r ON r.id=o.ride_id
        JOIN users u ON u.id=CASE WHEN $1=r.rider_id THEN r.driver_id ELSE r.rider_id END
        WHERE o.status='accepted' AND o.driver_id=r.driver_id AND u.disabled=false
        AND (($2='rider' AND r.rider_id=$1) OR ($2='driver' AND r.driver_id=$1))
        AND m.sender_id<>$1 AND m.created_at>now()-interval '30 days'
        AND m.sequence>COALESCE((SELECT through FROM trip_message_reads WHERE offer_id=o.id AND owner_id=$1),0)`,
        [actor.id, actor.role],
      );
      return { unread: result.rows[0].count as number };
    });
  }
  async forRide(actor: Actor, rideId: string) {
    z.uuid().parse(rideId);
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT o.id FROM offers o JOIN rides r ON r.id=o.ride_id WHERE r.id=$1 AND o.status='accepted' AND o.driver_id=r.driver_id`,
        [rideId],
      );
      if (!result.rows[0]) throw missing();
      const row = await this.assignment(client, actor, result.rows[0].id);
      return this.summary(client, actor, row);
    });
  }
  async thread(actor: Actor, offerId: string) {
    return transaction(this.pool, async (client) => {
      const row = await this.assignment(client, actor, offerId);
      const result = await client.query(
        `SELECT * FROM trip_messages WHERE offer_id=$1 AND created_at>now()-interval '30 days' ORDER BY sequence LIMIT 200`,
        [offerId],
      );
      return ConversationThread.parse({
        conversation: await this.summary(client, actor, row),
        messages: result.rows.map((r) => message(r, actor)),
      });
    });
  }
  async send(actor: Actor, offerId: string, raw: unknown) {
    const input = MessageInput.parse(raw);
    return transaction(this.pool, async (client) => {
      // Authorize inside the same transaction BEFORE retry lookup. No private bodies in commands/audit.
      const row = await this.assignment(client, actor, offerId);
      const existing = await client.query(
        "SELECT *,created_at>now()-interval '30 days' AS retained FROM trip_messages WHERE sender_id=$1 AND request_id=$2",
        [actor.id, input.requestId],
      );
      if (existing.rows[0]) {
        if (!existing.rows[0].retained) throw missing();
        if (existing.rows[0].offer_id !== offerId || existing.rows[0].text !== input.text)
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'This send request was already used.', 409);
        return message(existing.rows[0], actor);
      }
      if (!active.includes(row.state) || row.blocked)
        throw new DomainError('CONVERSATION_CLOSED', 'This conversation is read-only.', 409);
      const count = await client.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE sender_id=$2 AND created_at>now()-interval '1 minute')::int AS recent FROM trip_messages WHERE offer_id=$1`,
        [offerId, actor.id],
      );
      if (count.rows[0].total >= 200)
        throw new DomainError('CONVERSATION_CLOSED', 'This conversation has reached its message limit.', 409);
      if (count.rows[0].recent >= 10)
        throw new DomainError(
          'MESSAGE_RATE_LIMIT',
          'Please wait a minute before sending more messages.',
          429,
        );
      const result = await client.query(
        'INSERT INTO trip_messages(offer_id,sender_id,request_id,text) VALUES($1,$2,$3,$4) RETURNING *',
        [offerId, actor.id, input.requestId, input.text],
      );
      const sent = message(result.rows[0], actor);
      await client.query(
        `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('message.created',$1,'{}',$2)`,
        [sent.id, 'message:' + sent.id],
      );
      return sent;
    });
  }
  async read(actor: Actor, offerId: string, raw: unknown) {
    const input = MessageRead.parse(raw);
    return transaction(this.pool, async (client) => {
      await this.assignment(client, actor, offerId);
      const found = await client.query(
        'SELECT sequence FROM trip_messages WHERE offer_id=$1 AND sequence=$2',
        [offerId, input.through],
      );
      if (!found.rowCount)
        throw new DomainError('INVALID_READ', 'The message does not belong to this conversation.', 400);
      await client.query(
        `INSERT INTO trip_message_reads(offer_id,owner_id,through) VALUES($1,$2,$3)
        ON CONFLICT(offer_id,owner_id) DO UPDATE SET through=GREATEST(trip_message_reads.through,EXCLUDED.through)`,
        [offerId, actor.id, input.through],
      );
      return { ok: true as const };
    });
  }
  async report(actor: Actor, offerId: string, raw: unknown) {
    const input = MessageReport.parse(raw);
    return transaction(this.pool, async (client) => {
      const row = await this.assignment(client, actor, offerId);
      const old = await client.query(
        'SELECT support_id FROM trip_message_reports WHERE offer_id=$1 AND reporter_id=$2',
        [offerId, actor.id],
      );
      if (!old.rowCount) {
        const result = await client.query(
          `INSERT INTO support_requests(owner_id,category,message) VALUES($1,'trip',$2) RETURNING id`,
          [
            actor.id,
            `Conversation report: ${input.reason}. Trip ${row.ride_id}. Assignment ${offerId}. Further messages are blocked.`,
          ],
        );
        await client.query(
          'INSERT INTO trip_message_reports(offer_id,reporter_id,support_id) VALUES($1,$2,$3)',
          [offerId, actor.id, result.rows[0].id],
        );
      }
      return { ok: true as const };
    });
  }
}
