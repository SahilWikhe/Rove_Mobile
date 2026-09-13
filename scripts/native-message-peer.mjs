import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Replies only to this acceptance scenario's marker, using the local synthetic rider.
const [port = '8190'] = process.argv.slice(2);
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid local API port.');
const api = `http://127.0.0.1:${port}`;
const headers = { Authorization: 'Bearer synthetic-rider', 'Content-Type': 'application/json' };
async function call(path, body) {
  const result = await fetch(api + path, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error(`Synthetic peer request failed: ${result.status}`);
  return result.json();
}
const deadline = Date.now() + 600000;
let sent = false;
while (Date.now() < deadline) {
  const { conversations } = await call('/v1/conversations');
  for (const conversation of conversations) {
    const thread = await call(`/v1/conversations/${conversation.id}`);
    if (!thread.messages.some((m) => !m.mine && m.text === 'Native pickup check.')) continue;
    // Allow the sender's POST/refetch to finish before creating the remote message.
    await delay(5000);
    await call(`/v1/conversations/${conversation.id}/messages`, {
      text: 'Native live reply received.',
      requestId: randomUUID(),
    });
    console.log(JSON.stringify({ at: new Date().toISOString(), type: 'synthetic-reply-sent' }));
    sent = true;
    break;
  }
  if (sent) break;
  await delay(1000);
}
if (!sent) throw new Error('Native message marker was not observed before the deadline.');
