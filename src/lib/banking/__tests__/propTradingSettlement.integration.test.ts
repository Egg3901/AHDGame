/** Concurrent prop commands conserve the bank's cash and held positions. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { openPosition, closePosition, forceLiquidateToLeverageCap, markBook } from "../propTrading";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

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
    expect(results.filter((r) => r.ok)).toHaveLength(1);
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
