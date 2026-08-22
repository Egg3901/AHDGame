import { describe, expect, it } from "vitest";
import { marketShareExplainer, pendingBuildUnits } from "./marketShareExplainer";

describe("marketShareExplainer (ticket #1155)", () => {
  it("explains a 100% sole-producer pie as share of current sales, not a demand cap", () => {
    const copy = marketShareExplainer({
      marketShare: 100,
      competitorCount: 0,
      unownedPercent: 0,
      demandGapUnits: 12_000,
      pendingBuildUnits: 60_000,
    });
    expect(copy).toContain("only producer here right now");
    expect(copy).toContain("not a cap on demand");
    expect(copy).toContain("Capacity still being built does not count");
    expect(copy).toContain("12,000 more units a day");
  });

  it("warns that extra output goes unsold when buyers have no room", () => {
    const copy = marketShareExplainer({
      marketShare: 100,
      competitorCount: 0,
      unownedPercent: 0,
      demandGapUnits: 0,
    });
    expect(copy).toContain("already taking all they need");
    expect(copy).not.toContain("Capacity still being built");
  });

  it("stays silent when the unowned wedge is still on the pie", () => {
    expect(
      marketShareExplainer({
        marketShare: 40,
        competitorCount: 0,
        unownedPercent: 60,
      })
    ).toBeNull();
  });

  it("stays silent when other producers share the cell", () => {
    expect(
      marketShareExplainer({
        marketShare: 100,
        competitorCount: 2,
        unownedPercent: 0,
      })
    ).toBeNull();
  });
});

describe("pendingBuildUnits", () => {
  it("sums undelivered queue units", () => {
    expect(
      pendingBuildUnits([
        { unitsOrdered: 90_000, unitsDelivered: 30_000 },
        { unitsOrdered: 12_000, unitsDelivered: 12_000 },
      ])
    ).toBe(60_000);
  });

  it("treats an empty queue as nothing pending", () => {
    expect(pendingBuildUnits([])).toBe(0);
    expect(pendingBuildUnits(undefined)).toBe(0);
  });
});
