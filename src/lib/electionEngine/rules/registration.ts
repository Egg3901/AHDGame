/**
 * General-election registration removes the unregistered share from a vote pool.
 * scalePoolToRegistered preserves the existing no-data fallback and clamps
 * stored percentages without changing candidate vote shares.
 */
export function scalePoolToRegistered(
  pool: number,
  unregisteredPct: number | null | undefined
): number {
  if (typeof unregisteredPct !== "number" || !Number.isFinite(unregisteredPct)) return pool;
  const clamped = Math.min(100, Math.max(0, unregisteredPct));
  return pool * (1 - clamped / 100);
}
