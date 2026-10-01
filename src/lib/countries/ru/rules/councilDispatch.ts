/**
 * Council certification waits for every journal-bound subject poll to finish.
 * readyRussianCouncilCohorts requires the complete first89-subject family;
 * readyRussianCouncilRepeats accepts only a complete bound failed-subject subset.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
const districts = new Map(
  RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , regionId]) => [
    `RU-council-${number}`,
    { number, regionId },
  ])
);
const validId = (id: string) => /^[a-f0-9]{24}$/.test(id);
export interface RussianCouncilDispatchBallot {
  id: string;
  countryId?: string;
  electionType: string;
  status: string;
  state?: string;
  seatId?: string;
  totalSeats?: number;
  endTurn?: number;
  binding?: {
    cohortId: string;
    mandateSinceTurn: number;
    districtNumber: number;
    rootCohortId?: string;
    generation?: number;
  };
}
export interface RussianCouncilDispatchOpening {
  rootCohortId: string;
  cohortId: string;
  generation: number;
  mandateSinceTurn: number;
  electionIds: readonly string[];
  seatIds: readonly string[];
}
function readyBallot(row: RussianCouncilDispatchBallot, mandate: number, turn: number) {
  const district = districts.get(row.seatId ?? "");
  return (
    validId(row.id) &&
    row.countryId === "RU" &&
    row.electionType === "federationCouncilMember" &&
    row.status === "completed" &&
    row.totalSeats === 2 &&
    !!district &&
    row.state === district.regionId &&
    row.binding?.districtNumber === district.number &&
    row.binding.mandateSinceTurn === mandate &&
    Number.isSafeInteger(row.endTurn) &&
    row.endTurn! >= mandate &&
    row.endTurn! <= turn
  );
}
export function readyRussianCouncilCohorts(
  ballots: readonly RussianCouncilDispatchBallot[],
  turn: number
): string[] {
  if (!Number.isSafeInteger(turn) || turn < 1) return [];
  const groups = new Map<string, RussianCouncilDispatchBallot[]>();
  for (const row of ballots) {
    if (
      row.countryId !== "RU" ||
      row.electionType !== "federationCouncilMember" ||
      !row.binding ||
      row.binding.rootCohortId != null ||
      (row.binding.generation ?? 0) !== 0
    )
      continue;
    const rows = groups.get(row.binding.cohortId) ?? [];
    rows.push(row);
    groups.set(row.binding.cohortId, rows);
  }
  return [...groups]
    .filter(([id, rows]) => {
      const mandate = rows[0].binding!.mandateSinceTurn;
      return (
        validId(id) &&
        Number.isSafeInteger(mandate) &&
        mandate > 0 &&
        rows.length === 89 &&
        new Set(rows.map((row) => row.id)).size === 89 &&
        new Set(rows.map((row) => row.seatId)).size === 89 &&
        rows.every((row) => readyBallot(row, mandate, turn))
      );
    })
    .map(([id]) => id)
    .sort();
}
export function readyRussianCouncilRepeats(
  ballots: readonly RussianCouncilDispatchBallot[],
  openings: readonly RussianCouncilDispatchOpening[],
  turn: number
) {
  if (!Number.isSafeInteger(turn) || turn < 1) return [];
  const groups = new Map<string, RussianCouncilDispatchBallot[]>();
  for (const row of ballots) {
    if (
      !row.binding?.rootCohortId ||
      row.countryId !== "RU" ||
      row.electionType !== "federationCouncilMember"
    )
      continue;
    const rows = groups.get(row.binding.cohortId) ?? [];
    rows.push(row);
    groups.set(row.binding.cohortId, rows);
  }
  const duplicate = new Set(
    openings
      .filter(
        (row, index) => openings.findIndex((other) => other.cohortId === row.cohortId) !== index
      )
      .map((row) => row.cohortId)
  );
  return openings
    .filter((opening) => {
      const rows = groups.get(opening.cohortId) ?? [];
      const expected = new Map(
        opening.electionIds.map((id, index) => [id, opening.seatIds[index]])
      );
      return (
        !duplicate.has(opening.cohortId) &&
        validId(opening.rootCohortId) &&
        validId(opening.cohortId) &&
        opening.rootCohortId !== opening.cohortId &&
        Number.isSafeInteger(opening.generation) &&
        opening.generation > 0 &&
        Number.isSafeInteger(opening.mandateSinceTurn) &&
        opening.mandateSinceTurn > 0 &&
        expected.size > 0 &&
        expected.size <= 89 &&
        expected.size === opening.electionIds.length &&
        opening.seatIds.length === expected.size &&
        new Set(opening.seatIds).size === expected.size &&
        rows.length === expected.size &&
        new Set(rows.map((row) => row.id)).size === expected.size &&
        rows.every(
          (row) =>
            expected.get(row.id) === row.seatId &&
            readyBallot(row, opening.mandateSinceTurn, turn) &&
            row.binding?.rootCohortId === opening.rootCohortId &&
            row.binding?.generation === opening.generation
        )
      );
    })
    .sort((a, b) => a.cohortId.localeCompare(b.cohortId));
}
