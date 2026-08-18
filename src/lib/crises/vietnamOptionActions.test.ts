import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/crises/applyEffects", () => ({
  applyCrisisEffects: vi.fn().mockResolvedValue(undefined),
}));
// The treasury primitive is replaced with one that moves the SAME money in the
// SAME store, so the conservation assertion below is a real ledger check rather
// than a check on a stub that returns whatever it is told to.
vi.mock("@/lib/budget/treasurySpend", () => ({
  spendFromTreasury: vi.fn(async (db: FakeDb, countryId: string, amount: number) => {
    const budget = db.store.federalBudget.get(countryId)!;
    budget.treasuryBalance -= amount;
    return { fromSurplus: amount, fromDebt: 0 };
  }),
}));

import { runCrisisOptionAction } from "./optionActions";
import { applyCrisisEffects } from "@/lib/crises/applyEffects";
import { getVietnamEscalation, supportPctGdpForLevel } from "./vietnamEscalation";

// ── A tiny in-memory Mongo stand-in: enough for findOne / updateOne with $set
//    and upsert, which is all the ladder and the budget read use. ────────────

interface BudgetRow {
  countryId: string;
  gdp: number;
  gdpSmoothed: number;
  treasuryBalance: number;
}

interface FakeDb {
  store: {
    federalBudget: Map<string, BudgetRow>;
    vietnamEscalation: Map<string, Record<string, unknown>>;
  };
  collection: (name: string) => {
    findOne: (filter: Record<string, unknown>) => Promise<unknown>;
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      opts?: { upsert?: boolean }
    ) => Promise<void>;
  };
}

const GDP = 500_000_000_000;
const START_TREASURY = 40_000_000_000;

function makeDb(): FakeDb {
  const store = {
    federalBudget: new Map<string, BudgetRow>([
      ["US", { countryId: "US", gdp: GDP, gdpSmoothed: GDP, treasuryBalance: START_TREASURY }],
      ["RU", { countryId: "RU", gdp: GDP, gdpSmoothed: GDP, treasuryBalance: START_TREASURY }],
    ]),
    vietnamEscalation: new Map<string, Record<string, unknown>>(),
  };

  const db: FakeDb = {
    store,
    collection(name: string) {
      const map =
        name === "federalBudget"
          ? (store.federalBudget as unknown as Map<string, Record<string, unknown>>)
          : name === "vietnamEscalation"
            ? store.vietnamEscalation
            : new Map<string, Record<string, unknown>>();
      const keyOf = (filter: Record<string, unknown>) =>
        String(filter._id ?? filter.countryId ?? "");
      return {
        async findOne(filter: Record<string, unknown>) {
          return map.get(keyOf(filter)) ?? null;
        },
        async updateOne(
          filter: Record<string, unknown>,
          update: Record<string, unknown>,
          opts?: { upsert?: boolean }
        ) {
          const key = keyOf(filter);
          const existing = map.get(key);
          if (!existing && !opts?.upsert) return;
          const set = (update.$set ?? {}) as Record<string, unknown>;
          map.set(key, { ...(existing ?? { _id: key }), ...set });
        },
      };
    },
  };
  return db;
}

function ctxFor(db: FakeDb, countryId: string, option: CrisisDecisionOption) {
  return {
    db: db as unknown as Db,
    crisis: { _id: new ObjectId(), countryIds: ["US", "RU"] } as unknown as Crisis,
    interaction: {} as CrisisInteraction,
    option,
    characterId: new ObjectId(),
    countryId,
    currentTurn: 40,
  };
}

const SUPPORT: CrisisDecisionOption = {
  optionId: "vietnam_support",
  label: "support",
  description: "",
  effects: [],
  nextNodeId: null,
  action: { kind: "vietnamSupport" },
};

const DEESCALATE: CrisisDecisionOption = {
  optionId: "vietnam_deescalate",
  label: "deescalate",
  description: "",
  effects: [],
  nextNodeId: null,
  action: { kind: "vietnamDeescalate" },
};

function treasury(db: FakeDb, countryId: string): number {
  return db.store.federalBudget.get(countryId)!.treasuryBalance;
}

