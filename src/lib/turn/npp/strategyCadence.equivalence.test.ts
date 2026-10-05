/**
 * Seeded equivalence replay for the NPP strategy cadence split (#2693).
 *
 * The golden trace in `__fixtures__/strategyCadence.golden.json` began with the
 * pre-split brain and was recalibrated for issue #3262's intended construction
 * pricing and standard recipe changes. The split must reproduce every
 * budget, dividend, divestment, founding and strategy decision exactly, for
 * healthy, losing, debt-dominant, low-fill and caretaker corporations across a
 * long synthetic window, including turns on and off the stagger slot.
 *
 * Regenerate only for an intended behaviour change:
 *   UPDATE_STRATEGY_GOLDEN=1 npx vitest run src/lib/turn/npp/strategyCadence.equivalence.test.ts
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { makeNppCorpDecision, type NppPlantsContext } from "../nppCorporationBehavior";
import { ceoArchetypeModifiers } from "@/lib/npp/ceoArchetype";
import { glutStaggerEligible } from "./cohort";
import {
  advanceStrategy,
  NPP_CORP_STRATEGIES,
  type NppStrategyState,
  type StrategySituation,
} from "./corpStrategy";
import {
  memoizeOnce,
  strategyEvaluationDue,
  strategyStateNeedsPersist,
} from "./rules/strategyCadence";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

const GOLDEN = join(__dirname, "__fixtures__", "strategyCadence.golden.json");
const TURNS = 120;
const START_TURN = 1000;
const NOW = new Date("2026-01-01T00:00:00.000Z");

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const oid = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

const POOL_REVENUE = 40_000_000;
const pool = (): UnownedSector =>
  ({
    _id: oid(9000),
    stateId: "NY",
    countryId: "US",
    sectorType: "manufacturing",
    revenue: POOL_REVENUE,
    headroomUnits: computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1),
  }) as unknown as UnownedSector;

interface Fixture {
  name: string;
  seed: number;
  corpId: number;
  /** Base margin (percent) and drift amplitude of the synthetic sector. */
  margin: number;
  drift: number;
  soldFraction: number;
  debtServiceAnchor: number;
  caretaker: boolean;
  headroom: boolean;
}

const FIXTURES: Fixture[] = [
  {
    name: "healthy",
    seed: 11,
    corpId: 101,
    margin: 32,
    drift: 4,
    soldFraction: 1,
    debtServiceAnchor: 0,
    caretaker: false,
    headroom: true,
  },
  {
    name: "healthy-boxed-in",
    seed: 12,
    corpId: 102,
    margin: 28,
    drift: 6,
    soldFraction: 0.95,
    debtServiceAnchor: 0,
    caretaker: false,
    headroom: false,
  },
  {
    name: "thin",
    seed: 13,
    corpId: 103,
    margin: 6,
    drift: 8,
    soldFraction: 0.8,
    debtServiceAnchor: 0,
    caretaker: false,
    headroom: true,
  },
  {
    name: "losing",
    seed: 14,
    corpId: 104,
    margin: -12,
    drift: 10,
    soldFraction: 0.7,
    debtServiceAnchor: 0,
    caretaker: false,
    headroom: true,
  },
  {
    name: "debt-dominant",
    seed: 15,
    corpId: 105,
    margin: 20,
    drift: 5,
    soldFraction: 1,
    debtServiceAnchor: 900_000,
    caretaker: false,
    headroom: true,
  },
  {
    name: "low-fill",
    seed: 16,
    corpId: 106,
    margin: 18,
    drift: 5,
    soldFraction: 0.1,
    debtServiceAnchor: 0,
    caretaker: false,
    headroom: true,
  },
  {
    name: "caretaker",
    seed: 17,
    corpId: 107,
    margin: 4,
    drift: 9,
    soldFraction: 0.9,
    debtServiceAnchor: 0,
    caretaker: true,
    headroom: true,
  },
  {
    name: "oscillating",
    seed: 18,
    corpId: 108,
    margin: 10,
    drift: 40,
    soldFraction: 0.6,
    debtServiceAnchor: 100_000,
    caretaker: false,
    headroom: false,
  },
];

function buildCorp(f: Fixture): Corporation {
  return {
    _id: oid(f.corpId),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital: 10_000_000,
    ceoType: "npp",
    ...(f.caretaker ? { caretakerCeo: { mandate: "active" } } : {}),
  } as unknown as Corporation;
}

function buildSector(f: Fixture, rng: () => number): CorporateSector {
  const margin = f.margin + (rng() * 2 - 1) * f.drift;
  return {
    _id: oid(f.corpId * 10),
    sectorType: "technology",
    countryId: "US",
    stateId: "NY",
    revenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: margin,
    effectiveProfitMargin: margin,
    targetGrowthRate: 2,
    capitalStock: 1000,
    producedUnits: 1000,
    soldUnits: Math.round(1000 * f.soldFraction),
    soldFraction: f.soldFraction,
  } as unknown as CorporateSector;
}

/** Strip nondeterminism (fresh ObjectIds) and the unread `lastScore` diagnostic. */
function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key === "lastScore") return undefined;
      if (v && typeof v === "object" && typeof (v as ObjectId).toHexString === "function") {
        const hex = (v as ObjectId).toHexString();
        return Number.parseInt(hex, 16) < 20_000 ? hex : "<generated>";
      }
      if (v instanceof Date) return v.toISOString();
      return v;
    })
  );
}

type Decision = ReturnType<typeof makeNppCorpDecision>;

/**
 * Replay one fixture. `carry` picks the strategy state fed into the next turn:
 * the full decision state (legacy persistence) or only what the persistence
 * gate would have written.
 */
