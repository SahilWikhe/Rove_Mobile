/** Keep account access until the backend has released availability and native
 * tracking has stopped. Never infer offline state from a cached command result.
 */
export async function signOutDriver(deps: {
  goOffline: () => Promise<unknown>;
  profile: () => Promise<{ online: boolean }>;
  stopTracking: () => Promise<void>;
  clearSession: () => Promise<void>;
}) {
  await deps.goOffline();
  const current = await deps.profile();
  if (current.online) throw new Error('Your driver session is still online. Go offline before signing out.');
  await deps.stopTracking();
  await deps.clearSession();
}
