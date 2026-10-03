/**
 * Hungarian modern party mandates belong to individual player deputies and
 * bounded NPC delegations. A player can occupy at most one mandate; missing
 * viable NPC capacity leaves the result pending instead of inventing a person.
 */
import { apportionSeats } from "@/lib/country/seatApportionment";
export function allocateHuModernPeople(input: {
  quotas: Readonly<Record<string, number>>;
  people: ReadonlyArray<{ id: string; partyId: string; votes: number; isNpc: boolean }>;
}): Record<string, number> | null {
  if (
    new Set(input.people.map((row) => row.id)).size !== input.people.length ||
    input.people.some(
      (row) => !row.id || !row.partyId || !Number.isSafeInteger(row.votes) || row.votes < 0
    ) ||
    Object.values(input.quotas).some(
      (seats) => !Number.isSafeInteger(seats) || seats < 0 || seats > 199
    )
  )
    throw new Error("Invalid modern Hungarian person allocation");
  const allocation = Object.fromEntries(input.people.map((row) => [row.id, 0]));
  for (const [party, quota] of Object.entries(input.quotas)) {
    let remaining = quota;
    let pool = input.people.filter((row) => row.partyId === party && row.votes > 0);
    while (remaining > 0 && pool.length > 0) {
      const proposed = apportionSeats(
        Object.fromEntries(pool.map((row) => [row.id, row.votes])),
        remaining
      );
      let assigned = 0;
      for (const row of pool) {
        const seats = row.isNpc ? proposed[row.id] : Math.min(1, proposed[row.id]);
        allocation[row.id] += seats;
        assigned += seats;
      }
      remaining -= assigned;
      pool = pool.filter((row) => row.isNpc || allocation[row.id] === 0);
      if (assigned === 0) break;
    }
    if (remaining !== 0) return null;
  }
  return allocation;
}
