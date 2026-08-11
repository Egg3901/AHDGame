import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// Deterministic [0,100] clamps regardless of per-metric config — but ONLY the
// clamps. The real definition rides through underneath, because two things
// downstream need the rest of it: `metricCategories` (read by the board bridge's
// import chain) and `isHigherBetter`, which decides the SIGN of a board delta.
// Stubbing the whole definition made every metric read as lower-is-better, so a
// mandate that improves healthcare came out as a cut.
vi.mock("@/lib/constants/metricDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants/metricDefinitions")>();
  return {
    ...actual,
    getMetricDefinition: (category: string, metricId: string) => ({
      ...(actual.getMetricDefinition(
        category as Parameters<typeof actual.getMetricDefinition>[0],
        metricId
      ) ?? {}),
      minValue: 0,
      maxValue: 100,
    }),
  };
});
// Avoid the FX collection read under MockDb; passthrough rate=1.
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return { ...actual, loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()) };
});

import { buildMandateMetricOps, buildRdModernizationOps } from "./soeOperations";
import {
  NATCORP_RD_MOMENTUM_MAX,
  NATCORP_RD_DECAY_PER_TURN,
  NATCORP_RD_RAMP_UP_PER_TURN,
  NATCORP_RD_FULL_FUND_REVENUE_FRACTION,
} from "./constants";
import { RD_INNOVATION_SCORE_THRESHOLD } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const NOW = new Date("2026-05-31T00:00:00Z");

describe("NatCorp R&D constants stay in sync with their source", () => {
  // The NatCorp constants inline these values to avoid a constants import cycle
  // (corporations.ts imports nationalization/constants). Guard against drift.
  it("momentum max equals the innovation threshold", () => {
    expect(NATCORP_RD_MOMENTUM_MAX).toBe(RD_INNOVATION_SCORE_THRESHOLD);
  });
  it("flat decay lapses full momentum over one year", () => {
    expect(NATCORP_RD_DECAY_PER_TURN).toBeCloseTo(NATCORP_RD_MOMENTUM_MAX / TURNS_PER_YEAR, 6);
  });
});

describe("buildRdModernizationOps", () => {
  const rev = (id: ObjectId, r: number) => new Map([[id.toString(), r]]);

  const REVENUE = 100_000;
  const FULL_FUND = Math.round(REVENUE * NATCORP_RD_FULL_FUND_REVENUE_FRACTION);

  it("at full funding (full-fund cost), climbs toward MAX at the ramp rate, debiting the spend", () => {
    const id = new ObjectId();
    // budget = full-fund cost ⇒ full intensity, target = MAX (ramp-capped this turn).
    const ops = buildRdModernizationOps(
      [{ _id: id, rdScore: 0, liquidCapital: 100_000_000, rdBudgetPerTurn: FULL_FUND }],
      rev(id, REVENUE),
      NOW
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.rdScore).toBeCloseTo(NATCORP_RD_RAMP_UP_PER_TURN, 5);
    expect(ops[0].updateOne.update.$inc).toEqual({ liquidCapital: -FULL_FUND });
    expect(ops[0].updateOne.filter).toEqual({ _id: id, liquidCapital: { $gte: FULL_FUND } });
  });

  it("decays at the flat rate when unfunded (MAX ⇒ 0 over one year)", () => {
    const id = new ObjectId();
    const ops = buildRdModernizationOps(
      [{ _id: id, rdScore: NATCORP_RD_MOMENTUM_MAX, liquidCapital: 0, rdBudgetPerTurn: 0 }],
      rev(id, REVENUE),
      NOW
    );
    expect(ops[0].updateOne.update.$set.rdScore).toBeCloseTo(
      NATCORP_RD_MOMENTUM_MAX - NATCORP_RD_DECAY_PER_TURN,
      2
    );
    expect(ops[0].updateOne.update.$inc).toBeUndefined();
    expect(ops[0].updateOne.filter).toEqual({ _id: id });
  });

  it("is scale-aware: target = (spend ÷ full-fund cost) × MAX", () => {
    const id = new ObjectId();
    const budget = Math.round(FULL_FUND / 10); // 10% intensity ⇒ target = MAX/10 (< ramp cap)
    const ops = buildRdModernizationOps(
      [{ _id: id, rdScore: 0, liquidCapital: 100_000_000, rdBudgetPerTurn: budget }],
      rev(id, REVENUE),
      NOW
    );
    const target =
      (budget / (REVENUE * NATCORP_RD_FULL_FUND_REVENUE_FRACTION)) * NATCORP_RD_MOMENTUM_MAX;
    expect(ops[0].updateOne.update.$set.rdScore).toBeCloseTo(
      Math.min(target, NATCORP_RD_RAMP_UP_PER_TURN),
      4
    );
    expect(ops[0].updateOne.update.$inc).toEqual({ liquidCapital: -budget });
  });

  it("treats the budget as a ceiling — never spends past the full-fund cost", () => {
    const id = new ObjectId();
    const ops = buildRdModernizationOps(
      [{ _id: id, rdScore: 0, liquidCapital: 100_000_000, rdBudgetPerTurn: 9_999_999 }],
      rev(id, REVENUE),
      NOW
    );
    expect(ops[0].updateOne.update.$inc).toEqual({ liquidCapital: -FULL_FUND });
  });

  it("decays (no spend) when it cannot afford the desired spend", () => {
    const id = new ObjectId();
    const ops = buildRdModernizationOps(
      [
        {
          _id: id,
          rdScore: 100,
          liquidCapital: Math.floor(FULL_FUND / 2),
          rdBudgetPerTurn: FULL_FUND,
        },
      ],
      rev(id, REVENUE), // desired spend = full-fund > liquid (half) ⇒ unaffordable
      NOW
    );
    expect(ops[0].updateOne.update.$inc).toBeUndefined();
    expect(ops[0].updateOne.update.$set.rdScore).toBeCloseTo(100 - NATCORP_RD_DECAY_PER_TURN, 2);
  });

  it("skips a corp at rest (zero momentum, zero budget)", () => {
    expect(
      buildRdModernizationOps(
        [{ _id: new ObjectId(), rdScore: 0, liquidCapital: 0, rdBudgetPerTurn: 0 }],
        new Map(),
        NOW
      )
    ).toEqual([]);
  });
});

