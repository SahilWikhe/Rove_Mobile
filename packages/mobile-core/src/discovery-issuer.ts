/** Expo appends a slash before its discovery path. Do not normalize the JWT issuer itself. */
export function discoveryIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}
