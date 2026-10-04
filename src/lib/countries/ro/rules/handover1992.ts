/** Romanian chamber capacity keeps party quotas and caps every player at one seat. */
import { apportionSeats } from "@/lib/country/seatApportionment";
export function reconcileRoDelegateCapacity(
  rows: readonly { id: string; party: string; seats: number; isNpc: boolean }[],
  target: number
): Record<string, number> | null {
  if (
    !Number.isSafeInteger(target) ||
    target < 1 ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    rows.some((row) => !row.id || !row.party || !Number.isSafeInteger(row.seats) || row.seats < 0)
  )
    throw new Error("Invalid Romanian chamber custody");
  const result = Object.fromEntries(rows.map((row) => [row.id, 0]));
  if (!rows.some((row) => row.seats > 0)) return result;
  const weights: Record<string, number> = {};
  for (const row of rows) weights[row.party] = (weights[row.party] ?? 0) + row.seats;
  const quotas = apportionSeats(weights, target);
  for (const [party, quota] of Object.entries(quotas)) {
    const players = rows.filter((row) => row.party === party && row.seats > 0 && !row.isNpc);
    if (quota < players.length) return null;
    for (const row of players) result[row.id] = 1;
    const remaining = quota - players.length;
    const npcs = rows.filter((row) => row.party === party && row.seats > 0 && row.isNpc);
    if (remaining && !npcs.length) return null;
    const allocated = apportionSeats(
      Object.fromEntries(npcs.map((row) => [row.id, row.seats])),
      remaining
    );
    for (const row of npcs) result[row.id] = allocated[row.id] ?? 0;
  }
  return result;
}