describe("buildMandateMetricOps", () => {
  it("raises a 'higher is better' metric by the delta", () => {
    const ops = buildMandateMetricOps({
      countryId: "US",
      stateId: "CA",
      contributions: [{ metricPath: "healthcare.physicianRate", delta: 2 }],
      currentMetrics: { healthcare: { physicianRate: { value: 50 } } } as never,
      now: NOW,
    });
    expect(ops).toHaveLength(1);
    const update = ops[0].updateOne;
    expect(update.filter).toEqual({ _id: "CA" });
    expect(update.update.$set["healthcare.physicianRate.value"]).toBeCloseTo(52, 5);
  });

  it("does not push a metric past 100", () => {
    const ops = buildMandateMetricOps({
      countryId: "US",
      stateId: "CA",
      contributions: [{ metricPath: "healthcare.physicianRate", delta: 5 }],
      currentMetrics: { healthcare: { physicianRate: { value: 99 } } } as never,
      now: NOW,
    });
    expect(ops[0].updateOne.update.$set["healthcare.physicianRate.value"]).toBe(100);
  });

  it("does not push a metric below 0 for negative-direction deltas", () => {
    const ops = buildMandateMetricOps({
      countryId: "US",
      stateId: "CA",
      contributions: [{ metricPath: "economic.unemploymentRate", delta: -5 }],
      currentMetrics: { economic: { unemploymentRate: { value: 2 } } } as never,
      now: NOW,
    });
    expect(ops[0].updateOne.update.$set["economic.unemploymentRate.value"]).toBe(0);
  });

  it("returns no op when the metric is missing on the doc", () => {
    const ops = buildMandateMetricOps({
      countryId: "US",
      stateId: "CA",
      contributions: [{ metricPath: "healthcare.physicianRate", delta: 2 }],
      currentMetrics: {} as never,
      now: NOW,
    });
    expect(ops).toEqual([]);
  });
});

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processSoeOperations", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("macroMetrics");
    db.collection("politicalMetrics");
    db.collection("centralBanks");
    db.collection("federalBudget");
  });

  it("backs a negative-liquidCapital SOE to zero and writes a metric bonus", async () => {
    const corpId = new ObjectId();
    // Mirror the seeded NHS shape: countryOwnerId set, NO ownershipState field.
    // isStateOwned must still recognize it (regression guard for the find query).
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: corpId,
          countryId: "US",
          countryOwnerId: "US",
          isNationalized: true,
          liquidCapital: -1000,
          liquidCurrencyCode: "USD",
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "healthcare",
          revenue: 100,
          soeMandate: undefined,
        },
      ])
    );
    // The region has to exist in macroMetrics for the merged doc to resolve,
    // even though this mandate's target is political.
    db.collectionMocks.macroMetrics.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.politicalMetrics.find.mockReturnValue(
      cursor([{ _id: "CA", countryId: "US", values: { "health.outcomes": 50 } }])
    );

    const { processSoeOperations } = await import("./soeOperations");
    const result = await processSoeOperations(db as unknown as Db, NOW);

    expect(result.soeCorps).toBe(1);
    // Treasury covered the loss → liquidCapital set to 0.
    const corpWrite = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(corpWrite[0].updateOne.update.$set.liquidCapital).toBe(0);
    // Treasury was debited to cover the loss.
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalled();
    // The healthcare mandate LANDED on the board family `healthcare.physicianRate`
    // maps to. Asserting the written VALUE, not that a write was issued: a
    // dotted `$inc` would have been issued too, and silently done nothing.
    const boardWrite = db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0];
    expect(boardWrite[0].updateOne.update.$set.values["health.outcomes"]).toBeGreaterThan(50);
  });

  it("is a no-op when there are no state-owned corps", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(cursor([]));
    const { processSoeOperations } = await import("./soeOperations");
    const result = await processSoeOperations(db as unknown as Db, NOW);
    expect(result.soeCorps).toBe(0);
    expect(db.collectionMocks.macroMetrics.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.politicalMetrics.bulkWrite).not.toHaveBeenCalled();
  });
});
