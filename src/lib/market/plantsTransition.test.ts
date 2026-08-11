import { describe, expect, it } from "vitest";
import {
  PLANTS_SUPPLY_STEP_BLOCK_PCT,
  assessPlantsFlipForSector,
  buildPlantsPreflightReport,
  diffBuildQueues,
  mergeBuildFlows,
  percentile,
  plantsGovernorLambda,
  summarizePlantsWatch,
  verifyPlantsRollback,
  type PlantsPreflightSectorAssessment,
  type PlantsPreflightSectorInput,
  type PlantsPreflightWorldInput,
} from "./plantsTransition";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "./capital";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";

const CTX = { currentTurn: 1000, currentYear: 2019 };

function sector(over: Partial<PlantsPreflightSectorInput> = {}): PlantsPreflightSectorInput {
  return {
    id: "s1",
    corporationId: "c1",
    sectorType: "manufacturing",
    revenueAnchor: 1_000_000,
    strategyId: "standard",
    ...over,
  };
}

/** The units the engine itself would imply for the default fixture. */
function impliedForFixture(revenue: number, sectorType = "manufacturing" as const): number {
  const rates = getEffectiveStrategyRates(sectorType, "standard", null, null, CTX.currentTurn);
  return impliedOutputUnits(revenue, rates.supply, COMMODITY_BASE_PRICES, 1);
}

describe("assessPlantsFlipForSector — capacity seed", () => {
  it("seeds an un-migrated sector at implied units x the 1.1 headroom", () => {
    const a = assessPlantsFlipForSector(sector(), CTX);

    expect(a.willMigrate).toBe(true);
    expect(a.impliedUnits).toBeGreaterThan(0);
    expect(a.seedCapacity).toBeCloseTo(a.impliedUnits * CAPITAL_SEED_HEADROOM, 6);
    expect(a.predictedCapacity).toBeCloseTo(a.seedCapacity, 6);
  });

  it("keeps stored capital stock when it already exceeds the seed", () => {
    const base = assessPlantsFlipForSector(sector(), CTX);
    const big = base.seedCapacity * 3;
    const a = assessPlantsFlipForSector(sector({ capitalStock: big }), CTX);

    expect(a.predictedCapacity).toBe(big);
    expect(a.storedCapacity).toBe(big);
  });

  it("does not re-seed a sector that already took its flip turn", () => {
    const a = assessPlantsFlipForSector(sector({ plantsStartTurn: 900, capitalStock: 42 }), CTX);

    expect(a.willMigrate).toBe(false);
    expect(a.predictedCapacity).toBe(42);
    expect(a.warnings).toContain("stale-plants-start-turn");
  });
});

describe("assessPlantsFlipForSector — the nameplate step", () => {
  it("steps the nameplate by exactly the headroom factor when seeding from zero", () => {
    const a = assessPlantsFlipForSector(sector({ revenueAnchor: 1_000_000 }), CTX);

    // capacity = implied x 1.1, mixPrice = revenue / implied
    // => predicted revenue = revenue x 1.1
    expect(a.predictedRevenueAnchor).toBeCloseTo(1_000_000 * CAPITAL_SEED_HEADROOM, 4);
    expect(a.revenueDeltaAnchor).toBeCloseTo(100_000, 4);
    expect(a.warnings).toContain("nameplate-steps-on-headroom");
  });

  it("is a no-op for a sector whose stored capacity already matches its implied units", () => {
    const revenue = 1_000_000;
    const implied = impliedForFixture(revenue);
    const a = assessPlantsFlipForSector(
      sector({ revenueAnchor: revenue, capitalStock: implied * CAPITAL_SEED_HEADROOM }),
      CTX
    );

    // Same capacity either way, so the nameplate restatement changes nothing
    // beyond the headroom the seed would have produced anyway.
    expect(a.predictedCapacity).toBeCloseTo(implied * CAPITAL_SEED_HEADROOM, 6);
  });

  it("pushes the revenue delta through the output mix into per-commodity supply", () => {
    const a = assessPlantsFlipForSector(sector(), CTX);
    const commodities = Object.keys(a.supplyDeltaUnits);

    expect(commodities.length).toBeGreaterThan(0);
    // Every entry moves the same direction as the revenue delta.
    for (const v of Object.values(a.supplyDeltaUnits)) {
      expect(Math.sign(v ?? 0)).toBe(Math.sign(a.revenueDeltaAnchor));
    }
  });
});

