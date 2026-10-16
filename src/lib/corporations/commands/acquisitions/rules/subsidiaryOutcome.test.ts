import { describe, expect, it } from "vitest";
import {
  acquisitionOutcomeOf,
  holdsWholeCapTable,
  subsidiaryAcquisitionBlock,
  wholeCorporationPosition,
  type SubsidiaryAcquisitionFacts,
} from "./subsidiaryOutcome";

const clean: SubsidiaryAcquisitionFacts = {
  featureEnabled: true,
  acquirerStateOwned: false,
  acquirerIsFormalizedSubsidiary: false,
  targetStateOwned: false,
  targetHasOtherControllingParent: false,
  targetIsFormalizedSubsidiary: false,
  targetControlsOtherCorporations: false,
  wouldCreateOwnershipCycle: false,
  ceoConflict: null,
};

describe("acquisitionOutcomeOf", () => {
  it("reads legacy offers, which carry no outcome, as a merge", () => {
    expect(acquisitionOutcomeOf({})).toBe("merge");
    expect(acquisitionOutcomeOf({ outcome: "merge" })).toBe("merge");
    expect(acquisitionOutcomeOf({ outcome: "subsidiary" })).toBe("subsidiary");
  });
});

describe("subsidiaryAcquisitionBlock", () => {
  it("allows a clean acquisition", () => {
    expect(subsidiaryAcquisitionBlock(clean)).toBeNull();
  });

  it.each([
    ["feature off", { featureEnabled: false }, 400, /not enabled/],
    ["state-owned acquirer", { acquirerStateOwned: true }, 403, /cannot act as a parent/],
    [
      "acquirer already a subsidiary",
      { acquirerIsFormalizedSubsidiary: true },
      403,
      /cannot act as a parent/,
    ],
    ["state-owned target", { targetStateOwned: true }, 400, /National corporations/],
    [
      "target owned by another corporation",
      { targetHasOtherControllingParent: true },
      400,
      /already controlled/,
    ],
    [
      "target already formalized",
      { targetIsFormalizedSubsidiary: true },
      400,
      /already a formalized/,
    ],
    ["target is itself a parent", { targetControlsOtherCorporations: true }, 400, /chained/],
    ["ownership cycle", { wouldCreateOwnershipCycle: true }, 400, /circular/],
    ["sibling CEO", { ceoConflict: "sibling" as const }, 400, /another of your subsidiaries/],
    ["parent CEO", { ceoConflict: "parent" as const }, 400, /different player than the parent/],
  ])("refuses: %s", (_name, patch, status, message) => {
    const block = subsidiaryAcquisitionBlock({ ...clean, ...patch });
    expect(block?.status).toBe(status);
    expect(block?.error).toMatch(message);
  });

  it("reports the feature gate before any structural reason", () => {
    const block = subsidiaryAcquisitionBlock({
      ...clean,
      featureEnabled: false,
      wouldCreateOwnershipCycle: true,
    });
    expect(block?.error).toMatch(/not enabled/);
  });

  it("never uses dashes in player-facing copy", () => {
    const patches: Array<Partial<SubsidiaryAcquisitionFacts>> = [
      { featureEnabled: false },
      { acquirerStateOwned: true },
      { targetStateOwned: true },
      { targetHasOtherControllingParent: true },
      { targetIsFormalizedSubsidiary: true },
      { targetControlsOtherCorporations: true },
      { wouldCreateOwnershipCycle: true },
      { ceoConflict: "sibling" },
      { ceoConflict: "parent" },
    ];
    for (const patch of patches) {
      const error = subsidiaryAcquisitionBlock({ ...clean, ...patch })?.error ?? "";
      expect(error).not.toMatch(/[–—]/);
    }
  });
});

describe("wholeCorporationPosition", () => {
  it("spreads the price over every share as cost basis", () => {
    expect(wholeCorporationPosition({ totalShares: 1000, priceAnchor: 2_000_000 })).toEqual({
      shares: 1000,
      avgCostPerShare: 2000,
    });
  });

  it("is safe on an empty or fractional share count", () => {
    expect(wholeCorporationPosition({ totalShares: 0, priceAnchor: 5 })).toEqual({
      shares: 0,
      avgCostPerShare: 0,
    });
    expect(wholeCorporationPosition({ totalShares: 10.9, priceAnchor: 100 }).shares).toBe(10);
  });
});

describe("holdsWholeCapTable", () => {
  const id = (s: string) => ({ toString: () => s });
  it("is true only for one corporate holder with every share", () => {
    expect(holdsWholeCapTable([{ corporationId: id("a"), shares: 100 }], "a", 100)).toBe(true);
    expect(
      holdsWholeCapTable(
        [
          { corporationId: id("a"), shares: 99 },
          { corporationId: id("b"), shares: 1 },
        ],
        "a",
        100
      )
    ).toBe(false);
    expect(holdsWholeCapTable([{ corporationId: id("b"), shares: 100 }], "a", 100)).toBe(false);
    expect(holdsWholeCapTable([{ corporationId: id("a"), shares: 60 }], "a", 100)).toBe(false);
  });

  it("ignores zero-share rows left behind by earlier trading", () => {
    expect(
      holdsWholeCapTable(
        [
          { corporationId: id("a"), shares: 100 },
          { corporationId: id("z"), shares: 0 },
        ],
        "a",
        100
      )
    ).toBe(true);
  });
});
