import { describe, expect, it } from "vitest";
import { bgBalancedDistrictLists } from "./districtListAllocation";
import { BG_1991_ELECTORAL_DISTRICTS } from "../data/electoralDistricts1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

describe("Bulgarian national and district mandate conservation", () => {
  it("moves an earlier choice to keep a supported constrained party represented", () => {
    expect(
      bgBalancedDistrictLists(
        [
          { id: "1", seats: 1, partyVotes: { A: 100, B: 99 } },
          { id: "2", seats: 1, partyVotes: { A: 1 } },
        ],
        { A: 1, B: 1 }
      )
    ).toEqual({ kind: "allocated", seatsByDistrict: { "1": { A: 0, B: 1 }, "2": { A: 1, B: 0 } } });
  });
  it("defers a national quota that cannot be assigned to a supported district list", () => {
    expect(
      bgBalancedDistrictLists(
        [
          { id: "1", seats: 1, partyVotes: { A: 100, B: 99 } },
          { id: "2", seats: 1, partyVotes: {} },
        ],
        { A: 1, B: 1 }
      )
    ).toEqual({ kind: "deferred", reason: "insufficient-district-list-support" });
  });
  it("conserves all31 district capacities and the historical national quotas", () => {
    const seats = apportionSeats(
      240,
      Object.fromEntries(BG_1991_ELECTORAL_DISTRICTS.map((row) => [row.id, row.population]))
    );
    const ballots = BG_1991_ELECTORAL_DISTRICTS.map((row) => ({
      id: row.id,
      seats: seats[row.id],
      partyVotes: {
        UDF: Math.round(row.population * 0.3436),
        BSP: Math.round(row.population * 0.3314),
        MRF: Math.round(row.population * 0.0755),
      },
    }));
    const result = bgBalancedDistrictLists(ballots, { UDF: 110, BSP: 106, MRF: 24 });
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Fixture has complete district support");
    const totals: Record<string, number> = { UDF: 0, BSP: 0, MRF: 0 };
    for (const row of ballots) {
      const district = result.seatsByDistrict[row.id];
      expect(Object.values(district).reduce((sum, seats) => sum + seats, 0)).toBe(row.seats);
      for (const [party, seats] of Object.entries(district)) totals[party] += seats;
    }
    expect(totals).toEqual({ UDF: 110, BSP: 106, MRF: 24 });
    expect(
      bgBalancedDistrictLists([...ballots].reverse(), { MRF: 24, BSP: 106, UDF: 110 })
    ).toEqual(result);
  });
  it.each([
    [[{ id: "1", seats: 2, partyVotes: { A: 1 } }], { A: 1 }],
    [[{ id: "1", seats: 1, partyVotes: { A: -1 } }], { A: 1 }],
    [
      [
        { id: "1", seats: 1, partyVotes: { A: 1 } },
        { id: "1", seats: 1, partyVotes: { A: 1 } },
      ],
      { A: 2 },
    ],
  ] as const)(
    "rejects malformed accounting instead of changing national quotas",
    (ballots, quotas) => {
      expect(() => bgBalancedDistrictLists(ballots, quotas)).toThrow();
    }
  );
});
