/** Concurrent prop commands conserve the bank's cash and held positions. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { openPosition, closePosition, forceLiquidateToLeverageCap, markBook } from "../propTrading";
import { resumeSettlement } from "../settlementJournal";
import { MONEY_MOVE_COLLECTION } from "../moneyMove";
import { randomUUID } from "node:crypto";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const BANK = new ObjectId();
const ASSET = new ObjectId();
function world(units: number): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: 100 }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("corporations", [
    {
      _id: ASSET,
      name: "Synthetic Asset",
      countryId: "US",
      liquidCurrencyCode: "USD",
      sharePrice: 10,
    },
    {
      _id: BANK,
      name: "Synthetic Bank",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 0,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1000,
        cashReserves: 1000,
        depositOffset: 0,
        lendingOffset: 0,
        propBook: units
          ? [
              {
                asset: "equity",
                ref: ASSET.toString(),
                units,
                costBasis: units * 10,
                markValue: units * 10,
              },
            ]
          : [],
        propBookMarkValue: units * 10,
        interbankDebt: 0,
        cbMarginDebt: 0,
      },
    },
  ]);
  return db;
}
function wealth(db: InMemoryDb): number {
  const bank = db.collection("corporations").docs.find((row) => String(row._id) === String(BANK))!;
  const charter = bank.bankCharter as { cashReserves: number; propBook: { units: number }[] };
  return charter.cashReserves + charter.propBook.reduce((total, p) => total + p.units * 10, 0);
}
async function prepare(units: number) {
  const db = world(units);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  return db;
}
const ticket = { asset: "equity" as const, ref: ASSET.toString(), units: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  resetCorpFxRateCacheForTests();
});
describe("prop command settlement", () => {
  it("conserves cash and stock when two closes read the same position", async () => {
    const db = await prepare(10),
      before = wealth(db);
    const results = await Promise.all([
      closePosition(db as unknown as Db, BANK, ticket),
      closePosition(db as unknown as Db, BANK, ticket),
    ]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(db.collection("financialTxLog").docs).toHaveLength(1);
    expect(wealth(db)).toBe(before);
  });
  it("keeps the cash debit and purchased units consistent under competing opens", async () => {
    const db = await prepare(0),
      before = wealth(db);
    await Promise.all([
      openPosition(db as unknown as Db, BANK, ticket),
      openPosition(db as unknown as Db, BANK, ticket),
    ]);
    expect(wealth(db)).toBe(before);
  });
  it("conserves cash and stock across an open racing a close", async () => {
    const db = await prepare(10),
      before = wealth(db);
    await Promise.all([
      openPosition(db as unknown as Db, BANK, ticket),
      closePosition(db as unknown as Db, BANK, ticket),
    ]);
    expect(wealth(db)).toBe(before);
  });
  it("does not replace newer reserves during forced liquidation", async () => {
    const db = await prepare(100);
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.interbankDebt": 1900 } });
    const before = await db.collection("corporations").findOne({ _id: BANK });
    const charter = before!.bankCharter as BankCharter;
    const marked = await markBook(db as unknown as Db, charter);
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $inc: { "bankCharter.cashReserves": 100 } });
    const expected = wealth(db);
    const result = await forceLiquidateToLeverageCap(
      db as unknown as Db,
      BANK,
      1000,
      charter,
      marked
    );
    expect(result.stale).toBe(true);
    expect(result.forced).toBe(false);
    expect(wealth(db)).toBe(expected);
  });
});

it.skipIf(process.env.AHD_PROP_SETTLEMENT_REAL_MONGO !== "1")(
  "persists one native Mongo settlement and recovers its original transaction receipt",
  async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    const db = client.db(`ahd_sim_prop_settlement_${randomUUID().replaceAll("-", "")}`);
    try {
      await client.connect();
      const memory = world(10);
      for (const name of ["corporations", "gameConfig", "gameState", "exchangeRates"])
        await db.collection(name).insertMany(memory.collection(name).docs);
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db);
      let interrupted = false;
      const fault = new Proxy(db, {
        get(target, property) {
          if (property === "collection")
            return (name: string) => {
              const collection = target.collection(name);
              if (name !== "financialTxLog") return collection;
              return new Proxy(collection, {
                get(c, key) {
                  if (key === "updateOne")
                    return async (...args: Parameters<typeof c.updateOne>) => {
                      const result = await c.updateOne(...args);
                      if (!interrupted) {
                        interrupted = true;
                        throw new Error("receipt acknowledgement interrupted");
                      }
                      return result;
                    };
                  const value = Reflect.get(c, key);
                  return typeof value === "function" ? value.bind(c) : value;
                },
              });
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(closePosition(fault, BANK, ticket)).rejects.toThrow(
        "receipt acknowledgement interrupted"
      );
      const journal = await db.collection<{ _id: string }>(MONEY_MOVE_COLLECTION).findOne({});
      expect(journal).not.toBeNull();
      await resumeSettlement(db, journal!._id);
      await resumeSettlement(db, journal!._id);
      const bank = await db.collection("corporations").findOne({ _id: BANK });
      expect(bank?.bankCharter.cashReserves).toBe(1100);
      expect(bank?.bankCharter.propBook).toEqual([]);
      expect(await db.collection("financialTxLog").countDocuments()).toBe(1);
      const receipt = await db.collection("financialTxLog").findOne({});
      expect(receipt).toMatchObject({ amount: 100, meta: { bankVaultMovement: true } });
      expect((await closePosition(db, BANK, ticket)).ok).toBe(false);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  }
);
