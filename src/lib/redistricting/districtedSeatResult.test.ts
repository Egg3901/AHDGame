import { describe, it, expect } from "vitest";
import { buildNomineesByParty, buildSeatResult } from "./districtedSeatResult";

describe("buildNomineesByParty", () => {
  it("uses primary shares when available", () => {
    const out = buildNomineesByParty(
      { x: "DEM", y: "DEM", z: "GOP" },
      { x: 10, y: 10, z: 10 },
      { x: 66.7, y: 33.3, z: 100 }
    );
    expect(out.DEM.map((n) => n.candidateId).sort()).toEqual(["x", "y"]);
    expect(out.DEM.find((n) => n.candidateId === "x")!.sharePct).toBeCloseTo(66.7, 1);
    expect(out.GOP).toEqual([{ candidateId: "z", sharePct: 100 }]);
  });

  it("falls back to statewide vote share within party when no primary shares", () => {
    const out = buildNomineesByParty({ x: "DEM", y: "DEM" }, { x: 75, y: 25 }, null);
    expect(out.DEM.find((n) => n.candidateId === "x")!.sharePct).toBeCloseTo(75, 5);
    expect(out.DEM.find((n) => n.candidateId === "y")!.sharePct).toBeCloseTo(25, 5);
  });
});

describe("buildSeatResult", () => {
  it("aggregates district wins per candidate into the SeatAllocationResult shape", () => {
    const assignment = new Map<number, string>([
      [1, "x"],
      [2, "x"],
      [3, "z"],
    ]);
    const res = buildSeatResult(assignment, ["x", "y", "z"], 3);
    expect(res.isMultiSeat).toBe(true);
    expect(res.authoritativeSeats).toBe(3);
    expect(res.seatsEstimate).toEqual({ x: 2, z: 1 });
    expect(res.winners.sort()).toEqual(
      (
        [
          ["x", 2],
          ["z", 1],
        ] as [string, number][]
      ).sort()
    );
    expect(res.losers).toEqual(["y"]);
  });
});