function replay(
  f: Fixture,
  carry: (
    prior: NppStrategyState | undefined,
    next: NppStrategyState | undefined
  ) => NppStrategyState | undefined
) {
  const rng = mulberry32(f.seed);
  const corp = buildCorp(f);
  const trace: unknown[] = [];
  let stored: NppStrategyState | undefined;
  for (let i = 0; i < TURNS; i++) {
    const turn = START_TURN + i;
    const eligible = glutStaggerEligible(corp._id.toString(), turn);
    const decision: Decision = makeNppCorpDecision(
      {
        corp: { ...corp, ...(stored ? { nppStrategy: stored } : {}) },
        sectors: [buildSector(f, rng)],
        turn,
        now: NOW,
        fxRate: 1,
        modifiers: ceoArchetypeModifiers("cautious"),
        strategy: stored,
        strategyEligible: eligible,
        ordinaryEntryEligible: eligible,
        shortageEntryEligible: eligible,
        debtServiceAnchor: f.debtServiceAnchor,
        caretakerMandate: "active",
      },
      new Map<string, UnownedSector[]>([["US", f.headroom ? [pool()] : []]]),
      new Set<string>(),
      () => null,
      plantsCtx
    );
    const normalized = normalize({ turn, eligible, decision });
    trace.push([
      turn,
      decision.strategy?.id ?? null,
      createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16),
    ]);
    stored = carry(stored, decision.strategy);
  }
  return trace;
}

const legacyCarry = (_prior: NppStrategyState | undefined, next: NppStrategyState | undefined) =>
  next;

describe("strategy cadence split (#2693): decisions are unchanged", () => {
  const traces: Record<string, unknown[]> = {};
  for (const f of FIXTURES) traces[f.name] = replay(f, legacyCarry);

  if (process.env.UPDATE_STRATEGY_GOLDEN === "1") {
    it("writes the golden trace", () => {
      writeFileSync(GOLDEN, JSON.stringify(traces) + "\n");
    });
    return;
  }

  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown[]>;

  for (const f of FIXTURES) {
    it(`${f.name}: ${TURNS}-turn decision trace matches the pre-split golden`, () => {
      expect(traces[f.name]).toEqual(golden[f.name]);
    });
  }

  it("covers switching, not just holding", () => {
    const switched = FIXTURES.filter((f) => {
      const ids = new Set(traces[f.name].map((t) => (t as [number, string | null, string])[1]));
      return ids.size > 1;
    });
    expect(switched.length).toBeGreaterThanOrEqual(3);
  });

  it("persisting only meaningful changes yields the identical trace", () => {
    for (const f of FIXTURES) {
      const gated = replay(f, (prior, next) =>
        next && strategyStateNeedsPersist(prior, next) ? next : prior
      );
      expect(gated, f.name).toEqual(golden[f.name]);
    }
  });

  it("the persistence gate writes far less often than every turn", () => {
    for (const f of FIXTURES) {
      let writes = 0;
      replay(f, (prior, next) => {
        if (next && strategyStateNeedsPersist(prior, next)) {
          writes++;
          return next;
        }
        return prior;
      });
      expect(writes, f.name).toBeLessThan(TURNS / 2);
    }
  });
});

describe("strategy evaluation cadence", () => {
  const trapped = (score: number): StrategySituation => ({
    score,
    debtDominant: false,
    chronicLowFill: false,
    isCaretaker: false,
    get hasHeadroom(): boolean {
      throw new Error("headroom read while evaluation was not due");
    },
  });

  it("never reads the situation beyond the score when evaluation is not due", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const id = NPP_CORP_STRATEGIES[Math.floor(rng() * NPP_CORP_STRATEGIES.length)];
      const prior: NppStrategyState = {
        id,
        adoptedTurn: 1000 - Math.floor(rng() * 80),
        baselineScore: rng() * 40 - 20,
      };
      const turn = 1000;
      const eligible = rng() < 0.5;
      const score = rng() * 60 - 30;
      if (strategyEvaluationDue({ prior, turn, eligible })) continue;
      const out = advanceStrategy({ prior, turn, situation: trapped(score), eligible });
      expect(out.changed).toBe(false);
      expect(out.state.id).toBe(prior.id);
    }
  });

  it("is due on first sight and for a held strategy past tenure on its slot", () => {
    expect(strategyEvaluationDue({ prior: undefined, turn: 5, eligible: false })).toBe(true);
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 100, baselineScore: 0 };
    expect(strategyEvaluationDue({ prior, turn: 105, eligible: true })).toBe(false);
    expect(strategyEvaluationDue({ prior, turn: 108, eligible: false })).toBe(false);
    expect(strategyEvaluationDue({ prior, turn: 108, eligible: true })).toBe(true);
  });

  it("memoizeOnce computes once", () => {
    let calls = 0;
    const read = memoizeOnce(() => ++calls);
    expect([read(), read(), read()]).toEqual([1, 1, 1]);
  });

  it("persistence ignores lastScore only", () => {
    const stored: NppStrategyState = {
      id: "expand",
      adoptedTurn: 10,
      baselineScore: 5,
      lastScore: 6,
      scores: { expand: 7 },
    };
    expect(strategyStateNeedsPersist(stored, { ...stored, lastScore: 9 })).toBe(false);
    expect(strategyStateNeedsPersist(stored, { ...stored, scores: { expand: 8 } })).toBe(true);
    expect(strategyStateNeedsPersist(stored, { ...stored, id: "harvest" })).toBe(true);
    expect(strategyStateNeedsPersist(stored, { ...stored, adoptedTurn: 11 })).toBe(true);
    expect(strategyStateNeedsPersist(stored, { ...stored, baselineScore: 6 })).toBe(true);
    expect(strategyStateNeedsPersist(undefined, stored)).toBe(true);
  });
});
