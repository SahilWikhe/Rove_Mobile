/** Keep OAuth responses out of router state. AuthSession owns PKCE/state validation. */
export function nativeAuthIntent(path: string, scheme: string): string {
  try {
    const url = new URL(path, `${scheme}:///`);
    const callback =
      url.protocol === `${scheme}:` &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'auth' && url.pathname === '/callback') ||
        (url.hostname === '' && url.pathname === '/auth/callback'));
    return callback ? '/' : path;
  } catch {
    return path;
  }
}