async function seedLadder(db: FakeDb, level: number) {
  await db.collection("vietnamEscalation").updateOne(
    { _id: "current" },
    {
      $set: {
        hasOpened: true,
        level,
        westSupport: 0,
        eastSupport: 0,
        warTurns: 0,
        westSpend: 0,
        eastSpend: 0,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

let db: FakeDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = makeDb();
  await seedLadder(db, 1);
});

describe("Vietnam option actions", () => {
  it("prices a support pledge as the rung's share of GDP and debits the treasury", async () => {
    await runCrisisOptionAction(ctxFor(db, "US", SUPPORT));

    const expected = Math.round(supportPctGdpForLevel(1) * GDP);
    expect(START_TREASURY - treasury(db, "US")).toBe(expected);
    const state = await getVietnamEscalation(db as unknown as Db);
    expect(state.westSpend).toBe(expected);
    expect(state.westSupport).toBeGreaterThan(0);
  });

  it("charges the escalating leader with anti-war opinion", async () => {
    await runCrisisOptionAction(ctxFor(db, "US", SUPPORT));
    const effects = vi.mocked(applyCrisisEffects).mock.calls.flatMap((c) => c[1]);
    const antiWar = effects.find((e) => e.label.includes("Anti-war"));
    expect(antiWar).toBeDefined();
    expect(antiWar!.value).toBeLessThan(0);
  });

  it("charges the de-escalating leader with hawks and spends nothing", async () => {
    await seedLadder(db, 4);
    await runCrisisOptionAction(ctxFor(db, "US", DEESCALATE));

    expect(treasury(db, "US")).toBe(START_TREASURY);
    const effects = vi.mocked(applyCrisisEffects).mock.calls.flatMap((c) => c[1]);
    expect(effects.some((e) => e.label.includes("Hawks"))).toBe(true);
  });

  it("routes each superpower to its own side of the ladder", async () => {
    await runCrisisOptionAction(ctxFor(db, "RU", SUPPORT));
    const state = await getVietnamEscalation(db as unknown as Db);
    expect(state.eastSupport).toBeGreaterThan(0);
    expect(state.westSupport).toBe(0);
    expect(state.eastSpend).toBeGreaterThan(0);
    expect(state.westSpend).toBe(0);
  });

  it("ignores a country that is not on the ladder", async () => {
    await runCrisisOptionAction(ctxFor(db, "UK", SUPPORT));
    const state = await getVietnamEscalation(db as unknown as Db);
    expect(state.westSupport).toBe(0);
    expect(state.eastSupport).toBe(0);
  });

  /**
   * The conservation check. Over a full climb and a full climb-down, every unit
   * the ladder records as spent must be a unit that left a treasury, and the
   * climb-down must neither mint a refund nor charge again. Escalation is
   * expensive and irreversible in money terms; that is the design, and this is
   * the test that stops a future edit from quietly making it free or refundable.
   */
  it("conserves money across a full escalate-then-deescalate cycle", async () => {
    const usStart = treasury(db, "US");
    const ruStart = treasury(db, "RU");

    for (let i = 0; i < 4; i++) {
      await runCrisisOptionAction(ctxFor(db, "US", SUPPORT));
      await runCrisisOptionAction(ctxFor(db, "RU", SUPPORT));
    }
    const climbed = await getVietnamEscalation(db as unknown as Db);
    expect(climbed.level).toBeGreaterThan(1);

    const usAfterClimb = treasury(db, "US");
    const ruAfterClimb = treasury(db, "RU");

    for (let i = 0; i < 10; i++) {
      await runCrisisOptionAction(ctxFor(db, "US", DEESCALATE));
      await runCrisisOptionAction(ctxFor(db, "RU", DEESCALATE));
    }
    const wound = await getVietnamEscalation(db as unknown as Db);
    expect(wound.level).toBeLessThan(climbed.level);

    // The climb-down moves no money in either direction.
    expect(treasury(db, "US")).toBe(usAfterClimb);
    expect(treasury(db, "RU")).toBe(ruAfterClimb);

    // Every unit the ladder booked came out of a treasury, exactly once.
    expect(usStart - treasury(db, "US")).toBe(wound.westSpend);
    expect(ruStart - treasury(db, "RU")).toBe(wound.eastSpend);
    expect(wound.westSpend).toBeGreaterThan(0);
    expect(wound.eastSpend).toBeGreaterThan(0);
  });
});
