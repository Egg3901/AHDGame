/** Legacy ordinary ballots prove one complete chamber before its capacity opens. */
import { canOpenBgOrdinaryAssembly } from "./assemblyTransition";
export function latestBgOrdinaryCohort(
  calendarTurn: number,
  regionIds: readonly string[],
  resolved: readonly { state: string; cycle: number; totalSeats?: number }[]
): { cycle: number; regionalSeats: Record<string, number> } | null {
  if (
    !Number.isSafeInteger(calendarTurn) ||
    calendarTurn < 1 ||
    !resolved.length ||
    new Set(regionIds).size !== regionIds.length ||
    resolved.some((row) => !Number.isSafeInteger(row.cycle) || row.cycle < 1)
  )
    return null;
  const cycle = resolved.reduce((latest, row) => Math.max(latest, row.cycle), 1);
  const cohort = resolved.filter((row) => row.cycle === cycle);
  const seats = Object.fromEntries(cohort.map((row) => [row.state, row.totalSeats ?? 0]));
  if (
    cohort.length !== regionIds.length ||
    new Set(cohort.map((row) => row.state)).size !== regionIds.length ||
    regionIds.some((id) => seats[id] == null) ||
    !canOpenBgOrdinaryAssembly(calendarTurn, seats)
  )
    return null;
  return { cycle, regionalSeats: seats };
}
export function hasValidBgOrdinaryCustody(
  officials: readonly { seatsHeld?: number; playerId?: string; regionId?: string }[],
  regionalSeats: Readonly<Record<string, number>>
): boolean {
  const held: Record<string, number> = {};
  const regions = new Set(Object.keys(regionalSeats));
  for (const row of officials) {
    const seats = row.seatsHeld ?? 1;
    if (!Number.isSafeInteger(seats) || seats < 0 || !row.regionId || !regions.has(row.regionId))
      return false;
    held[row.regionId] = (held[row.regionId] ?? 0) + seats;
    if (held[row.regionId] > regionalSeats[row.regionId]) return false;
  }
  const players = officials.filter((row) => row.playerId && (row.seatsHeld ?? 1) > 0);
  return (
    players.every((row) => (row.seatsHeld ?? 1) === 1) &&
    new Set(players.map((row) => row.playerId)).size === players.length
  );
}
