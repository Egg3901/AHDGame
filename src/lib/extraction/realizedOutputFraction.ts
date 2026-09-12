/**
 * Realized divided by nameplate output, clamped to physical bounds. A stale-low
 * revenue nameplate can otherwise make nationalized plants deplete more resource
 * than they produced. Null means there is no usable nameplate measurement.
 */
export function realizedOutputFraction(
  producedUnits: number,
  nameplateUnits: number
): number | null {
  if (!Number.isFinite(nameplateUnits) || nameplateUnits <= 0) return null;
  if (!Number.isFinite(producedUnits)) return null;
  return Math.min(1, Math.max(0, producedUnits / nameplateUnits));
}
