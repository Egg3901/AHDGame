import { describe, expect, it } from "vitest";
import {
  readyRussianDumaCohorts as ready,
  readyRussianDumaRepeats as repeats,
  type RussianDumaDispatchBallot as Ballot,
} from "./assemblyDispatch";
const cohortId = "000000000000000000000001";
function fixture(): Ballot[] {
  return Array.from({ length: 226 }, (_, i) => ({
    id: String(i),
    countryId: "RU",
    electionType: "dumaDeputy",
    status: "completed",
    endTurn: 141,
    seatId: i ? `RU-duma-CEN-${i}` : "RU-duma-national-list",
    totalSeats: i ? 1 : 225,
    binding: { cohortId, mandateSinceTurn: 129, tier: i ? "constituency" : "list" },
  }));
}
describe("Duma cohort dispatch", () => {
  it("waits for every ballot and the closing turn, without imposing an input order", () => {
    const rows = fixture();
    expect(ready(rows.slice(1), 141)).toEqual([]);
    expect(ready(rows, 140)).toEqual([]);
    expect(ready(rows.reverse(), 141)).toEqual([cohortId]);
  });
  it.each(["status", "mandate", "identity", "seat", "tier", "capacity"])(
    "defers a cohort with inconsistent %s",
    (field) => {
      const rows = fixture();
      if (field === "status") rows[1].status = "active";
      if (field === "mandate") rows[1].binding!.mandateSinceTurn = 130;
      if (field === "identity") rows[1].id = rows[2].id;
      if (field === "seat") rows[1].seatId = rows[2].seatId;
      if (field === "tier") rows[1].binding!.tier = "list";
      if (field === "capacity") rows[1].totalSeats = 2;
      expect(ready(rows, 141)).toEqual([]);
    }
  );
  it("ignores unbound and foreign elections without completing a missing district", () => {
    const rows = fixture();
    rows[1].binding = undefined;
    expect(ready(rows, 141)).toEqual([]);
    rows[1] = { ...fixture()[1], countryId: "PL" };
    expect(ready(rows, 141)).toEqual([]);
    expect(ready(fixture(), 0)).toEqual([]);
  });
});

describe("Duma repeat dispatch", () => {
  const rootCohortId = "000000000000000000000002";
  function repeatFixture() {
    const rows = fixture()
      .slice(0, 2)
      .map((row) => ({ ...row, binding: { ...row.binding!, rootCohortId, generation: 1 } }));
    const opening = {
      rootCohortId,
      cohortId,
      generation: 1,
      mandateSinceTurn: 129,
      electionIds: rows.map((row) => row.id),
      seatIds: rows.map((row) => row.seatId!),
    };
    return { rows, opening };
  }
  it("dispatches exactly a journal-bound failed subset at its closing turn", () => {
    const { rows, opening } = repeatFixture();
    expect(repeats(rows, [opening], 140)).toEqual([]);
    expect(repeats(rows.reverse(), [opening], 141)).toEqual([opening]);
    expect(ready(rows, 141)).toEqual([]);
    expect(
      ready(
        fixture().map((row) => ({
          ...row,
          binding: { ...row.binding!, rootCohortId, generation: 1 },
        })),
        141
      )
    ).toEqual([]);
  });
  it("defers missing, extra and duplicated replacements", () => {
    const { rows, opening } = repeatFixture();
    expect(repeats(rows.slice(1), [opening], 141)).toEqual([]);
    expect(repeats([...rows, rows[0]], [opening], 141)).toEqual([]);
    expect(repeats(rows, [opening, opening], 141)).toEqual([]);
    expect(
      repeats(
        rows,
        [{ ...opening, electionIds: [...opening.electionIds, opening.electionIds[0]] }],
        141
      )
    ).toEqual([]);
  });
  it.each(["generation", "root", "seat", "capacity", "status", "identity"])(
    "defers inconsistent %s",
    (field) => {
      const { rows, opening } = repeatFixture();
      if (field === "generation") rows[0].binding!.generation = 2;
      if (field === "root") rows[0].binding!.rootCohortId = cohortId;
      if (field === "seat") rows[0].seatId = "unknown";
      if (field === "capacity") rows[0].totalSeats = 1;
      if (field === "status") rows[0].status = "active";
      if (field === "identity") rows[0].id = "unknown";
      expect(repeats(rows, [opening], 141)).toEqual([]);
    }
  );
});
