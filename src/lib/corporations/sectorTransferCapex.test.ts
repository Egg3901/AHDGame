import { describe, it, expect } from "vitest";
import {
  carveSectorPlantFields,
  hasPlantState,
  identitySectorPlantFields,
  mergeSectorPlantFields,
  type SectorPlantFields,
} from "./sectorTransferCapex";
import type { SectorBuildOrder } from "@/lib/db/types/corporation";

const order = (over: Partial<SectorBuildOrder> = {}): SectorBuildOrder => ({
  unitsOrdered: 100,
  costPaidAnchor: 1_000_000,
  startTurn: 10,
  onlineTurn: 20,
  ...over,
});

const midBuild = (over: Partial<SectorPlantFields> = {}): SectorPlantFields => ({
  capitalStock: 500,
  buildQueue: [order()],
  constructionInProgressAnchor: 1_000_000,
  mothballed: false,
  plantsStartTurn: 5,
  ...over,
});

describe("mergeSectorPlantFields", () => {
  it("sums capacity and CIP and concatenates the queue", () => {
    const merged = mergeSectorPlantFields(
      midBuild(),
      midBuild({
        capitalStock: 250,
        constructionInProgressAnchor: 400_000,
        buildQueue: [order({ costPaidAnchor: 400_000, onlineTurn: 15 })],
      })
    );
    expect(merged.capitalStock).toBe(750);
    expect(merged.constructionInProgressAnchor).toBe(1_400_000);
    expect(merged.buildQueue).toHaveLength(2);
  });

  it("orders the merged queue oldest-landing-first", () => {
    const merged = mergeSectorPlantFields(
      midBuild({ buildQueue: [order({ onlineTurn: 30 })] }),
      midBuild({ buildQueue: [order({ onlineTurn: 12 }), order({ onlineTurn: 21 })] })
    );
    expect(merged.buildQueue.map((o) => o.onlineTurn)).toEqual([12, 21, 30]);
  });

  it("copies costPaidAnchor verbatim — ₳ is never FX-rescaled on transfer", () => {
    // A JPY seller and a USD buyer: revenue is re-denominated by the caller,
    // these fields must not be.
    const merged = mergeSectorPlantFields(
      { capitalStock: 0, buildQueue: [], constructionInProgressAnchor: 0 },
      midBuild({ buildQueue: [order({ costPaidAnchor: 7_654_321 })] })
    );
    expect(merged.buildQueue[0].costPaidAnchor).toBe(7_654_321);
    expect(merged.constructionInProgressAnchor).toBe(1_000_000);
  });

  it("keeps the CIP total equal to the sum of the merged queue", () => {
    const a = midBuild({ constructionInProgressAnchor: 1_000_000 });
    const b = midBuild({
      constructionInProgressAnchor: 250_000,
      buildQueue: [order({ costPaidAnchor: 250_000 })],
    });
    const merged = mergeSectorPlantFields(a, b);
    const queueSum = merged.buildQueue.reduce((s, o) => s + o.costPaidAnchor, 0);
    expect(merged.constructionInProgressAnchor).toBe(queueSum);
  });

  it("mothballs only when BOTH sides are mothballed", () => {
    expect(
      mergeSectorPlantFields(midBuild({ mothballed: true }), midBuild({ mothballed: true }))
        .mothballed
    ).toBe(true);
    expect(
      mergeSectorPlantFields(midBuild({ mothballed: false }), midBuild({ mothballed: true }))
        .mothballed
    ).toBe(false);
    // The reverse direction wakes the survivor up rather than idling the
    // capacity the buyer just paid for.
    expect(
      mergeSectorPlantFields(midBuild({ mothballed: true }), midBuild({ mothballed: false }))
        .mothballed
    ).toBe(false);
  });

  it("keeps the EARLIER plantsStartTurn so the governor ramp does not restart", () => {
    expect(
      mergeSectorPlantFields(midBuild({ plantsStartTurn: 40 }), midBuild({ plantsStartTurn: 9 }))
        .plantsStartTurn
    ).toBe(9);
    expect(
      mergeSectorPlantFields(midBuild({ plantsStartTurn: null }), midBuild({ plantsStartTurn: 33 }))
        .plantsStartTurn
    ).toBe(33);
    expect(
      mergeSectorPlantFields(
        midBuild({ plantsStartTurn: null }),
        midBuild({ plantsStartTurn: null })
      ).plantsStartTurn
    ).toBeNull();
  });

  it("is a safe no-op shape for pre-plants documents", () => {
    expect(mergeSectorPlantFields({}, {})).toEqual({
      capitalStock: 0,
      plantCount: 0,
      plantUnitRemainder: 0,
      capacityBookAnchor: 0,
      buildQueue: [],
      constructionInProgressAnchor: 0,
      mothballed: false,
      plantsStartTurn: null,
      legacyRevenueShadow: null,
    });
  });

  it("conserves a mid-build transfer: nothing is created or destroyed", () => {
    const survivor = midBuild({ capitalStock: 500, constructionInProgressAnchor: 1_000_000 });
    const incoming = midBuild({
      capitalStock: 120,
      constructionInProgressAnchor: 3_300_000,
      buildQueue: [order({ costPaidAnchor: 3_300_000, unitsOrdered: 42, onlineTurn: 25 })],
    });
    const merged = mergeSectorPlantFields(survivor, incoming);
    expect(merged.capitalStock).toBe(620);
    expect(merged.constructionInProgressAnchor).toBe(4_300_000);
    expect(merged.buildQueue.reduce((s, o) => s + o.unitsOrdered, 0)).toBe(142);
  });
});

