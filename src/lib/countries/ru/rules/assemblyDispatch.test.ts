import { describe, expect, it } from "vitest";
import {
  readyRussianDumaCohorts as ready,
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