describe("assessPlantsFlipForSector — growth ramp becomes build credit", () => {
  it("converts accrued growth cost into free build units that land mid-build", () => {
    const a = assessPlantsFlipForSector(sector({ currentGrowthCostAnchor: 50_000 }), CTX);

    expect(a.buildCreditUnits).toBeGreaterThan(0);
    expect(a.buildCreditBasisAnchor).toBe(50_000);
    expect(a.buildCreditLandsOnTurn).toBeGreaterThan(CTX.currentTurn);
  });

  it("gives no credit to an already-migrated sector", () => {
    const a = assessPlantsFlipForSector(
      sector({ currentGrowthCostAnchor: 50_000, plantsStartTurn: 900, capitalStock: 10 }),
      CTX
    );

    expect(a.buildCreditUnits).toBe(0);
    expect(a.buildCreditLandsOnTurn).toBeNull();
  });

  it("keys the credit on accrued cost, not on the target slider", () => {
    const none = assessPlantsFlipForSector(sector({ currentGrowthCostAnchor: 0 }), CTX);
    expect(none.buildCreditUnits).toBe(0);
  });
});

describe("assessPlantsFlipForSector — blockers", () => {
  it("blocks a negative nameplate", () => {
    const a = assessPlantsFlipForSector(sector({ revenueAnchor: -5 }), CTX);
    expect(a.blockers).toContain("revenue-not-finite-or-negative");
  });

  it("blocks a non-finite nameplate", () => {
    const a = assessPlantsFlipForSector(sector({ revenueAnchor: Number.NaN }), CTX);
    expect(a.blockers).toContain("revenue-not-finite-or-negative");
  });

  it("blocks a sector that already migrated but has no capacity left", () => {
    const a = assessPlantsFlipForSector(
      sector({ plantsStartTurn: 900, capitalStock: 0, revenueAnchor: 500 }),
      CTX
    );
    expect(a.blockers).toContain("migrated-without-capacity");
  });

  it("does not block a migrated sector with no capacity AND no revenue", () => {
    const a = assessPlantsFlipForSector(
      sector({ plantsStartTurn: 900, capitalStock: 0, revenueAnchor: 0 }),
      CTX
    );
    expect(a.blockers).toEqual([]);
  });

  it("warns (does not block) on an unknown strategy id, because the engine falls back silently", () => {
    const a = assessPlantsFlipForSector(sector({ strategyId: "does-not-exist" }), CTX);
    expect(a.warnings).toContain("unknown-strategy-silent-fallback");
    expect(a.blockers).toEqual([]);
  });

  it("warns when denormalized CIP disagrees with the live queue", () => {
    const a = assessPlantsFlipForSector(
      sector({
        buildQueue: [{ unitsOrdered: 10, costPaidAnchor: 1000, startTurn: 990, onlineTurn: 1040 }],
        constructionInProgressAnchor: 7,
      }),
      CTX
    );
    expect(a.warnings).toContain("cip-out-of-sync");
    expect(a.computedCipAnchor).toBe(1000);
  });

  it("tolerates sub-unit CIP rounding", () => {
    const a = assessPlantsFlipForSector(
      sector({
        buildQueue: [
          { unitsOrdered: 10, costPaidAnchor: 1000.4, startTurn: 990, onlineTurn: 1040 },
        ],
        constructionInProgressAnchor: 1000,
      }),
      CTX
    );
    expect(a.warnings).not.toContain("cip-out-of-sync");
  });

  it("counts only not-yet-online orders as outstanding", () => {
    const a = assessPlantsFlipForSector(
      sector({
        buildQueue: [
          { unitsOrdered: 10, costPaidAnchor: 0, startTurn: 900, onlineTurn: 999 }, // landed
          { unitsOrdered: 5, costPaidAnchor: 0, startTurn: 990, onlineTurn: 1040 },
        ],
      }),
      CTX
    );
    expect(a.outstandingBuildOrders).toBe(1);
    expect(a.outstandingBuildUnits).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function world(over: Partial<PlantsPreflightWorldInput> = {}): PlantsPreflightWorldInput {
  return {
    currentMode: "capital",
    currentTurn: 1000,
    currentYear: 2019,
    assessments: [],
    unowned: { total: 10, missingHeadroomUnits: 0, backfillMigrationRan: true },
    crises: { financialOnly: 0, legacyUnflagged: 0 },
    governor: { cap: 0.15, rampTurns: 240 },
    ...over,
  };
}

/** A neutral assessment — no step, no blockers — for world-level assembly. */
function flat(
  over: Partial<PlantsPreflightSectorAssessment> = {}
): PlantsPreflightSectorAssessment {
  return {
    id: "s",
    corporationId: "c",
    sectorType: "manufacturing",
    willMigrate: true,
    currentRevenueAnchor: 1000,
    impliedUnits: 100,
    storedCapacity: 100,
    seedCapacity: 100,
    predictedCapacity: 100,
    mixPriceAnchor: 10,
    predictedRevenueAnchor: 1000,
    revenueDeltaAnchor: 0,
    supplyDeltaUnits: {},
    buildCreditUnits: 0,
    buildCreditBasisAnchor: 0,
    buildCreditLandsOnTurn: null,
    outstandingBuildOrders: 0,
    outstandingBuildUnits: 0,
    computedCipAnchor: 0,
    storedCipAnchor: 0,
    blockers: [],
    warnings: [],
    ...over,
  };
}

describe("buildPlantsPreflightReport — GO/NO-GO", () => {
  it("refuses an empty world rather than passing every check vacuously", () => {
    // The dangerous failure is a confident GO that came from pointing the tool
    // at the wrong database.
    const r = buildPlantsPreflightReport(world({ assessments: [] }));
    expect(r.verdict).toBe("NO-GO");
    expect(r.reasons.join(" ")).toContain("No corporate sectors");
  });

  it("says GO on a clean world", () => {
    const r = buildPlantsPreflightReport(world({ assessments: [flat(), flat({ id: "s2" })] }));
    expect(r.verdict).toBe("GO");
    expect(r.reasons).toEqual([]);
  });

  it("says NO-GO when any sector carries a blocker, and names the blocker", () => {
    const r = buildPlantsPreflightReport(
      world({ assessments: [flat(), flat({ id: "bad", blockers: ["no-priced-output-mix"] })] })
    );
    expect(r.verdict).toBe("NO-GO");
    expect(r.reasons.join(" ")).toContain("no-priced-output-mix");
    expect(r.sectors.withBlockers).toBe(1);
    expect(r.worstBlockers).toHaveLength(1);
  });

  it("says NO-GO when the predicted world-supply step exceeds the block threshold", () => {
    // Every sector steps the full 10% — a world flipping up from below capital.
    const assessments = [1, 2, 3].map((i) =>
      flat({
        id: `s${i}`,
        currentRevenueAnchor: 1000,
        predictedRevenueAnchor: 1100,
        revenueDeltaAnchor: 100,
        warnings: ["nameplate-steps-on-headroom"],
      })
    );
    const r = buildPlantsPreflightReport(world({ assessments }));

    expect(r.supply.deltaPct).toBeCloseTo(0.1, 6);
    expect(r.supply.deltaPct).toBeGreaterThan(PLANTS_SUPPLY_STEP_BLOCK_PCT);
    expect(r.verdict).toBe("NO-GO");
    expect(r.reasons.join(" ")).toContain("world-supply step");
  });

  it("lets an operator accept a large supply step deliberately", () => {
    const assessments = [
      flat({ currentRevenueAnchor: 1000, predictedRevenueAnchor: 1100, revenueDeltaAnchor: 100 }),
    ];
    const r = buildPlantsPreflightReport(world({ assessments, acceptSupplyStepPct: 0.2 }));
    expect(r.verdict).toBe("GO");
  });

  it("warns but does not block a supply step between the comfort and block lines", () => {
    const assessments = [
      flat({ currentRevenueAnchor: 1000, predictedRevenueAnchor: 1030, revenueDeltaAnchor: 30 }),
    ];
    const r = buildPlantsPreflightReport(world({ assessments }));
    expect(r.verdict).toBe("GO");
    expect(r.cautions.join(" ")).toContain("comfort line");
  });

  it("says NO-GO when unowned sectors are missing headroomUnits", () => {
    const r = buildPlantsPreflightReport(
      world({
        assessments: [flat()],
        unowned: { total: 10, missingHeadroomUnits: 4, backfillMigrationRan: false },
      })
    );
    expect(r.verdict).toBe("NO-GO");
    expect(r.reasons.join(" ")).toContain("headroomUnits");
    expect(r.reasons.join(" ")).toContain("has not run");
  });

  it("flags the nastier case where the backfill ran and STILL left docs behind", () => {
    const r = buildPlantsPreflightReport(
      world({
        assessments: [flat()],
        unowned: { total: 10, missingHeadroomUnits: 4, backfillMigrationRan: true },
      })
    );
    expect(r.verdict).toBe("NO-GO");
    expect(r.reasons.join(" ")).toContain("marker EXISTS");
  });

  it("says NO-GO when the world is already at plants — there is nothing to preflight", () => {
    const r = buildPlantsPreflightReport(world({ currentMode: "plants", assessments: [flat()] }));
    expect(r.verdict).toBe("NO-GO");
    expect(r.mode.alreadyAtPlants).toBe(true);
    expect(r.reasons.join(" ")).toContain("plantsWatch");
  });

  it("reports legacy unflagged crisis effects as a caution, not a veto", () => {
    const r = buildPlantsPreflightReport(
      world({ assessments: [flat()], crises: { financialOnly: 2, legacyUnflagged: 7 } })
    );
    expect(r.verdict).toBe("GO");
    expect(r.cautions.join(" ")).toContain("FINANCIAL");
  });

  it("aggregates the build-credit wave and the turn window it lands in", () => {
    const r = buildPlantsPreflightReport(
      world({
        assessments: [
          flat({ buildCreditUnits: 10, buildCreditBasisAnchor: 100, buildCreditLandsOnTurn: 1024 }),
          flat({
            id: "s2",
            buildCreditUnits: 5,
            buildCreditBasisAnchor: 50,
            buildCreditLandsOnTurn: 1036,
          }),
        ],
      })
    );
    expect(r.buildCredit).toMatchObject({ sectors: 2, units: 15, basisAnchor: 150 });
    expect(r.buildCredit.landsBetweenTurns).toEqual([1024, 1036]);
  });

  it("sums per-commodity supply deltas across sectors, largest first", () => {
    const r = buildPlantsPreflightReport(
      world({
        assessments: [
          flat({ supplyDeltaUnits: { steel: 10, food: 100 } }),
          flat({ id: "s2", supplyDeltaUnits: { steel: 5 } }),
        ],
      })
    );
    expect(r.supply.byCommodity[0]).toEqual({ commodity: "food", deltaUnits: 100 });
    expect(r.supply.byCommodity[1]).toEqual({ commodity: "steel", deltaUnits: 15 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("plantsGovernorLambda", () => {
  it("is null for a sector that has not migrated", () => {
    expect(plantsGovernorLambda(null, 100, 240)).toBeNull();
  });

  it("is 0 on the flip turn and 1 once the ramp is served", () => {
    expect(plantsGovernorLambda(100, 100, 240)).toBe(0);
    expect(plantsGovernorLambda(100, 340, 240)).toBe(1);
    expect(plantsGovernorLambda(100, 10_000, 240)).toBe(1);
  });

  it("is linear in between", () => {
    expect(plantsGovernorLambda(100, 220, 240)).toBeCloseTo(0.5, 6);
  });

  it("treats a zero-length ramp as fully ungoverned rather than dividing by zero", () => {
    expect(plantsGovernorLambda(100, 100, 0)).toBe(1);
  });
});

describe("summarizePlantsWatch", () => {
  const base = {
    id: "s",
    sectorType: "manufacturing" as const,
    capitalStock: 100,
    producedUnits: 80,
    soldUnits: 60,
    revenueAnchor: 1000,
    legacyRevenueShadowAnchor: 1000,
    plantsStartTurn: 1000,
  };

  it("computes fill rate and utilization from physical units", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [base, { ...base, id: "s2" }],
    });

    expect(s.production.producedUnits).toBe(160);
    expect(s.production.soldUnits).toBe(120);
    expect(s.production.fillRate).toBeCloseTo(0.75, 6);
    expect(s.production.utilization).toBeCloseTo(0.8, 6);
  });

  it("reports zero drift when every sector matches its shadow", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [base],
    });
    expect(s.drift.deltaPct).toBe(0);
    expect(s.drift.severity).toBe("ok");
  });

  it("escalates severity as the world pulls away from the counterfactual", () => {
    const warn = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [{ ...base, revenueAnchor: 1150 }],
    });
    expect(warn.drift.severity).toBe("warn");

    const alarm = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [{ ...base, revenueAnchor: 1400 }],
    });
    expect(alarm.drift.severity).toBe("alarm");
    expect(alarm.alerts.join(" ")).toContain("capital-mode shadow");
  });

  it("excludes shadowless sectors from BOTH sides of the drift ratio", () => {
    // A shadowless sector counted only on the derived side would fabricate
    // drift purely from missing data.
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [base, { ...base, id: "s2", legacyRevenueShadowAnchor: null }],
    });

    expect(s.drift.sectorsWithShadow).toBe(1);
    expect(s.drift.sectorsWithoutShadow).toBe(1);
    expect(s.drift.derivedRevenueAnchor).toBe(1000);
    expect(s.drift.shadowRevenueAnchor).toBe(1000);
    expect(s.drift.deltaPct).toBe(0);
    expect(s.alerts.join(" ")).toContain("no legacyRevenueShadow");
  });

  it("splits governed, ungoverned and unmigrated sectors", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1100,
      governorRampTurns: 240,
      sectors: [
        { ...base, plantsStartTurn: 1000 }, // lambda 0.416
        { ...base, id: "s2", plantsStartTurn: 500 }, // done
        { ...base, id: "s3", plantsStartTurn: null }, // never flipped
      ],
    });

    expect(s.governor.stillGoverned).toBe(1);
    expect(s.governor.ungoverned).toBe(1);
    expect(s.governor.unmigrated).toBe(1);
    expect(s.governor.rampCompletesByTurn).toBe(1240);
  });

  it("counts zero-production and mothballed sectors and alerts above the line", () => {
    const sectors = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: `s${i}`,
      producedUnits: i < 3 ? 0 : 80,
      mothballed: i < 2,
    }));
    const s = summarizePlantsWatch({ currentTurn: 1010, governorRampTurns: 240, sectors });

    expect(s.production.zeroProductionSectors).toBe(3);
    expect(s.production.mothballedSectors).toBe(2);
    expect(s.production.zeroProductionPct).toBeCloseTo(0.3, 6);
    expect(s.alerts.join(" ")).toContain("alarm line");
  });

  it("alerts when over half of production fails to clear", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [{ ...base, producedUnits: 100, soldUnits: 20 }],
    });
    expect(s.alerts.join(" ")).toContain("Fill rate");
  });

  it("summarizes corp cash as a distribution, not just a total", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [base],
      corpCashAnchors: [-100, 0, 10, 20, 30, 40, 50, 60, 70, 1000],
    });

    expect(s.corpCash.count).toBe(10);
    expect(s.corpCash.negative).toBe(1);
    expect(s.corpCash.median).toBe(30);
    expect(s.corpCash.p90).toBe(70);
  });

  it("measures commodity price drift against the base table", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [base],
      commodityPrices: { steel: 20 },
      basePrices: { steel: 10 },
    });

    expect(s.prices[0]).toMatchObject({ commodity: "steel", driftPct: 1 });
  });

  it("aggregates outstanding build work", () => {
    const s = summarizePlantsWatch({
      currentTurn: 1010,
      governorRampTurns: 240,
      sectors: [
        {
          ...base,
          buildQueue: [
            { unitsOrdered: 10, costPaidAnchor: 500, startTurn: 1000, onlineTurn: 1048 },
            { unitsOrdered: 3, costPaidAnchor: 100, startTurn: 900, onlineTurn: 1005 },
          ],
          constructionInProgressAnchor: 500,
        },
      ],
    });

    expect(s.build.sectorsWithQueue).toBe(1);
    expect(s.build.outstandingOrders).toBe(1);
    expect(s.build.outstandingUnits).toBe(10);
    expect(s.build.cipAnchor).toBe(500);
  });
});