describe("carveSectorPlantFields", () => {
  it("splits capacity, CIP and both legs of each build order", () => {
    const carved = carveSectorPlantFields(midBuild(), 0.25);
    expect(carved.capitalStock).toBe(125);
    expect(carved.constructionInProgressAnchor).toBe(250_000);
    expect(carved.buildQueue[0].unitsOrdered).toBe(25);
    expect(carved.buildQueue[0].costPaidAnchor).toBe(250_000);
  });

  it("conserves money and units across the split", () => {
    const source = midBuild({ capitalStock: 800, constructionInProgressAnchor: 2_000_000 });
    const f = 0.3;
    const carved = carveSectorPlantFields(source, f);
    const kept = carveSectorPlantFields(source, 1 - f);
    expect(carved.capitalStock + kept.capitalStock).toBeCloseTo(800, 6);
    expect(carved.constructionInProgressAnchor + kept.constructionInProgressAnchor).toBeCloseTo(
      2_000_000,
      6
    );
    expect(carved.buildQueue[0].costPaidAnchor + kept.buildQueue[0].costPaidAnchor).toBeCloseTo(
      1_000_000,
      6
    );
  });

  it("keeps CIP equal to the sum of the carved queue (no refund arbitrage)", () => {
    const carved = carveSectorPlantFields(
      midBuild({
        constructionInProgressAnchor: 1_500_000,
        buildQueue: [order({ costPaidAnchor: 1_000_000 }), order({ costPaidAnchor: 500_000 })],
      }),
      0.4
    );
    expect(carved.buildQueue.reduce((s, o) => s + o.costPaidAnchor, 0)).toBeCloseTo(
      carved.constructionInProgressAnchor,
      6
    );
  });

  it("copies, not splits, plantsStartTurn and mothballed", () => {
    const carved = carveSectorPlantFields(midBuild({ plantsStartTurn: 7, mothballed: true }), 0.5);
    expect(carved.plantsStartTurn).toBe(7);
    expect(carved.mothballed).toBe(true);
  });

  it("clamps the fraction to [0,1]", () => {
    expect(carveSectorPlantFields(midBuild(), 5).capitalStock).toBe(500);
    expect(carveSectorPlantFields(midBuild(), -2).capitalStock).toBe(0);
    expect(carveSectorPlantFields(midBuild(), Number.NaN).capitalStock).toBe(0);
  });
});

describe("hasPlantState", () => {
  it("is false for a pre-plants document and true once anything is stamped", () => {
    expect(hasPlantState({})).toBe(false);
    expect(hasPlantState({ capitalStock: 0, constructionInProgressAnchor: 0 })).toBe(false);
    expect(hasPlantState({ capitalStock: 1 })).toBe(true);
    expect(hasPlantState({ plantsStartTurn: 3 })).toBe(true);
    expect(hasPlantState({ buildQueue: [order()] })).toBe(true);
  });
});

describe("legacyRevenueShadow transfer (D13 restore point)", () => {
  it("sums the restore point on merge", () => {
    const merged = mergeSectorPlantFields(
      midBuild({ legacyRevenueShadow: 1_200_000 }),
      midBuild({ legacyRevenueShadow: 300_000 })
    );
    expect(merged.legacyRevenueShadow).toBe(1_500_000);
  });

  it("keeps the one restore point that exists when only one side has it", () => {
    expect(
      mergeSectorPlantFields(midBuild({ legacyRevenueShadow: 900_000 }), midBuild())
        .legacyRevenueShadow
    ).toBe(900_000);
    expect(mergeSectorPlantFields(midBuild(), midBuild()).legacyRevenueShadow).toBeNull();
  });

  it("splits the restore point on carve so the halves sum to the original", () => {
    const src = midBuild({ legacyRevenueShadow: 1_000_000 });
    const carved = carveSectorPlantFields(src, 0.3);
    const kept = carveSectorPlantFields(src, 0.7);
    expect(carved.legacyRevenueShadow).toBeCloseTo(300_000, 6);
    expect((carved.legacyRevenueShadow ?? 0) + (kept.legacyRevenueShadow ?? 0)).toBeCloseTo(
      1_000_000,
      6
    );
  });
});

describe("identitySectorPlantFields", () => {
  it("round-trips a mothballed survivor — mergeSectorPlantFields(s, {}) does not", () => {
    const survivor = midBuild({ mothballed: true, legacyRevenueShadow: 750_000 });
    // The bug this helper exists for: the AND fold reads `undefined === true`
    // as false and silently wakes a mothballed sector up on a failure path.
    expect(mergeSectorPlantFields(survivor, {}).mothballed).toBe(false);
    expect(identitySectorPlantFields(survivor).mothballed).toBe(true);
  });

  it("leaves every other field exactly as it was", () => {
    const survivor = midBuild({ mothballed: true, legacyRevenueShadow: 750_000 });
    expect(identitySectorPlantFields(survivor)).toEqual({
      capitalStock: 500,
      plantCount: 0,
      plantUnitRemainder: 0,
      capacityBookAnchor: 0,
      buildQueue: survivor.buildQueue,
      constructionInProgressAnchor: 1_000_000,
      mothballed: true,
      plantsStartTurn: 5,
      legacyRevenueShadow: 750_000,
    });
  });
});
