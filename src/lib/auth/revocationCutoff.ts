/** Compare an already verified token with the account revocation cutoff. */
export function isTokenRevokedByCutoff(cutoff: unknown, issuedAt: unknown): boolean {
  if (cutoff === undefined || cutoff === null) return false;
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) return true;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < 0) return true;
  return cutoff.getTime() >= issuedAt * 1000;
}