describe("percentile", () => {
  it("returns 0 on an empty set rather than NaN", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("uses nearest-rank", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([5, 4, 3, 2, 1], 0.1)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });
});

describe("diffBuildQueues", () => {
  const order = (u: number, start: number, online: number) => ({
    unitsOrdered: u,
    costPaidAnchor: 100,
    startTurn: start,
    onlineTurn: online,
  });

  it("counts an order that left the queue at or past its online turn as LANDED", () => {
    const flow = diffBuildQueues([order(10, 900, 1000)], [], 1000);
    expect(flow).toMatchObject({ landedOrders: 1, landedUnits: 10, cancelledOrders: 0 });
  });

  it("counts an order that left the queue early as CANCELLED", () => {
    const flow = diffBuildQueues([order(10, 900, 1050)], [], 1000);
    expect(flow).toMatchObject({ cancelledOrders: 1, cancelledUnits: 10, landedOrders: 0 });
  });

  it("counts a new order as PLACED", () => {
    const flow = diffBuildQueues([], [order(7, 1000, 1048)], 1000);
    expect(flow).toMatchObject({ placedOrders: 1, placedUnits: 7 });
  });

  it("leaves an unchanged queue completely flat", () => {
    const q = [order(10, 900, 1050), order(4, 950, 1060)];
    expect(diffBuildQueues(q, q, 1000)).toEqual({
      placedOrders: 0,
      placedUnits: 0,
      landedOrders: 0,
      landedUnits: 0,
      cancelledOrders: 0,
      cancelledUnits: 0,
    });
  });

  it("treats two identical orders as two orders, not one", () => {
    const before = [order(10, 900, 1050), order(10, 900, 1050)];
    const after = [order(10, 900, 1050)];
    expect(diffBuildQueues(before, after, 1000)).toMatchObject({
      cancelledOrders: 1,
      placedOrders: 0,
    });
  });

  it("handles a simultaneous land and place in one turn", () => {
    const flow = diffBuildQueues([order(10, 900, 1000)], [order(5, 1000, 1048)], 1000);
    expect(flow).toMatchObject({
      landedOrders: 1,
      landedUnits: 10,
      placedOrders: 1,
      placedUnits: 5,
    });
  });

  it("merges flows additively", () => {
    const a = diffBuildQueues([order(10, 900, 1000)], [], 1000);
    const b = diffBuildQueues([], [order(5, 1000, 1048)], 1000);
    expect(mergeBuildFlows([a, b])).toMatchObject({ landedUnits: 10, placedUnits: 5 });
  });
});

