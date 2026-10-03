import { randomUUID } from "node:crypto";
/** Interrupted queued payouts converge to one cash transfer and one final receipt. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { IndexFund } from "@/lib/db/types";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { processQueuedRedemptions } from "./fundCron";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function fixture() {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  const fundId = new ObjectId(),
    nppId = new ObjectId(),
    entryId = new ObjectId();
  const now = new Date("2000-01-01T00:00:00Z");
  const fund: IndexFund = {
    _id: fundId,
    slug: "recovery-fixture",
    name: "Synthetic Fund",
    tickerSymbol: "RFX",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 100,
    reserveUnits: 0,
    cashAnchor: 1000,
    targetConstituents: [],
    holdings: [],
    createdAt: now,
    updatedAt: now,
  };
  memory.seed("indexFunds", [{ ...fund }]);
  memory.seed("npps", [{ _id: nppId, countryId: "US", nppInvestmentCashAnchor: 50 }]);
  memory.seed("indexFundRedemptionQueue", [
    {
      _id: entryId,
      fundId,
      holderKind: "npp",
      nppId,
      units: 10,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 1000,
      paidAmountAnchor: 0,
      status: "queued",
      unitsBurnedAtRequest: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 7 }]);
  return { memory, db, fund, fundId, nppId, entryId };
}

describe("queued redemption recovery", () => {
  it.each(["indexFunds", "npps"])(
    "finishes a payout after lost %s acknowledgement without repeating value",
    async (collectionName) => {
      const { memory, db, fund, fundId, nppId, entryId } = fixture();
      const target = memory.collection(collectionName);
      const update = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof update>) => {
        const result = await update(...args);
        const change = args[1] as { $inc?: Record<string, number> };
        const cashPath = collectionName === "indexFunds" ? "cashAnchor" : "nppInvestmentCashAnchor";
        if (!interrupted && change.$inc?.[cashPath]) {
          interrupted = true;
          throw new Error("Synthetic acknowledgement lost");
        }
        return result;
      };
      await processQueuedRedemptions(db, fund, false, 7).catch(() => undefined);
      expect(interrupted).toBe(true);
      for (let retry = 0; retry < 3; retry++) {
        const current = await db.collection<IndexFund>("indexFunds").findOne({ _id: fundId });
        await processQueuedRedemptions(db, current!, false, 8 + retry);
      }
      const finalFund = await db.collection("indexFunds").findOne({ _id: fundId });
      const holder = await db.collection("npps").findOne({ _id: nppId });
      const entry = await db.collection("indexFundRedemptionQueue").findOne({ _id: entryId });
      expect(finalFund!.cashAnchor + holder!.nppInvestmentCashAnchor).toBe(1050);
      expect(holder!.nppInvestmentCashAnchor).toBe(1050);
      expect(entry).toMatchObject({ status: "paid", units: 0, paidAmountAnchor: 1000 });
      expect(memory.collection("indexFundTransactions").docs).toHaveLength(1);
    }
  );
});

async function retryPayout(f: ReturnType<typeof fixture>, turn = 8) {
  const current = await f.db.collection<IndexFund>("indexFunds").findOne({ _id: f.fundId });
  return processQueuedRedemptions(f.db, current!, false, turn);
}
async function assertPaidOnce(f: ReturnType<typeof fixture>) {
  expect(
    await f.db.collection("indexFundRedemptionQueue").findOne({ _id: f.entryId })
  ).toMatchObject({ status: "paid", units: 0, paidAmountAnchor: 1000 });
  expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
    cashAnchor: 0,
  });
  expect(await f.db.collection("npps").findOne({ _id: f.nppId })).toMatchObject({
    nppInvestmentCashAnchor: 1050,
  });
  expect(f.memory.collection("indexFundTransactions").docs).toHaveLength(1);
  expect(f.memory.collection("financialTxLog").docs).toHaveLength(1);
  expect(f.memory.collection("ledgerEntries").docs).toHaveLength(2);
  expect(f.memory.collection("actionAuditLog").docs).toHaveLength(1);
}

describe("queued payout receipt and claim boundaries", () => {
  it.each(["indexFundTransactions", "financialTxLog", "ledgerEntries", "actionAuditLog"])(
    "recovers lost %s insertion acknowledgement",
    async (name) => {
      const f = fixture(),
        target = f.memory.collection(name),
        insert = target.insertOne.bind(target);
      let interrupted = false;
      target.insertOne = async (...args: Parameters<typeof insert>) => {
        const result = await insert(...args);
        if (!interrupted) {
          interrupted = true;
          throw new Error("Synthetic receipt acknowledgement lost");
        }
        return result;
      };
      await processQueuedRedemptions(f.db, f.fund, false, 7).catch(() => undefined);
      expect(interrupted).toBe(true);
      await retryPayout(f);
      await retryPayout(f, 9);
      await assertPaidOnce(f);
    }
  );
  it("acknowledges a finalized queue even after its update acknowledgement is lost", async () => {
    const f = fixture(),
      queue = f.memory.collection("indexFundRedemptionQueue"),
      update = queue.updateOne.bind(queue);
    let interrupted = false;
    queue.updateOne = async (...args: Parameters<typeof update>) => {
      const result = await update(...args);
      if (!interrupted && (args[1] as { $set?: { status?: string } }).$set?.status === "paid") {
        interrupted = true;
        throw new Error("Synthetic final acknowledgement lost");
      }
      return result;
    };
    await processQueuedRedemptions(f.db, f.fund, false, 7).catch(() => undefined);
    expect(interrupted).toBe(true);
    await retryPayout(f);
    await retryPayout(f, 9);
    await assertPaidOnce(f);
    const journal = await f.db
      .collection<{ _id: string; projections: { applied: boolean }[] }>(MONEY_MOVE_COLLECTION)
      .find({})
      .toArray();
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ status: "applied" });
    expect(journal[0].projections.every((p: { applied: boolean }) => p.applied)).toBe(true);
  });
  it("settles one obligation under simultaneous payer calls", async () => {
    const f = fixture();
    await Promise.all([
      processQueuedRedemptions(f.db, f.fund, false, 7),
      processQueuedRedemptions(f.db, f.fund, false, 7),
    ]);
    await retryPayout(f);
    await assertPaidOnce(f);
  });
  it("leaves missing holders unpaid without debiting fund cash", async () => {
    const f = fixture();
    await f.db.collection("npps").deleteMany({});
    expect(await processQueuedRedemptions(f.db, f.fund, false, 7)).toBe(0);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      cashAnchor: 1000,
      unitSupply: 100,
    });
    expect(
      await f.db.collection("indexFundRedemptionQueue").findOne({ _id: f.entryId })
    ).toMatchObject({ status: "queued", units: 10 });
    expect(f.memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
  });
  it("burns legacy supply with the debit and never burns it again on recovery", async () => {
    const f = fixture();
    await f.db
      .collection("indexFundRedemptionQueue")
      .updateOne({ _id: f.entryId }, { $unset: { unitsBurnedAtRequest: "" } });
    await processQueuedRedemptions(f.db, f.fund, false, 7);
    await retryPayout(f);
    await assertPaidOnce(f);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      unitSupply: 90,
    });
  });
  it("refuses legacy supply that changed after the caller's quote", async () => {
    const f = fixture();
    await f.db
      .collection("indexFundRedemptionQueue")
      .updateOne({ _id: f.entryId }, { $unset: { unitsBurnedAtRequest: "" } });
    await f.db.collection("indexFunds").updateOne({ _id: f.fundId }, { $inc: { unitSupply: 1 } });
    expect(await processQueuedRedemptions(f.db, f.fund, false, 7)).toBe(0);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      cashAnchor: 1000,
      unitSupply: 101,
    });
    expect(await f.db.collection("npps").findOne({ _id: f.nppId })).toMatchObject({
      nppInvestmentCashAnchor: 50,
    });
    await retryPayout(f);
    await assertPaidOnce(f);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      unitSupply: 91,
    });
  });
  it("preserves ambiguous legacy processing rows instead of inventing delivery proof", async () => {
    const f = fixture();
    await f.db
      .collection("indexFundRedemptionQueue")
      .updateOne({ _id: f.entryId }, { $set: { status: "processing" } });
    expect(await processQueuedRedemptions(f.db, f.fund, false, 8)).toBe(0);
    expect(
      await f.db.collection("indexFundRedemptionQueue").findOne({ _id: f.entryId })
    ).toMatchObject({ status: "processing", units: 10, paidAmountAnchor: 0 });
    expect(f.memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      cashAnchor: 1000,
    });
  });
});

describe("frozen payout compensation and currency", () => {
  it("compensates a proven holder refusal once and restores legacy units", async () => {
    const f = fixture();
    await f.db
      .collection("indexFundRedemptionQueue")
      .updateOne({ _id: f.entryId }, { $unset: { unitsBurnedAtRequest: "" } });
    const target = f.memory.collection("npps"),
      update = target.updateOne.bind(target);
    let refused = false;
    target.updateOne = async (...args: Parameters<typeof update>) => {
      if (
        !refused &&
        (args[1] as { $inc?: { nppInvestmentCashAnchor?: number } }).$inc?.nppInvestmentCashAnchor
      ) {
        refused = true;
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      return update(...args);
    };
    expect(await processQueuedRedemptions(f.db, f.fund, false, 7)).toBe(0);
    expect(refused).toBe(true);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      cashAnchor: 1000,
      unitSupply: 100,
    });
    expect(await f.db.collection("npps").findOne({ _id: f.nppId })).toMatchObject({
      nppInvestmentCashAnchor: 50,
    });
    expect(f.memory.collection("financialTxLog").docs).toHaveLength(0);
    expect(
      f.memory.collection(MONEY_MOVE_COLLECTION).docs.filter((row) => row.status === "partial")
    ).toHaveLength(0);
    await retryPayout(f);
    await retryPayout(f, 9);
    await assertPaidOnce(f);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      unitSupply: 90,
    });
  });
  it.each(["character", "imperial_character"])(
    "recovers the frozen native amount for %s after FX changes",
    async (kind) => {
      const f = fixture(),
        collection = kind === "character" ? "characters" : "imperialCharacters",
        id = new ObjectId();
      await f.db
        .collection("indexFunds")
        .updateOne({ _id: f.fundId }, { $set: { anchorCurrencyCode: "GBP" } });
      f.fund.anchorCurrencyCode = "GBP";
      await f.db.collection("indexFundRedemptionQueue").updateOne(
        { _id: f.entryId },
        {
          $set: {
            holderKind: kind,
            [kind === "character" ? "characterId" : "imperialCharacterId"]: id,
            redeemFxRate: 2,
          },
          $unset: { nppId: "" },
        }
      );
      f.memory.seed(collection, [
        {
          _id: id,
          name: "Synthetic Holder",
          countryId: "UK",
          currencyBalances: { personal: { GBP: 50 } },
        },
      ]);
      f.memory.seed("exchangeRates", [{ _id: new ObjectId(), currencyCode: "GBP", rate: 2 }]);
      const target = f.memory.collection(collection),
        update = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof update>) => {
        const result = await update(...args);
        if (
          !interrupted &&
          (args[1] as { $inc?: Record<string, number> }).$inc?.["currencyBalances.personal.GBP"]
        ) {
          interrupted = true;
          throw new Error("Synthetic native holder acknowledgement lost");
        }
        return result;
      };
      await processQueuedRedemptions(f.db, f.fund, true, 7).catch(() => undefined);
      expect(interrupted).toBe(true);
      await f.db
        .collection("exchangeRates")
        .updateOne({ currencyCode: "GBP" }, { $set: { rate: 3 } });
      await f.db
        .collection("indexFunds")
        .updateOne({ _id: f.fundId }, { $set: { quotedNav: 120 } });
      await processQueuedRedemptions(f.db, { ...f.fund, cashAnchor: 0, quotedNav: 120 }, true, 8);
      await processQueuedRedemptions(f.db, { ...f.fund, cashAnchor: 0, quotedNav: 120 }, true, 9);
      expect(await f.db.collection(collection).findOne({ _id: id })).toMatchObject({
        currencyBalances: { personal: { GBP: 2050 } },
      });
      expect(f.memory.collection("financialTxLog").docs).toHaveLength(1);
      expect(f.memory.collection("financialTxLog").docs[0]).toMatchObject({
        amount: 2000,
        anchorAmount: 1000,
        currencyCode: "GBP",
      });
      expect(f.memory.collection("indexFundTransactions").docs[0]).toMatchObject({
        amountAnchor: 1000,
        navAnchor: 100,
      });
    }
  );
});

it("fences a suspended plan writer after its unquoted claim is released", async () => {
  const f = fixture(),
    queue = f.memory.collection("indexFundRedemptionQueue"),
    write = queue.findOneAndUpdate.bind(queue);
  let wake!: () => void,
    reached!: () => void,
    paused = false;
  const waiting = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  queue.findOneAndUpdate = async (...args: Parameters<typeof write>) => {
    if (!paused && (args[1] as { $set?: { payoutPlan?: unknown } }).$set?.payoutPlan) {
      paused = true;
      reached();
      await waiting;
    }
    return write(...args);
  };
  const old = processQueuedRedemptions(f.db, f.fund, false, 7);
  await ready;
  try {
    expect(await retryPayout(f)).toBe(1);
  } finally {
    wake();
  }
  expect(await old).toBe(0);
  await retryPayout(f, 9);
  await assertPaidOnce(f);
});
it("resumes a refund whose cash acknowledgement was lost without a second reversal", async () => {
  const f = fixture();
  await f.db
    .collection("indexFundRedemptionQueue")
    .updateOne({ _id: f.entryId }, { $unset: { unitsBurnedAtRequest: "" } });
  const holder = f.memory.collection("npps"),
    holderWrite = holder.updateOne.bind(holder);
  let refused = false;
  holder.updateOne = async (...args: Parameters<typeof holderWrite>) => {
    if (
      !refused &&
      (args[1] as { $inc?: { nppInvestmentCashAnchor?: number } }).$inc?.nppInvestmentCashAnchor
    ) {
      refused = true;
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    return holderWrite(...args);
  };
  const fund = f.memory.collection("indexFunds"),
    fundWrite = fund.updateOne.bind(fund);
  let interrupted = false;
  fund.updateOne = async (...args: Parameters<typeof fundWrite>) => {
    const result = await fundWrite(...args);
    if (
      !interrupted &&
      Number((args[1] as { $inc?: { cashAnchor?: number } }).$inc?.cashAnchor) > 0
    ) {
      interrupted = true;
      throw new Error("Synthetic refund acknowledgement lost");
    }
    return result;
  };
  await processQueuedRedemptions(f.db, f.fund, false, 7).catch(() => undefined);
  expect(interrupted).toBe(true);
  await retryPayout(f);
  await retryPayout(f, 9);
  await assertPaidOnce(f);
  expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
    unitSupply: 90,
  });
  expect(
    f.memory.collection(MONEY_MOVE_COLLECTION).docs.filter((row) => row.status === "partial")
  ).toHaveLength(0);
});

const nativeCases = [
  "debit",
  "credit",
  "fund-receipt",
  "cash-witness",
  "ledger",
  "audit",
  "finalize",
  "claim",
  "plan",
  "concurrent",
  "legacy",
] as const;
describe.skipIf(process.env.AHD_FUND_PAYOUT_REAL_MONGO !== "1")(
  "native queued payout recovery",
  () => {
    it.each(nativeCases)("qualifies %s against an isolated native database", async (boundary) => {
      const uri = process.env.SIM_MONGODB_URI;
      if (!uri) throw new Error("Native fixture requires an explicit sandbox URI");
      const endpoint = new URL(uri);
      if (
        endpoint.protocol !== "mongodb:" ||
        !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
        !["27018", "27020"].includes(endpoint.port) ||
        endpoint.username ||
        endpoint.password ||
        !["", "/"].includes(endpoint.pathname)
      )
        throw new Error("Native fixture requires the dedicated loopback sandbox server");
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(`ahd_sim_i2223_payout_${randomUUID().replaceAll("-", "")}`);
      try {
        expect(await db.listCollections().toArray()).toHaveLength(0);
        const f = fixture();
        for (const collection of [
          "indexFunds",
          "npps",
          "indexFundRedemptionQueue",
          "gameConfig",
          "gameState",
        ]) {
          await db.collection(collection).insertMany(f.memory.collection(collection).docs);
        }
        if (boundary === "legacy")
          await db
            .collection("indexFundRedemptionQueue")
            .updateOne({ _id: f.entryId }, { $unset: { unitsBurnedAtRequest: "" } });
        const targetName = (
          {
            debit: "indexFunds",
            credit: "npps",
            "fund-receipt": "indexFundTransactions",
            "cash-witness": "financialTxLog",
            ledger: "ledgerEntries",
            audit: "actionAuditLog",
            finalize: "indexFundRedemptionQueue",
            claim: "indexFundRedemptionQueue",
            plan: "indexFundRedemptionQueue",
          } as Record<string, string>
        )[boundary];
        let interrupted = false;
        // Proxy the real driver only at the selected lost-acknowledgement boundary.
        const wrapped = new Proxy(db, {
          get(target, property) {
            if (property !== "collection") {
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: string) => {
              const collection = target.collection(name);
              if (name !== targetName) return collection;
              return new Proxy(collection, {
                get(coll, method) {
                  const value = Reflect.get(coll, method);
                  if (typeof value !== "function") return value;
                  const selected = ["fund-receipt", "cash-witness", "ledger", "audit"].includes(
                    boundary
                  )
                    ? "insertOne"
                    : ["claim", "plan"].includes(boundary)
                      ? "findOneAndUpdate"
                      : "updateOne";
                  if (method !== selected) return value.bind(coll);
                  return async (...args: any[]) => {
                    const result = await value.apply(coll, args);
                    const update = args[1] as {
                      $inc?: Record<string, number>;
                      $set?: Record<string, unknown>;
                    };
                    const matches =
                      boundary === "debit"
                        ? !!update.$inc?.cashAnchor
                        : boundary === "credit"
                          ? !!update.$inc?.nppInvestmentCashAnchor
                          : boundary === "finalize"
                            ? update.$set?.status === "paid"
                            : boundary === "claim"
                              ? update.$set?.status === "processing"
                              : boundary === "plan"
                                ? !!update.$set?.payoutPlan
                                : true;
                    if (!interrupted && matches) {
                      interrupted = true;
                      throw new Error("Synthetic native acknowledgement lost");
                    }
                    return result;
                  };
                },
              });
            };
          },
        });
        if (boundary === "concurrent")
          await Promise.all([
            processQueuedRedemptions(wrapped, f.fund, false, 7),
            processQueuedRedemptions(wrapped, f.fund, false, 7),
          ]);
        else await processQueuedRedemptions(wrapped, f.fund, false, 7).catch(() => undefined);
        if (targetName) expect(interrupted).toBe(true);
        for (let retry = 0; retry < 3; retry++) {
          const current = await db.collection<IndexFund>("indexFunds").findOne({ _id: f.fundId });
          await processQueuedRedemptions(wrapped, current!, false, 8 + retry);
        }
        expect(await db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
          cashAnchor: 0,
          unitSupply: boundary === "legacy" ? 90 : 100,
        });
        expect(await db.collection("npps").findOne({ _id: f.nppId })).toMatchObject({
          nppInvestmentCashAnchor: 1050,
        });
        expect(
          await db.collection("indexFundRedemptionQueue").findOne({ _id: f.entryId })
        ).toMatchObject({ status: "paid", units: 0, paidAmountAnchor: 1000 });
        for (const collection of ["indexFundTransactions", "financialTxLog", "actionAuditLog"])
          expect(await db.collection(collection).countDocuments()).toBe(1);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(2);
        const moves = await db.collection(MONEY_MOVE_COLLECTION).find({}).toArray();
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ status: "applied" });
        expect(moves[0].legs.every((leg: { applied: boolean }) => leg.applied)).toBe(true);
        expect(moves[0].projections.every((row: { applied: boolean }) => row.applied)).toBe(true);
        const hello = await client.db("admin").command({ hello: 1 });
        process.stdout.write(
          "Native queued payout qualified " +
            JSON.stringify({
              boundary,
              replicaSet: !!hello.setName,
              cashTotal: 1050,
              payout: 1000,
              fundReceipts: 1,
              nativeCashWitnesses: 1,
              ledgerRows: 2,
              auditRows: 1,
              repeatStable: true,
            }) +
            "\n"
        );
      } finally {
        await client.close();
      }
    });
  }
);
