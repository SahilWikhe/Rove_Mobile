/** Subtract the entire request duration so delayed responses cannot extend a server location lease. */
export function remainingLocationMs(validForMs: number, requestDurationMs: number): number {
  if (!Number.isFinite(validForMs) || !Number.isFinite(requestDurationMs) || requestDurationMs < 0) return 0;
  return Math.max(0, Math.min(60000, validForMs) - requestDurationMs);
}
