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
  binding?: { cohortId: string; mandateSinceTurn: number; tier: "list" | "constituency" };
}

export function readyRussianDumaCohorts(
  ballots: readonly RussianDumaDispatchBallot[],
  turn: number
): string[] {
  if (!Number.isSafeInteger(turn) || turn < 1) return [];
  const groups = new Map<string, RussianDumaDispatchBallot[]>();
  for (const row of ballots) {
    if (row.countryId !== "RU" || row.electionType !== "dumaDeputy" || !row.binding) continue;
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
