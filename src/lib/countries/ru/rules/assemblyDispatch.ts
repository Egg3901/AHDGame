/**
 * Duma certification waits for all 226 ballots in a frozen cohort to finish.
 * readyRussianDumaCohorts dispatches complete cohorts together; an individual
 * district or list never receives a mandate from the generic election resolver.
 */
export interface RussianDumaDispatchBallot {
  id: string;
  countryId?: string;
  electionType: string;
  status: string;
  endTurn?: number;
  seatId?: string;
  totalSeats?: number;
  binding?: {
    cohortId: string;
    mandateSinceTurn: number;
    tier: "list" | "constituency";
    rootCohortId?: string;
    generation?: number;
  };
}

export function readyRussianDumaCohorts(
  ballots: readonly RussianDumaDispatchBallot[],
  turn: number
): string[] {
  if (!Number.isSafeInteger(turn) || turn < 1) return [];
  const groups = new Map<string, RussianDumaDispatchBallot[]>();
  for (const row of ballots) {
    if (
      row.countryId !== "RU" ||
      row.electionType !== "dumaDeputy" ||
      !row.binding ||
      row.binding.rootCohortId != null ||
      (row.binding.generation ?? 0) !== 0
    )
      continue;
    const group = groups.get(row.binding.cohortId) ?? [];
    group.push(row);
    groups.set(row.binding.cohortId, group);
  }
  return [...groups]
    .filter(([cohortId, rows]) => {
      const mandate = rows[0]?.binding?.mandateSinceTurn;
      const list = rows.filter((row) => row.binding?.tier === "list");
      return (
        /^[a-f0-9]{24}$/.test(cohortId) &&
        Number.isSafeInteger(mandate) &&
        mandate! > 0 &&
        rows.length === 226 &&
        new Set(rows.map((row) => row.id)).size === 226 &&
        new Set(rows.map((row) => row.seatId)).size === 226 &&
        list.length === 1 &&
        list[0].seatId === "RU-duma-national-list" &&
        list[0].totalSeats === 225 &&
        rows.every(
          (row) =>
            !!row.id &&
            !!row.seatId &&
            row.status === "completed" &&
            Number.isSafeInteger(row.endTurn) &&
            row.endTurn! <= turn &&
            row.endTurn! >= mandate! &&
            row.binding?.mandateSinceTurn === mandate &&
            (row.binding?.tier === "list" ||
              (row.binding?.tier === "constituency" && row.totalSeats === 1))
        )
      );
    })
    .map(([id]) => id)
    .sort();
}

export interface RussianDumaDispatchOpening {
  rootCohortId: string;
  cohortId: string;
  generation: number;
  mandateSinceTurn: number;
  electionIds: readonly string[];
  seatIds: readonly string[];
}

/** A repeat may contain any failed subset, but every journal-bound ballot must finish. */
export function readyRussianDumaRepeats(
  ballots: readonly RussianDumaDispatchBallot[],
  openings: readonly RussianDumaDispatchOpening[],
  turn: number
): RussianDumaDispatchOpening[] {
  if (!Number.isSafeInteger(turn) || turn < 1) return [];
  const groups = new Map<string, RussianDumaDispatchBallot[]>();
  for (const row of ballots) {
    if (row.countryId !== "RU" || row.electionType !== "dumaDeputy" || !row.binding?.rootCohortId)
      continue;
    const group = groups.get(row.binding.cohortId) ?? [];
    group.push(row);
    groups.set(row.binding.cohortId, group);
  }
  const duplicateCohorts = new Set(
    openings
      .filter((row, i) => openings.findIndex((other) => other.cohortId === row.cohortId) !== i)
      .map((row) => row.cohortId)
  );
  return openings
    .filter((opening) => {
      const rows = groups.get(opening.cohortId) ?? [];
      const expectedIds = new Set(opening.electionIds);
      const expectedSeats = new Set(opening.seatIds);
      return (
        !duplicateCohorts.has(opening.cohortId) &&
        /^[a-f0-9]{24}$/.test(opening.rootCohortId) &&
        /^[a-f0-9]{24}$/.test(opening.cohortId) &&
        opening.rootCohortId !== opening.cohortId &&
        Number.isSafeInteger(opening.generation) &&
        opening.generation > 0 &&
        Number.isSafeInteger(opening.mandateSinceTurn) &&
        opening.mandateSinceTurn > 0 &&
        expectedIds.size > 0 &&
        expectedIds.size <= 226 &&
        expectedIds.size === opening.electionIds.length &&
        expectedSeats.size === expectedIds.size &&
        expectedSeats.size === opening.seatIds.length &&
        rows.length === expectedIds.size &&
        new Set(rows.map((row) => row.id)).size === expectedIds.size &&
        new Set(rows.map((row) => row.seatId)).size === expectedSeats.size &&
        rows.every(
          (row) =>
            expectedIds.has(row.id) &&
            !!row.seatId &&
            expectedSeats.has(row.seatId) &&
            row.status === "completed" &&
            Number.isSafeInteger(row.endTurn) &&
            row.endTurn! <= turn &&
            row.endTurn! >= opening.mandateSinceTurn &&
            row.binding?.rootCohortId === opening.rootCohortId &&
            row.binding.generation === opening.generation &&
            row.binding.mandateSinceTurn === opening.mandateSinceTurn &&
            (row.binding.tier === "list"
              ? row.seatId === "RU-duma-national-list" && row.totalSeats === 225
              : row.binding.tier === "constituency" &&
                row.seatId !== "RU-duma-national-list" &&
                row.totalSeats === 1)
        )
      );
    })
    .sort((a, b) => a.cohortId.localeCompare(b.cohortId));
}
