/**
 * Regional Council changes preserve held mandates, party choices and ended seats.
 * planRussianCouncilCompositionDelta replaces only changed regional people and
 * never recreates an ended mandate under the same authority identity.
 */
import type { planRussianCouncilComposition } from "./councilComposition";
export type RussianRegionalCouncilSeat = ReturnType<
  typeof planRussianCouncilComposition
>["seats"][number];
export function planRussianCouncilCompositionDelta(input: {
  desired: readonly RussianRegionalCouncilSeat[];
  previous: readonly RussianRegionalCouncilSeat[];
  held: readonly RussianRegionalCouncilSeat[];
  endedPersonIds: readonly string[];
  newLaw: boolean;
}) {
  const key = (row: RussianRegionalCouncilSeat) => `${row.subjectId}:${row.branch}`;
  for (const family of [input.desired, input.previous, input.held]) {
    if (
      new Set(family.map((row) => row.personId)).size !== family.length ||
      new Set(family.map(key)).size !== family.length
    )
      throw new Error("Council delta needs unique individual and regional slots");
  }
  const previous = new Map(input.previous.map((row) => [row.personId, row]));
  const held = new Map(input.held.map((row) => [row.personId, row]));
  const ended = new Set(input.endedPersonIds);
  for (const row of input.held) {
    const proof = previous.get(row.personId);
    if (
      !proof ||
      proof.ownerId !== row.ownerId ||
      proof.isNpc !== row.isNpc ||
      key(proof) !== key(row) ||
      proof.authorityRevision !== row.authorityRevision ||
      proof.termEndTurn !== row.termEndTurn
    )
      throw new Error("Council member lacks its actual predecessor mandate");
  }
  for (const row of input.previous) if (!held.has(row.personId)) ended.add(row.personId);
  const seated: RussianRegionalCouncilSeat[] = [],
    insert: RussianRegionalCouncilSeat[] = [];
  for (const row of input.desired) {
    const existing = held.get(row.personId);
    if (existing && !input.newLaw) {
      if (
        existing.ownerId !== row.ownerId ||
        existing.isNpc !== row.isNpc ||
        existing.authorityRevision !== row.authorityRevision ||
        existing.termEndTurn !== row.termEndTurn ||
        key(existing) !== key(row)
      )
        throw new Error("A held Council mandate cannot be silently redefined");
      seated.push(existing);
    } else if (!ended.has(row.personId)) {
      seated.push(row);
      insert.push(row);
    }
  }
  const retained = new Set(seated.map((row) => row.personId));
  const retire = input.held.filter((row) => input.newLaw || !retained.has(row.personId));
  for (const row of retire) ended.add(row.personId);
  return {
    seated,
    insert,
    retire,
    endedPersonIds: [...ended].sort(),
    viable: seated.length >= 90,
    vacancies: 178 - seated.length,
    seatsByParty: seated.reduce<Record<string, number>>((total, row) => {
      total[row.party] = (total[row.party] ?? 0) + 1;
      return total;
    }, {}),
  };
}
