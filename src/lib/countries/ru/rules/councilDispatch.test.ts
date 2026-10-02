import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import {
  readyRussianCouncilCohorts as first,
  readyRussianCouncilRepeats as repeat,
  type RussianCouncilDispatchBallot,
} from "./councilDispatch";
const root = "a".repeat(24);
const next = "b".repeat(24);
function cohort(): RussianCouncilDispatchBallot[] {
  return RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , state]) => ({
    id: number.toString(16).padStart(24, "0"),
    countryId: "RU",
    electionType: "federationCouncilMember",
    status: "completed",
    state,
    seatId: `RU-council-${number}`,
    totalSeats: 2,
    endTurn: 141,
    binding: { cohortId: root, mandateSinceTurn: 129, districtNumber: number },
  }));
}
describe("Council generation dispatch", () => {
  it("requires all89 first polls and does not mutate their input", () => {
    const rows = cohort();
    const before = structuredClone(rows);
    expect(first(rows, 141)).toEqual([root]);
    expect(rows).toEqual(before);
    expect(first(rows.slice(1), 141)).toEqual([]);
  });
  it.each([
    "future",
    "duplicate-id",
    "duplicate-subject",
    "region",
    "number",
    "capacity",
    "mandate",
    "foreign",
    "repeated",
  ])("defers malformed first %s", (defect) => {
    const rows = cohort();
    const row = rows[0];
    if (defect === "future") row.endTurn = 142;
    if (defect === "duplicate-id") row.id = rows[1].id;
    if (defect === "duplicate-subject") row.seatId = rows[1].seatId;
    if (defect === "region") row.state = "CEN";
    if (defect === "number") row.binding!.districtNumber = 2;
    if (defect === "capacity") row.totalSeats = 1;
    if (defect === "mandate") row.binding!.mandateSinceTurn = 130;
    if (defect === "foreign") row.countryId = "CZ";
    if (defect === "repeated") row.binding!.rootCohortId = root;
    expect(first(rows, 141)).toEqual([]);
  });
  it("accepts only a complete journal-bound repeat subset with exact subject pairing", () => {
    const rows = cohort()
      .slice(0, 2)
      .map((row) => ({
        ...row,
        binding: { ...row.binding!, cohortId: next, rootCohortId: root, generation: 1 },
      }));
    const opening = {
      rootCohortId: root,
      cohortId: next,
      generation: 1,
      mandateSinceTurn: 129,
      electionIds: rows.map((row) => row.id),
      seatIds: rows.map((row) => row.seatId!),
    };
    expect(repeat(rows, [opening], 141)).toEqual([opening]);
    expect(repeat(rows.slice(1), [opening], 141)).toEqual([]);
    expect(repeat(rows, [opening, opening], 141)).toEqual([]);
    expect(repeat(rows, [{ ...opening, seatIds: [...opening.seatIds].reverse() }], 141)).toEqual(
      []
    );
    expect(repeat(rows, [{ ...opening, generation: 2 }], 141)).toEqual([]);
    expect(first(rows, 141)).toEqual([]);
  });
  it("rejects invalid dispatch time", () => {
    expect(first(cohort(), 0)).toEqual([]);
    expect(repeat([], [], NaN)).toEqual([]);
  });
});
