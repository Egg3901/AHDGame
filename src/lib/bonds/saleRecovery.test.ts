import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  advanceBondSaleIntent,
  bondSaleLegStamp,
  createBondSaleIntent,
  listUnfinishedBondSales,
  loadPendingBondSaleIntents,
  type BondSaleIntent,
  type BondSaleSettlementOps,
} from "./saleRecovery";

const CRASH = new Error("simulated process death");

interface FakeWorld {
  holderUnits: number;
  publicFloat: number;
  holderStamp: string | undefined;
  poolCash: number;
  poolStamps: string[];
  sellerBalance: number;
  sellerExists: boolean;
  sellerStamps: string[];
}

/** Minimal fake Db backing only the intent collection used by saleRecovery. */
function makeFakeDb(intents: BondSaleIntent[]): Db {
  const matches = (doc: BondSaleIntent, query: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(query)) {
      const actual = (doc as unknown as Record<string, unknown>)[key];
      if (value instanceof ObjectId) {
        if (!(actual instanceof ObjectId) || !actual.equals(value)) return false;
      } else if (actual !== value) return false;
    }
    return true;
  };
  const chain = (rows: BondSaleIntent[]) => ({
    sort: () => chain(rows),
    limit: () => chain(rows),
    toArray: async () => rows,
  });
  return {
    collection: () => ({
      insertOne: async (doc: BondSaleIntent) => {
        intents.push({ ...doc });
        return { acknowledged: true, insertedId: doc._id };
      },
      find: (query: Record<string, unknown>) => chain(intents.filter((d) => matches(d, query))),
      findOne: async () => null,
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> }
      ) => {
        const doc = intents.find((d) => matches(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(doc, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
}

interface Harness {
  db: Db;
  intents: BondSaleIntent[];
  world: FakeWorld;
  intent: BondSaleIntent;
  claimStamp: string;
  poolStamp: string;
  payoutStamp: string;
  /** Ops that throw CRASH at the named boundary (write already performed where noted). */
  opsWithCrashAt: (
    point?: "claimLanded" | "debit" | "pay" | "restore" | "refund"
  ) => BondSaleSettlementOps;
  ops: BondSaleSettlementOps;
}

async function makeHarness(options?: {
  units?: number;
  holderUnits?: number;
  poolCash?: number;
  sellerExists?: boolean;
}): Promise<Harness> {
  const units = options?.units ?? 3;
  const world: FakeWorld = {
    holderUnits: options?.holderUnits ?? 5,
    publicFloat: 10,
    holderStamp: undefined,
    poolCash: options?.poolCash ?? 1_000_000,
    poolStamps: [],
    sellerBalance: 0,
    sellerExists: options?.sellerExists ?? true,
    sellerStamps: [],
  };
  const intents: BondSaleIntent[] = [];
  const db = makeFakeDb(intents);
  const bondId = new ObjectId();
  const holderId = new ObjectId();
  // The claim is the route's write; the harness performs it the way the route
  // does (units move and the stamp lands in the same write), then resumes.
  const intent = await createBondSaleIntent(db, {
    bondId,
    holderKey: "characterId",
    holderId,
    sellerCollection: "characters",
    units,
    proceedsLocal: units * 980,
    poolCurrency: "USD",
    payoutInc: { cashOnHand: units * 980 },
  });
  const claimStamp = bondSaleLegStamp(intent._id, "claim");
  const poolStamp = bondSaleLegStamp(intent._id, "pool");
  const payoutStamp = bondSaleLegStamp(intent._id, "payout");

  const baseOps = (crashAt?: string): BondSaleSettlementOps => ({
    claimLanded: async () => {
      if (crashAt === "claimLanded") throw CRASH;
      return world.holderStamp === claimStamp;
    },
    debitPool: async (stamp) => {
      if (world.poolStamps.includes(stamp)) return "already";
      if (world.poolCash < intent.proceedsLocal) return "refused";
      world.poolCash -= intent.proceedsLocal;
      world.poolStamps.push(stamp);
      if (crashAt === "debit") throw CRASH;
      return "applied";
    },
    paySeller: async (stamp) => {
      if (!world.sellerExists) return "missing";
      if (world.sellerStamps.includes(stamp)) return "already";
      world.sellerBalance += intent.proceedsLocal;
      world.sellerStamps.push(stamp);
      if (crashAt === "pay") throw CRASH;
      return "applied";
    },
    restoreClaim: async () => {
      if (crashAt === "restore") throw CRASH;
      if (world.holderStamp === claimStamp) {
        world.holderUnits += intent.units;
        world.publicFloat -= intent.units;
        world.holderStamp = undefined;
      }
    },
    refundPool: async () => {
      if (crashAt === "refund") throw CRASH;
      if (world.poolStamps.includes(poolStamp)) {
        world.poolCash += intent.proceedsLocal;
        world.poolStamps = world.poolStamps.filter((s) => s !== poolStamp);
      }
    },
  });

  return {
    db,
    intents,
    world,
    intent,
    claimStamp,
    poolStamp,
    payoutStamp,
    opsWithCrashAt: (point) => baseOps(point),
    ops: baseOps(),
  };
}

/** Perform the route's claim write: units move and the stamp lands together. */
function applyClaim(h: Harness): void {
  h.world.holderUnits -= h.intent.units;
  h.world.publicFloat += h.intent.units;
  h.world.holderStamp = h.claimStamp;
}

function expectConserved(h: Harness, holderBefore: number, floatBefore: number): void {
  // Units are neither created nor destroyed: holder + float is constant.
  expect(h.world.holderUnits + h.world.publicFloat).toBe(holderBefore + floatBefore);
}

describe("advanceBondSaleIntent", () => {
  it("completes a sale that crashed right after the claim, exactly once", async () => {
    const h = await makeHarness();
    applyClaim(h);
    const holderBefore = h.world.holderUnits;
    const floatBefore = h.world.publicFloat;
    const poolBefore = h.world.poolCash;

    const outcome = await advanceBondSaleIntent(h.db, h.intent, h.ops);

    expect(outcome).toBe("applied");
    expect(h.world.sellerBalance).toBe(h.intent.proceedsLocal);
    expect(h.world.poolCash).toBe(poolBefore - h.intent.proceedsLocal);
    expectConserved(h, holderBefore, floatBefore);
    // A second resume is a no-op: nothing moves twice.
    const again = await advanceBondSaleIntent(h.db, h.intent, h.ops);
    expect(again).toBe("applied");
    expect(h.world.sellerBalance).toBe(h.intent.proceedsLocal);
    expect(h.world.poolCash).toBe(poolBefore - h.intent.proceedsLocal);
  });

  it("pays once without a second pool debit after a crash between pool and payout", async () => {
    const h = await makeHarness();
    applyClaim(h);
    // First attempt lands the pool debit, then dies before the payout.
    await expect(advanceBondSaleIntent(h.db, h.intent, h.opsWithCrashAt("debit"))).rejects.toThrow(
      CRASH
    );
    const poolAfterCrash = h.world.poolCash;
    expect(h.world.sellerBalance).toBe(0);

    const outcome = await advanceBondSaleIntent(h.db, h.intent, h.ops);

    expect(outcome).toBe("applied");
    expect(h.world.poolCash).toBe(poolAfterCrash);
    expect(h.world.sellerBalance).toBe(h.intent.proceedsLocal);
  });

  it("is a no-op when every leg landed before the crash", async () => {
    const h = await makeHarness();
    applyClaim(h);
    await expect(advanceBondSaleIntent(h.db, h.intent, h.opsWithCrashAt("pay"))).rejects.toThrow(
      CRASH
    );
    // Pool and payout both landed; only the terminal marking was lost. Reload
    // the intent the way a fresh process would (flags still stale).
    const [pending] = await loadPendingBondSaleIntents(
      h.db,
      h.intent.bondId,
      "characterId",
      h.intent.holderId
    );
    const poolBefore = h.world.poolCash;
    const sellerBefore = h.world.sellerBalance;

    const outcome = await advanceBondSaleIntent(h.db, pending, h.ops);

    expect(outcome).toBe("applied");
    expect(h.world.poolCash).toBe(poolBefore);
    expect(h.world.sellerBalance).toBe(sellerBefore);
    expect(h.world.sellerStamps.filter((s) => s === h.payoutStamp)).toHaveLength(1);
  });

  it("restores the claim when the pool cannot cover on resume", async () => {
    const h = await makeHarness({ poolCash: 0 });
    applyClaim(h);
    const holderBefore = h.world.holderUnits + h.intent.units;
    const floatBefore = h.world.publicFloat - h.intent.units;

    const outcome = await advanceBondSaleIntent(h.db, h.intent, h.ops);

    expect(outcome).toBe("reverted");
    expect(h.world.holderUnits).toBe(holderBefore);
    expect(h.world.publicFloat).toBe(floatBefore);
    expect(h.world.holderStamp).toBeUndefined();
    expect(h.world.poolCash).toBe(0);
    expect(h.world.sellerBalance).toBe(0);
    expect(
      await loadPendingBondSaleIntents(h.db, h.intent.bondId, "characterId", h.intent.holderId)
    ).toHaveLength(0);
  });

  it("restores the claim and refunds the pool when the seller is gone", async () => {
    const h = await makeHarness({ sellerExists: false });
    applyClaim(h);
    const holderBefore = h.world.holderUnits + h.intent.units;
    const poolBefore = h.world.poolCash;

    const outcome = await advanceBondSaleIntent(h.db, h.intent, h.ops);

    expect(outcome).toBe("reverted");
    expect(h.world.holderUnits).toBe(holderBefore);
    expect(h.world.poolCash).toBe(poolBefore);
    expect(h.world.sellerBalance).toBe(0);
  });

  it("rejects without moving anything when the claim never landed", async () => {
    const h = await makeHarness();
    // No applyClaim: the claim write never arrived (or its response was lost
    // before the write). The stamp is absent, so no later leg can have landed.
    const poolBefore = h.world.poolCash;

    const outcome = await advanceBondSaleIntent(h.db, h.intent, h.ops);

    expect(outcome).toBe("reverted");
    expect(h.world.holderUnits).toBe(5);
    expect(h.world.publicFloat).toBe(10);
    expect(h.world.poolCash).toBe(poolBefore);
    expect(h.world.sellerBalance).toBe(0);
    expect(h.intents[0].status).toBe("rejected");
  });

  it("refunds a stamped pool debit when the claim was restored before a crash", async () => {
    const h = await makeHarness();
    applyClaim(h);
    await expect(advanceBondSaleIntent(h.db, h.intent, h.opsWithCrashAt("debit"))).rejects.toThrow(
      CRASH
    );
    const poolAfterDebit = h.world.poolCash;

    // Simulate the missing-seller rollback landing its claim restoration, then
    // process death before the next refund write.
    h.world.holderUnits += h.intent.units;
    h.world.publicFloat -= h.intent.units;
    h.world.holderStamp = undefined;

    const outcome = await advanceBondSaleIntent(h.db, h.intents[0], h.ops);

    expect(outcome).toBe("reverted");
    expect(h.world.poolCash).toBe(poolAfterDebit + h.intent.proceedsLocal);
    expect(h.world.poolStamps).not.toContain(h.poolStamp);
    expect(h.world.sellerBalance).toBe(0);
  });

  it("uses stable per-leg stamps across attempts", () => {
    const id = new ObjectId();
    expect(bondSaleLegStamp(id, "pool")).toBe(`${id.toHexString()}#pool`);
    expect(bondSaleLegStamp(id, "payout")).toBe(`${id.toHexString()}#payout`);
    expect(bondSaleLegStamp(id, "claim")).not.toBe(bondSaleLegStamp(id, "pool"));
  });

  it("lists only unfinished sales in the repair queue", async () => {
    const h = await makeHarness();
    expect(await listUnfinishedBondSales(h.db)).toHaveLength(1);
    applyClaim(h);
    await advanceBondSaleIntent(h.db, h.intent, h.ops);
    expect(await listUnfinishedBondSales(h.db)).toHaveLength(0);
  });
});
