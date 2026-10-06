import { describe, expect, it } from "vitest";
import {
  approveJapanShugiinReform,
  japanShugiinCurrentChamberCapacity,
  japanShugiinFrozenRegionCapacity,
  isJapanShugiinReformEligible,
  japanShugiinRegionSeats,
  japanShugiinRuleSnapshot,
  JP_SHUGIIN_1994_DISTRICT_SEATS,
  JP_SHUGIIN_1994_LIST_SEATS,
} from "./shugiinElectoralLaw";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "../data/jpShugiinConstituencies1994";

describe("Japan lower-house statutory map and approval gate", () => {
  it("shares one portable eligibility rule for proposal and approval", () => {
    expect(
      isJapanShugiinReformEligible({
        countryId: "JP",
        preset: "1991-default",
        currentYear: 1994,
      })
    ).toBe(true);
    expect(
      isJapanShugiinReformEligible({
        countryId: "JP",
        preset: "1991-default",
        currentYear: 1993,
      })
    ).toBe(false);
    expect(
      approveJapanShugiinReform({
        countryId: "JP",
        preset: "1991-default",
        currentYear: 1993,
        outcome: "approved",
        turn: 576,
        billId: "too-early",
      })
    ).toBeNull();
  });

  it("heals a wrong race total only from a legally valid frozen regional seat split", () => {
    expect(
      japanShugiinFrozenRegionCapacity(
        { law: "sntv-1991-v1", districtSeats: 145, listSeats: 0, totalSeats: 145 },
        "KAN",
        148
      )
    ).toBe(145);
    expect(
      japanShugiinFrozenRegionCapacity(
        { law: "mixed-1994-v1", districtSeats: 85, listSeats: 63, totalSeats: 148 },
        "KAN",
        145
      )
    ).toBe(148);
    expect(
      japanShugiinFrozenRegionCapacity(
        { law: "mixed-1994-v1", districtSeats: 145, listSeats: 0, totalSeats: 145 },
        "KAN",
        145
      )
    ).toBeUndefined();
  });

  it("maps the 1994 mixed chamber to 300 district and 200 regional-list seats", () => {
    const snapshot = japanShugiinRuleSnapshot({
      law: "mixed-1994-v1",
      passedTurn: 576,
      billId: "bill-1994-reform",
    });
    expect(Object.values(JP_SHUGIIN_1994_DISTRICT_SEATS).reduce((a, b) => a + b, 0)).toBe(300);
    expect(Object.values(JP_SHUGIIN_1994_LIST_SEATS).reduce((a, b) => a + b, 0)).toBe(200);
    expect(snapshot).toEqual({
      law: "mixed-1994-v1",
      totalSeats: 500,
      districtSeats: 300,
      listSeats: 200,
    });
    expect(japanShugiinRegionSeats(snapshot, "KAN", "district")).toBe(85);
    expect(japanShugiinRegionSeats(snapshot, "KAN", "list")).toBe(63);
    expect(japanShugiinRegionSeats(snapshot, "unknown", "district")).toBe(0);
    expect(JP_SHUGIIN_1994_CONSTITUENCIES).toHaveLength(300);
    expect(new Set(JP_SHUGIIN_1994_CONSTITUENCIES.map((row) => row.id)).size).toBe(300);
    for (const [regionId, expected] of Object.entries(JP_SHUGIIN_1994_DISTRICT_SEATS)) {
      expect(
        JP_SHUGIIN_1994_CONSTITUENCIES.filter((row) => row.regionId === regionId)
      ).toHaveLength(expected);
    }
    expect(JP_SHUGIIN_1994_CONSTITUENCIES.every((row) => row.statutoryBoundary.length > 0)).toBe(
      true
    );
  });

  it("keeps sitting capacity at 512 until resolved regional snapshots turn over", () => {
    expect(japanShugiinCurrentChamberCapacity()).toBe(512);
    const partial = japanShugiinCurrentChamberCapacity({
      KAN: {
        ruleVersion: "mixed-1994-v1",
        totalSeats: 148,
        districtSeats: 85,
        listSeats: 63,
        electionId: "election-kan",
        cycle: 1,
        resolvedAtTurn: 100,
      },
    });
    expect(partial).toBe(515);
    const full = Object.fromEntries(
      Object.entries(JP_SHUGIIN_1994_DISTRICT_SEATS).map(([regionId, districtSeats]) => [
        regionId,
        {
          ruleVersion: "mixed-1994-v1" as const,
          totalSeats: districtSeats + JP_SHUGIIN_1994_LIST_SEATS[regionId],
          districtSeats,
          listSeats: JP_SHUGIIN_1994_LIST_SEATS[regionId],
          electionId: `election-${regionId}`,
          cycle: 1,
          resolvedAtTurn: 100,
        },
      ])
    );
    expect(japanShugiinCurrentChamberCapacity(full)).toBe(500);
  });

  it("keeps old campaigns at SNTV 512 until an explicit approval", () => {
    const snapshot = japanShugiinRuleSnapshot();
    expect(snapshot).toMatchObject({ law: "sntv-1991-v1", totalSeats: 512 });
    expect(japanShugiinRegionSeats(snapshot, "KAN", "district")).toBe(145);
    expect(japanShugiinRegionSeats(snapshot, "KAN", "list")).toBe(0);
    expect(
      ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"].reduce(
        (sum, regionId) => sum + japanShugiinRegionSeats(snapshot, regionId, "district"),
        0
      )
    ).toBe(512);
    const noChange = (outcome: "rejected" | "delayed") =>
      approveJapanShugiinReform({
        preset: "1991-default",
        countryId: "JP",
        currentYear: 1994,
        outcome,
        turn: 576,
        billId: "bill-1",
      });
    expect(noChange("rejected")).toBeNull();
    expect(noChange("delayed")).toBeNull();
    expect(
      approveJapanShugiinReform({
        preset: "2019-default",
        countryId: "JP",
        currentYear: 1994,
        outcome: "approved",
        turn: 576,
        billId: "bill-1",
      })
    ).toBeNull();
    const mandate = approveJapanShugiinReform({
      preset: "1991-default",
      countryId: "JP",
      currentYear: 1994,
      outcome: "approved",
      turn: 576,
      billId: "bill-1",
    });
    expect(mandate).toEqual({ law: "mixed-1994-v1", passedTurn: 576, billId: "bill-1" });
    expect(
      approveJapanShugiinReform({
        preset: "1991-default",
        countryId: "JP",
        currentYear: 1994,
        outcome: "approved",
        turn: 600,
        billId: "replay",
        current: mandate,
      })
    ).toBe(mandate);
  });
});
