import { setTimeout as delay } from 'node:timers/promises';
const [port = '8190'] = process.argv.slice(2);
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid local API port.');
const api = `http://127.0.0.1:${port}`;
async function call(role, path, body) {
  const result = await fetch(api + path, {
    headers: { Authorization: `Bearer synthetic-${role}`, 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error(`Synthetic location request failed: ${result.status}`);
  return result.json();
}
const deadline = Date.now() + 600000;
for (const state of ['en_route', 'in_progress']) {
  let ride;
  while (!ride && Date.now() < deadline) {
    const result = await call('rider', '/v1/rides');
    ride = result.rides.find((candidate) => candidate.state === state);
    if (!ride) await delay(1000);
  }
  if (!ride) throw new Error(`Trip did not reach ${state}.`);
  // Give the native driver time to background before supplying controlled samples.
  await delay(10000);
  for (let step = 0; step < 3; step++) {
    const profile = await call('driver', '/v1/drivers/me');
    const coordinate = { latitude: 35.785 + step * 0.002, longitude: -78.635 + step * 0.001 };
    const sampledAt = new Date().toISOString();
    await call('driver', '/v1/drivers/me/heartbeat', {
      coordinate,
      sampledAt,
      accuracyMeters: 5,
      sequence: profile.locationSequence + 1,
    });
    const visible = await call('rider', `/v1/rides/${ride.id}/driver-location`);
    if (
      visible.location?.sampledAt !== sampledAt ||
      visible.location.coordinate.latitude !== coordinate.latitude ||
      visible.location.coordinate.longitude !== coordinate.longitude
    )
      throw new Error('Assigned rider did not read the uploaded sample.');
    console.log(
      JSON.stringify({ at: new Date().toISOString(), type: 'location-sample-verified', state, step }),
    );
    await delay(2000);
  }
}
