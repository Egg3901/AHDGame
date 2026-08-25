import { describe, it, expect } from "vitest";
import { selectNppPledges, pledgeFitForParty } from "./nppManifesto";
import { UK_PLEDGE_CATALOG, getPledgeCatalogEntry } from "./pledgeCatalog";

describe("pledgeFitForParty", () => {
  it("scores an aligned pledge above a misaligned one", () => {
    const nhs = getPledgeCatalogEntry("uk.nhs.universal")!; // left-econ position
    const left = pledgeFitForParty(nhs, -4, -1);
    const right = pledgeFitForParty(nhs, 4, 1);
    expect(left).toBeGreaterThan(right);
  });
});

describe("selectNppPledges", () => {
  it("picks 3 distinct pledges by default", () => {
    const picks = selectNppPledges(UK_PLEDGE_CATALOG, -3, -1);
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
  });

  it("a left-wing party favours left-wing pledges", () => {
    const picks = selectNppPledges(UK_PLEDGE_CATALOG, -4, -1);
    // Sound money / fiscal discipline is a right-wing pledge; a left party should not pick it first.
    expect(picks).not.toContain("uk.economy.soundMoney");
    expect(picks).toContain("uk.nhs.universal");
  });

  it("a right-wing party favours right-wing pledges", () => {
    const picks = selectNppPledges(UK_PLEDGE_CATALOG, 3, 1);
    expect(picks).toContain("uk.economy.soundMoney");
  });

  it("is deterministic (stable tie-break)", () => {
    expect(selectNppPledges(UK_PLEDGE_CATALOG, 0, 0)).toEqual(
      selectNppPledges(UK_PLEDGE_CATALOG, 0, 0)
    );
  });

  it("respects a custom count and never exceeds the catalog", () => {
    expect(selectNppPledges(UK_PLEDGE_CATALOG, 0, 0, 2)).toHaveLength(2);
    expect(selectNppPledges(UK_PLEDGE_CATALOG, 0, 0, 999)).toHaveLength(UK_PLEDGE_CATALOG.length);
  });
});
