import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { applyDefenseAppropriation } from "./defenseAppropriationTurn";

const treasurySpends: { countryId: string; amount: number }[] = [];
vi.mock("@/lib/budget/treasurySpend", () => ({
  spendFromTreasury: vi.fn(async (_db: unknown, countryId: string, amount: number) => {
    treasurySpends.push({ countryId, amount });
    return { fromSurplus: 0, addedToDebt: 0, newTreasuryBalance: 0, newDebtPrincipal: 0 };
  }),
}));

interface Capture {
  updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
  unitOps: Record<string, unknown>[];
}

function stubDb(opts: {
  units: Record<string, unknown>[];
  budget: Record<string, unknown> | null;
  setting?: Record<string, unknown> | null;
  capture: Capture;
  /** Mirrors the real guarded write: refuses when the turn is already booked. */
  settleFails?: boolean;
}): Db {
  return {
    collection: (name: string) => {
      if (name === "militaryUnits") {
        return {
          find: () => ({ toArray: async () => opts.units }),
          bulkWrite: async (ops: Record<string, unknown>[]) => {
            opts.capture.unitOps.push(...ops);
            return { modifiedCount: ops.length };
          },
        };
      }
      if (name === "cabinetSettings") {
        return { findOne: async () => opts.setting ?? null };
      }
      return {
        findOne: async () => opts.budget,
        updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
          opts.capture.updates.push({ filter, update });
          const booked = opts.settleFails && "defenseAppropriation.accruedThroughTurn" in filter;
          return { matchedCount: 1, modifiedCount: booked ? 0 : 1 };
        },
      };
    },
  } as unknown as Db;
}

/** A US unit; US seeds a real roster so seedRosterUpkeepFor resolves a positive figure. */
const UNIT = {
  countryId: "US",
  upkeepBase: 100,
  posture: "standard",
  techTier: 1,
  personnel: 12_000,
  readiness: 70,
  basePower: 48,
  vet: 1,
  xp: 0,
  equipment: { firepower: 1, protection: 1, support: 1 },
};

const budgetWith = (extra: Record<string, unknown>) => ({
  countryId: "US",
  gdp: 387_000_000_000,
  spending: { byCategory: { defense: 52_800_000_000 } },
  ...extra,
});

const pot = (balance: number, accruedThroughTurn: number) => ({
  defenseAppropriation: { balance, accruedThroughTurn, arrearsRatio: 0 },
});

describe("applyDefenseAppropriation", () => {
  it("is a no-op for a country with no units", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [], budget: budgetWith(pot(0, 0)), capture });
    expect(await applyDefenseAppropriation(db, "US", 10, "1953-default")).toBeNull();
    expect(capture.updates).toHaveLength(0);
  });

  it("accrues and settles for a country that has units", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [UNIT], budget: budgetWith(pot(0, 9)), capture });
    const s = await applyDefenseAppropriation(db, "US", 10, "1953-default");
    expect(s).not.toBeNull();
    // One unit is far below the seeded US roster, so upkeep is a small share of accrual.
    expect(s!.balance).toBeGreaterThan(0);
    expect(s!.arrearsRatio).toBe(0);
    expect(capture.updates.at(-1)!.update).toMatchObject({
      $set: expect.objectContaining({ "defenseAppropriation.accruedThroughTurn": 10 }),
    });
  });

  // A retried turn must not credit the accrual twice.
  it("does not accrue twice for the same turn", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [UNIT], budget: budgetWith(pot(500, 10)), capture });
    expect(await applyDefenseAppropriation(db, "US", 10, "1953-default")).toBeNull();
    expect(capture.updates).toHaveLength(0);
  });

  it("does not accrue for a turn already passed", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [UNIT], budget: budgetWith(pot(500, 12)), capture });
    expect(await applyDefenseAppropriation(db, "US", 10, "1953-default")).toBeNull();
  });

  // No line means no appropriation to charge against — never a guessed charge.
  it("charges nothing when the country has no usable defence line", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({
      units: [{ ...UNIT, countryId: "ZZ" }],
      budget: { countryId: "ZZ", gdp: 0, ...pot(0, 0) },
      capture,
    });
    const s = await applyDefenseAppropriation(db, "ZZ", 10, "1953-default");
    expect(s!.arrearsRatio).toBe(0);
    expect(s!.paid).toBe(0);
    expect(s!.balance).toBe(0);
  });

  it("runs for a country with no defence seat, like reinforcement does", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    // AT has a seeded force but no DEFENSE_POSITION_BY_COUNTRY entry in most eras; the
    // sweep must still charge it rather than returning early the way force-effects does.
    const db = stubDb({
      units: [{ ...UNIT, countryId: "AT" }],
      budget: { countryId: "AT", gdp: 85_000_000_000, ...pot(0, 0) },
      setting: null,
      capture,
    });
    const s = await applyDefenseAppropriation(db, "AT", 10, "1953-default");
    expect(s).not.toBeNull();
    expect(capture.updates.length).toBeGreaterThan(0);
  });

  it("draws the overdraft to the treasury when upkeep outruns the balance", async () => {
    treasurySpends.length = 0;
    const capture: Capture = { updates: [], unitOps: [] };
    // A huge roster against a tiny line forces the overdraft path.
    const many = Array.from({ length: 400 }, () => UNIT);
    const db = stubDb({
      units: many,
      budget: budgetWith({ spending: { byCategory: { defense: 48_000 } }, ...pot(0, 0) }),
      capture,
    });
    const s = await applyDefenseAppropriation(db, "US", 10, "1953-default");
    expect(s!.overdraftDrawn).toBeGreaterThan(0);
    expect(treasurySpends).toHaveLength(1);
    expect(treasurySpends[0]).toEqual({ countryId: "US", amount: s!.overdraftDrawn });
  });

  it("does not touch the treasury when no overdraft is drawn", async () => {
    treasurySpends.length = 0;
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [UNIT], budget: budgetWith(pot(0, 0)), capture });
    await applyDefenseAppropriation(db, "US", 10, "1953-default");
    // The accrual is money processTreasuryTurn already deducted — charging it again here
    // would double-charge the whole defence line every turn.
    expect(treasurySpends).toHaveLength(0);
  });
});

