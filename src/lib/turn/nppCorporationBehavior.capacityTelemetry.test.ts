/**
 * NPP capacity-decision telemetry at the behavior boundary (#1835).
 *
 * `rules.ts` pins the shared vocabulary and the gate precedences in isolation,
 * and `persistence.test.ts` pins the flush mechanics with hand-built
 * observations. What neither proves is that the NPP path itself emits that
 * vocabulary: that `makeNppCorpDecision` attaches one founding observation
 * plus one per evaluated reinvestment candidate, that a candidate tripping
 * several gates records the FIRST gate in precedence order, and that those
 * exact emitted observations persist into versioned buckets in a single flush
 * — with no identifiers and no database reads on the decision path (the rival
 * counts arrive on the context from the shell's in-memory index).
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { NppCorpDecisionContext } from "./npp/corpDecisionTypes";
import type { NppStrategyState } from "./npp/corpStrategy";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import {
  CAPACITY_DECISION_COLLECTION,
  CAPACITY_DECISION_RETENTION_TURNS,
  recordCapacityDecisionBulkBestEffort,
} from "@/lib/corporations/capacityDecisionTelemetry/persistence";
import {
  CAPACITY_DECISION_SCHEMA_VERSION,
  capacityDecisionBucketKey,
  type CapacityDecisionObservation,
} from "@/lib/corporations/capacityDecisionTelemetry/rules";

const noPrices: CommodityPriceRatioFn = () => null;
const TURN = 200;

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "ZZ Telemetry Probe 7q",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "ZZ-PROBE-STATE-7Q",
    liquidCapital: 500_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "ZZ-PROBE-STATE-7Q",
    revenue: 10_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    capitalStock: 1_000,
    producedUnits: 1_000,
    soldUnits: 1_000,
    ...overrides,
  } as unknown as CorporateSector;
}

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  pools: UnownedSector[],
  extra: {
    strategy?: NppStrategyState;
    competitorCountOf?: NppCorpDecisionContext["competitorCountOf"];
    stateControlled?: Set<string>;
  } = {}
) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors,
      turn: TURN,
      now: new Date(),
      modifiers: ceoArchetypeModifiers("cautious"),
      strategy: extra.strategy,
      competitorCountOf: extra.competitorCountOf,
    },
    new Map<string, UnownedSector[]>([["US", pools]]),
    extra.stateControlled ?? new Set<string>(),
    noPrices,
    plantsCtx,
    undefined
  );
}

/** The shared vocabulary shape: exactly these fields, no identifiers. */
const OBSERVATION_KEYS = [
  "actor",
  "cashHeadroomAnchor",
  "cohort",
  "competitorCount",
  "dominanceDensityFactor",
  "dominanceMultiplier",
  "marketSharePct",
  "outcome",
  "rawDominanceMultiplier",
  "requestedUnits",
  "stage",
  "unitPriceAnchor",
].sort();

function expectSharedVocabulary(observation: CapacityDecisionObservation) {
  expect(Object.keys(observation).sort()).toEqual(OBSERVATION_KEYS);
  expect(observation.actor).toBe("npp");
  expect(observation.cohort).toBe("npp-managed");
  expect(observation.stage).toBe("order");
  for (const field of [
    "marketSharePct",
    "competitorCount",
    "rawDominanceMultiplier",
    "dominanceDensityFactor",
    "dominanceMultiplier",
    "unitPriceAnchor",
    "cashHeadroomAnchor",
    "requestedUnits",
  ] as const) {
    expect(Number.isFinite(observation[field]), field).toBe(true);
  }
}

function expectNoIdentifiers(
  observations: readonly CapacityDecisionObservation[],
  c: Corporation,
  sectors: CorporateSector[]
) {
  const serialized = JSON.stringify(observations);
  expect(serialized).not.toContain(c._id.toString());
  expect(serialized).not.toContain(c.name);
  for (const s of sectors) {
    expect(serialized).not.toContain(s._id.toString());
  }
  expect(serialized).not.toContain("ZZ-PROBE-STATE-7Q");
}

describe("NPP capacity telemetry — founding first-gate precedence", () => {
  it("records strategy_disallowed when strategy, profit, and margin gates all fire", () => {
    // Held retrench: the loop cannot move it (ineligible), so expansion is
    // barred while the dead sector also trips unprofitable, margin_below_floor
    // and no_enterable_market. Precedence says the earliest gate wins.
    const c = corp();
    const dead = sector({
      revenue: 0,
      realizedRevenue: 0,
      profitMargin: 0,
      effectiveProfitMargin: 0,
      // Empty so the reinvestment loop also observes deterministically
      // (no_capacity) instead of incidentally pricing a dead plant.
      capitalStock: 0,
    });
    const decision = decide(c, [dead], [], {
      strategy: { id: "retrench", adoptedTurn: TURN, baselineScore: -1000 },
    });

    expect(decision.capacityObservations).toHaveLength(2);
    const [founding, reinvest] = decision.capacityObservations!;
    expectSharedVocabulary(founding);
    expect(founding.outcome).toBe("strategy_disallowed");
    // Rejected before pricing: explicit zeros, never a fabricated quote.
    expect(founding.unitPriceAnchor).toBe(0);
    expect(founding.requestedUnits).toBe(0);
    expectSharedVocabulary(reinvest);
    expect(reinvest.outcome).toBe("no_capacity");
    expectNoIdentifiers(decision.capacityObservations!, c, [dead]);
  });
});

