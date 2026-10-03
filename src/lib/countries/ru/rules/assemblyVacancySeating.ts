/**
 * Assembly vacancy winners take office without replacing held mandates.
 * planRussianAssemblyVacancySeating adds eligible winners and atomically moves
 * a successful player from their list seat to a repeat constituency mandate.
 */
import type { RussianAssemblySeat } from "./assemblySeating";
import type { RussianAssemblyVacancyReason } from "./assemblyOwnerEligibility";
export function planRussianAssemblyVacancySeating(input: {
  certified: readonly RussianAssemblySeat[];
  current: readonly (RussianAssemblySeat & { nominationParty?: string })[];
  previouslySeatedCandidateIds: readonly string[];
  deferredListIncreases?: Readonly<Record<string, number>>;
  unavailableOwners: readonly {
    ownerId: string;
    isNpc: boolean;
    reason: RussianAssemblyVacancyReason;
  }[];
}) {
  const desired = new Map(input.certified.map((row) => [row.candidateId, row]));
  const current = new Map(input.current.map((row) => [row.candidateId, row]));
  const ended = new Set(input.previouslySeatedCandidateIds);
  const unavailable = new Map(
    input.unavailableOwners.map((row) => [
      `${row.isNpc ? "npc" : "player"}:${row.ownerId}`,
      row.reason,
    ])
  );
  if (
    desired.size !== input.certified.length ||
    current.size !== input.current.length ||
    unavailable.size !== input.unavailableOwners.length
  )
    throw new Error("Assembly vacancy seating needs unique mandate and owner identities");
  const retire: RussianAssemblySeat[] = [];
  const increases: Record<string, number> = {};
  const deferredListIncreases: Record<string, number> = {};
  for (const [candidateId, count] of Object.entries(input.deferredListIncreases ?? {})) {
    const held = current.get(candidateId);
    if (
      !held?.isNpc ||
      held.officeType !== "dumaDeputy" ||
      held.seatSource !== "list" ||
      !Number.isSafeInteger(count) ||
      count < 1
    )
      throw new Error("Deferred list allocations need a held NPC list mandate");
    const party = held.nominationParty ?? held.party;
    increases[party] = (increases[party] ?? 0) + count;
  }
  for (const old of input.current) {
    const next = desired.get(old.candidateId);
    if (!next) {
      const move =
        !old.isNpc &&
        old.officeType === "dumaDeputy" &&
        old.seatSource === "list" &&
        input.certified.some(
          (row) =>
            !row.isNpc &&
            row.ownerId === old.ownerId &&
            row.officeType === "dumaDeputy" &&
            row.seatSource === "direct"
        );
      if (!move) throw new Error("A held Assembly mandate changed without a constituency election");
      retire.push(old);
      const party = old.nominationParty ?? old.party;
      increases[party] = (increases[party] ?? 0) + old.seatsHeld;
    } else if (
      old.ownerId !== next.ownerId ||
      old.isNpc !== next.isNpc ||
      old.officeType !== next.officeType ||
      old.seatId !== next.seatId ||
      old.electionId !== next.electionId ||
      old.seatSource !== next.seatSource
    )
      throw new Error("A held Assembly mandate identity changed");
  }
  const insert: RussianAssemblySeat[] = [];
  const update: RussianAssemblySeat[] = [];
  const vacancies: Array<
    RussianAssemblySeat & { reason: RussianAssemblyVacancyReason | "ended-mandate" }
  > = [];
  for (const next of input.certified) {
    const old = current.get(next.candidateId);
    const reason = unavailable.get(`${next.isNpc ? "npc" : "player"}:${next.ownerId}`);
    if (old) {
      const change = next.seatsHeld - old.seatsHeld;
      if (!change) continue;
      if (
        !next.isNpc ||
        next.officeType !== "dumaDeputy" ||
        next.seatSource !== "list" ||
        change < 0 ||
        change > (increases[next.party] ?? 0)
      )
        throw new Error("Held Assembly seat weight changed outside a player list transfer");
      increases[next.party] -= change;
      if (reason) {
        vacancies.push({ ...next, seatsHeld: change, reason });
        deferredListIncreases[next.candidateId] = change;
      } else update.push({ ...old, seatsHeld: next.seatsHeld });
    } else if (ended.has(next.candidateId)) vacancies.push({ ...next, reason: "ended-mandate" });
    else if (reason) vacancies.push({ ...next, reason });
    else insert.push(next);
  }
  const retiredIds = new Set(retire.map((row) => row.candidateId));
  const updated = new Map(update.map((row) => [row.candidateId, row]));
  const seated = [
    ...input.current
      .filter((row) => !retiredIds.has(row.candidateId))
      .map((row) => updated.get(row.candidateId) ?? row),
    ...insert,
  ];
  const players = seated.filter((row) => !row.isNpc);
  if (
    players.some((row) => row.seatsHeld !== 1) ||
    new Set(players.map((row) => row.ownerId)).size !== players.length
  )
    throw new Error("Assembly vacancy seating duplicates a player's mandate");
  const chambers = new Map<string, string>();
  const seatsByParty: Record<string, number> = {};
  let dumaSeats = 0,
    councilSeats = 0;
  for (const row of seated) {
    if (!Number.isSafeInteger(row.seatsHeld) || row.seatsHeld < 1)
      throw new Error("Assembly vacancy seating needs positive safe mandates");
    const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    if (chambers.has(key) && chambers.get(key) !== row.officeType)
      throw new Error("Assembly vacancy seating overlaps chamber profiles");
    chambers.set(key, row.officeType);
    if (row.officeType === "dumaDeputy") {
      dumaSeats += row.seatsHeld;
      seatsByParty[row.party] = (seatsByParty[row.party] ?? 0) + row.seatsHeld;
    } else councilSeats += row.seatsHeld;
  }
  if (dumaSeats > 450 || councilSeats > 178)
    throw new Error("Assembly vacancy seating exceeds chamber capacities");
  return {
    deferredListIncreases,
    insert,
    update,
    retire,
    seated,
    vacancies,
    seatsByParty,
    dumaSeats,
    councilSeats,
    dumaVacancies: 450 - dumaSeats,
    councilVacancies: 178 - councilSeats,
  };
}