describe("verifyPlantsRollback", () => {
  const s = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    revenueAnchor: 1000,
    legacyRevenueShadowAnchor: 1000,
    plantsStartTurn: 900,
    ...over,
  });

  it("is lossless when every sector has a finite restore point", () => {
    const r = verifyPlantsRollback([s(), s({ id: "s2" })]);
    expect(r.lossless).toBe(true);
    expect(r.withoutRestorePoint).toBe(0);
    expect(r.notes.join(" ")).toContain("Every scanned sector");
  });

  it("is NOT lossless when a migrated sector has no shadow", () => {
    const r = verifyPlantsRollback([s(), s({ id: "s2", legacyRevenueShadowAnchor: null })]);
    expect(r.lossless).toBe(false);
    expect(r.withoutRestorePoint).toBe(1);
    expect(r.unrecoverable.map((u) => u.id)).toEqual(["s2"]);
    expect(r.notes.join(" ")).toContain("permanent rebase");
  });

  it("treats a corrupt or negative shadow as no restore point at all", () => {
    const r = verifyPlantsRollback([
      s({ id: "nan", legacyRevenueShadowAnchor: Number.NaN }),
      s({ id: "neg", legacyRevenueShadowAnchor: -1 }),
      s({ id: "inf", legacyRevenueShadowAnchor: Number.POSITIVE_INFINITY }),
    ]);
    expect(r.withoutRestorePoint).toBe(3);
    expect(r.lossless).toBe(false);
  });

  it("notes that a never-migrated sector without a shadow costs nothing", () => {
    const r = verifyPlantsRollback([
      s({ id: "fresh", legacyRevenueShadowAnchor: null, plantsStartTurn: null }),
    ]);
    expect(r.neverMigrated).toBe(1);
    expect(r.notes.join(" ")).toContain("costs nothing");
  });

  it("reports divergence magnitude WITHOUT calling it a loss of losslessness", () => {
    const r = verifyPlantsRollback([
      s({ id: "grew", revenueAnchor: 1500, legacyRevenueShadowAnchor: 1000 }),
      s({ id: "shrank", revenueAnchor: 700, legacyRevenueShadowAnchor: 1000 }),
    ]);

    expect(r.lossless).toBe(true);
    expect(r.divergence.sectors).toBe(2);
    expect(r.divergence.totalAbsAnchor).toBe(800);
    expect(r.divergence.netAnchor).toBe(200);
    expect(r.divergence.maxAbsAnchor).toBe(500);
    expect(r.divergence.worst[0]!.id).toBe("grew");
    expect(r.notes.join(" ")).toContain("DISCARDS");
  });

  it("ignores sub-unit divergence as rounding", () => {
    const r = verifyPlantsRollback([s({ revenueAnchor: 1000.4 })]);
    expect(r.divergence.sectors).toBe(0);
  });

  it("computes divergence as a percentage of the restore point", () => {
    const r = verifyPlantsRollback([s({ revenueAnchor: 1200 })]);
    expect(r.divergence.worst[0]!.divergencePct).toBeCloseTo(0.2, 6);
  });
});