describe("NPP capacity telemetry — reinvestment first-gate precedence", () => {
  it("records mothballed when a queued, telemetry-less plant in a controlled bucket is cold", () => {
    const c = corp();
    // Mothballed AND empty AND queue-full AND telemetry-less AND in a
    // state-controlled bucket: five gates fire, the earliest must win.
    const cold = sector({
      mothballed: true,
      capitalStock: 0,
      producedUnits: 0,
      soldUnits: 0,
      buildQueue: new Array(20).fill({}) as unknown as CorporateSector["buildQueue"],
    });
    const competitorCountOf = vi.fn().mockReturnValue(2);
    const decision = decide(c, [cold], [], {
      competitorCountOf,
      stateControlled: new Set([bucketKey("ZZ-PROBE-STATE-7Q", "manufacturing")]),
    });

    expect(decision.capacityObservations).toHaveLength(2);
    const [, reinvest] = decision.capacityObservations!;
    expectSharedVocabulary(reinvest);
    expect(reinvest.outcome).toBe("mothballed");
    // Pre-sizing rejection: no quote, no sized demand.
    expect(reinvest.unitPriceAnchor).toBe(0);
    expect(reinvest.requestedUnits).toBe(0);
    // Rival counts come from the shell's in-memory index on the context, not
    // from a turn-path read: the stub is consulted, excluding the decider.
    expect(reinvest.competitorCount).toBe(2);
    expect(competitorCountOf).toHaveBeenCalledWith(
      "ZZ-PROBE-STATE-7Q",
      "manufacturing",
      c._id.toString()
    );
    expectNoIdentifiers(decision.capacityObservations!, c, [cold]);
  });
});

describe("NPP capacity telemetry — emitted observations persist versioned", () => {
  it("flushes the boundary's own observations into vocabulary buckets in one write", async () => {
    const foundingCorp = corp();
    const founding = decide(
      foundingCorp,
      [
        sector({
          revenue: 0,
          realizedRevenue: 0,
          profitMargin: 0,
          effectiveProfitMargin: 0,
          capitalStock: 0,
        }),
      ],
      [],
      { strategy: { id: "retrench", adoptedTurn: TURN, baselineScore: -1000 } }
    );
    const reinvestCorp = corp();
    const reinvest = decide(
      reinvestCorp,
      [
        sector({
          mothballed: true,
          capitalStock: 0,
          producedUnits: 0,
          soldUnits: 0,
          buildQueue: new Array(20).fill({}) as unknown as CorporateSector["buildQueue"],
        }),
      ],
      [],
      {
        competitorCountOf: () => 2,
        stateControlled: new Set([bucketKey("ZZ-PROBE-STATE-7Q", "manufacturing")]),
      }
    );
    const observations = [...founding.capacityObservations!, ...reinvest.capacityObservations!];

    const bulkWrite = vi.fn().mockResolvedValue(undefined);
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const db = { collection: vi.fn().mockReturnValue({ bulkWrite, deleteMany }) } as never;
    await recordCapacityDecisionBulkBestEffort(db, TURN, observations);

    // One flush for the whole boundary: no per-row writes, no new reads.
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: unknown; update: Record<string, unknown>; upsert: boolean };
    }>;
    expect(ops).toHaveLength(new Set(observations.map(capacityDecisionBucketKey)).size);
    for (const op of ops) {
      expect(op.updateOne.filter).toEqual({ _id: `turn:${TURN}` });
      expect(op.updateOne.upsert).toBe(true);
      expect((op.updateOne.update.$set as Record<string, unknown>).schemaVersion).toBe(
        CAPACITY_DECISION_SCHEMA_VERSION
      );
      for (const key of Object.keys(op.updateOne.update.$inc as object)) {
        expect(key).toMatch(/^buckets\.npp:npp-managed:order:[a-z_0-9]+\.(observations|\w+Sum)$/);
      }
    }
    // The first rejecting gates the boundary emitted are the buckets written.
    const increments = Object.keys(Object.assign({}, ...ops.map((op) => op.updateOne.update.$inc)));
    expect(increments).toContain("buckets.npp:npp-managed:order:strategy_disallowed.observations");
    expect(increments).toContain("buckets.npp:npp-managed:order:mothballed.observations");
    expect(db.collection).toHaveBeenCalledTimes(1);
    expect(db.collection).toHaveBeenCalledWith(CAPACITY_DECISION_COLLECTION);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      turn: { $lt: TURN - CAPACITY_DECISION_RETENTION_TURNS + 1 },
    });
    // Identifiers never reach the persisted document.
    const serialized = JSON.stringify(ops);
    for (const c of [foundingCorp, reinvestCorp]) {
      expect(serialized).not.toContain(c._id.toString());
      expect(serialized).not.toContain(c.name);
    }
    expect(serialized).not.toContain("ZZ-PROBE-STATE-7Q");
  });
});
