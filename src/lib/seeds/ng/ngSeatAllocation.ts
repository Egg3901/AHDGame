/**
 * Largest-remainder (Hamilton) apportionment: split `totalSeats` among parties
 * by their percentage `shares`, guaranteeing the per-party seats sum exactly to
 * `totalSeats`. Used to turn NG zone vote-shares into per-party seat holdings.
 */
export function allocateSeatsByShare(
  totalSeats: number,
  shares: Record<string, number>
): Record<string, number> {
  const totalShare = Object.values(shares).reduce((s, v) => s + v, 0) || 1;
  const quota = Object.entries(shares).map(([party, pct]) => {
    const exact = (pct / totalShare) * totalSeats;
    return { party, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const result: Record<string, number> = {};
  let used = 0;
  for (const q of quota) {
    result[q.party] = q.floor;
    used += q.floor;
  }
  let leftover = totalSeats - used;
  for (const q of [...quota].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    result[q.party] += 1;
    leftover -= 1;
  }
  return result;
}