describe("applyDefenseAppropriation — settlement is race-safe", () => {
  // An absolute `$set` of the balance would revert any debit a player's recruit landed
  // between this step's read and its write, minting the unit for free.
  it("applies the turn's net change as an $inc, never the closing balance", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: [UNIT], budget: budgetWith(pot(0, 9)), capture });
    const s = await applyDefenseAppropriation(db, "US", 10, "1953-default");

    const settle = capture.updates.at(-1)!;
    const inc = (settle.update as { $inc: Record<string, number> }).$inc;
    const set = (settle.update as { $set: Record<string, unknown> }).$set;
    expect(inc["defenseAppropriation.balance"]).toBe(Math.round(s!.delta));
    expect(set).not.toHaveProperty("defenseAppropriation.balance");
    // ...and the write is idempotent at the database, not only in the caller's pre-check.
    expect(settle.filter).toMatchObject({
      "defenseAppropriation.accruedThroughTurn": { $lt: 10 },
    });
  });
});

describe("applyDefenseAppropriation — readiness drift", () => {
  // Arrears begins only once the overdraft is exhausted: upkeep must exceed one accrual
  // plus one year's floor, i.e. the live roster must run ~89x the seeded one. A merely large
  // force draws the overdraft and reports zero arrears.
  const arrearsUnits = (countryId: string) =>
    Array.from({ length: 400 }, (_, i) => ({
      ...UNIT,
      countryId,
      _id: `u${i}`,
      upkeepBase: 2_000,
      readiness: 90,
    }));

  // The regression this suite exists for: drift used to live in `applyMilitaryForceEffects`,
  // which returns early with no defence seat — so FR/IT/ES/SE/TR/BR/GR/FI booked arrears that
  // nothing ever collected on and held full readiness on an unfunded army forever.
  it("suppresses readiness for a SEATLESS country in arrears", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({
      units: arrearsUnits("FR"),
      // A small line against a 400-unit roster is what puts the force into arrears.
      budget: {
        countryId: "FR",
        gdp: 60_000_000_000,
        spending: { byCategory: { defense: 2_000_000_000 } },
        ...pot(0, 9),
      },
      capture,
    });
    const s = await applyDefenseAppropriation(db, "FR", 10, "1953-default");

    expect(s!.arrearsRatio).toBeGreaterThan(0);
    expect(capture.unitOps.length).toBeGreaterThan(0);
    const next = (capture.unitOps[0] as { updateOne: { update: { $set: { readiness: number } } } })
      .updateOne.update.$set.readiness;
    expect(next).toBeLessThan(90);
  });

  it("still drifts a seated country", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({ units: arrearsUnits("US"), budget: budgetWith(pot(0, 9)), capture });
    await applyDefenseAppropriation(db, "US", 10, "1953-default");
    expect(capture.unitOps.length).toBeGreaterThan(0);
  });

  // Two overlapping turn passes must not move readiness two steps in one turn.
  it("does not drift when the guarded settlement lost the race", async () => {
    const capture: Capture = { updates: [], unitOps: [] };
    const db = stubDb({
      units: arrearsUnits("US"),
      budget: budgetWith(pot(0, 9)),
      capture,
      settleFails: true,
    });
    await applyDefenseAppropriation(db, "US", 10, "1953-default");
    expect(capture.unitOps).toHaveLength(0);
  });
});
