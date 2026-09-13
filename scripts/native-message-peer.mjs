import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Replies only to the two acceptance markers, using dedicated local synthetic identities.
const [port = '8190'] = process.argv.slice(2);
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid local API port.');
const api = `http://127.0.0.1:${port}`;
async function call(role, path, body) {
  const headers = { Authorization: `Bearer synthetic-${role}`, 'Content-Type': 'application/json' };
  const result = await fetch(api + path, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error(`Synthetic peer request failed: ${result.status}`);
  return result.json();
}
const deadline = Date.now() + 600000;
for (const [role, marker, reply] of [
  ['rider', 'Native pickup check.', 'Native live reply received.'],
  ['driver', 'Native rider check.', 'Native driver reply received.'],
]) {
  let sent = false;
  while (Date.now() < deadline) {
    const { conversations } = await call(role, '/v1/conversations');
    for (const conversation of conversations) {
      const thread = await call(role, `/v1/conversations/${conversation.id}`);
      if (!thread.messages.some((m) => !m.mine && m.text === marker)) continue;
      // Allow the sender's POST/refetch to finish before creating the remote message.
      await delay(5000);
      await call(role, `/v1/conversations/${conversation.id}/messages`, {
        text: reply,
        requestId: randomUUID(),
      });
      console.log(JSON.stringify({ at: new Date().toISOString(), type: 'synthetic-reply-sent', role }));
      sent = true;
      break;
    }
    if (sent) break;
    await delay(1000);
  }
  if (!sent) throw new Error('Native message marker was not observed before the deadline.');
}
