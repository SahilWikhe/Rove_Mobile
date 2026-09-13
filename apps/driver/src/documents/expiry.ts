/** Display-only renewal reminder. Server review and eligibility remain authoritative. */
export function credentialExpiry(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) return null;
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return 'expired';
  return remaining <= 30 * 24 * 60 * 60 * 1000 ? 'expiring_soon' : null;
}
