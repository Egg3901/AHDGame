import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSoeRemittance } from "./soeRemittance";
import { remitToTreasury } from "./treasury";
import { loadTreasuryCashContext } from "./treasuryLedger";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";

// Only the revenue ESTIMATE is stubbed. The cash cap, the funded settlement,
// its journal and the debit guard all run for real against the in-memory db.
vi.mock("@/lib/budget/publicEnterpriseRevenue", () => ({
  estimateNationalizedOperatingIncome: vi.fn(() => 1000),
  loadPlantsBudgetContext: vi
    .fn()
    .mockResolvedValue({ plantsEnabled: false, currentTurn: null, rampTurns: 12 }),
}));

const now = new Date("2026-10-07T00:00:00Z");
const TURN = 8;
const shortCorpId = new ObjectId("700000000000000000000001");
const flushCorpId = new ObjectId("700000000000000000000002");
const shortKey = `treasury-soe-remittance:${TURN}:${shortCorpId.toHexString()}`;
const flushKey = `treasury-soe-remittance:${TURN}:${flushCorpId.toHexString()}`;

function soe(_id: ObjectId, liquidCapital: number) {
  return {
    _id,
    countryId: "CN",
    countryOwnerId: "CN",
    ownershipState: "stateOwned",
    liquidCurrencyCode: "CNY",
    profitRetentionPercent: 0,
    liquidCapital,
  };
}

function world(shortCash: number) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, preset: "1991-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "CNY", rate: 1 }]);
  db.seed("federalBudget", [
    { _id: "CN", countryId: "CN", currencyCode: "CNY", treasuryBalance: 0, treasuryCashLocal: 0 },
  ]);
  db.seed("corporations", [soe(shortCorpId, shortCash), soe(flushCorpId, 5000)]);
  return db;
}

async function remitOnce(db: ReturnType<typeof createInMemoryDb>) {
  const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, TURN) };
  return processSoeRemittance(db as unknown as Db, now, ledger);
}

function cash(db: ReturnType<typeof createInMemoryDb>, id: ObjectId): number {
  return db.collection("corporations").docs.find((doc) => String(doc._id) === id.toHexString())!
    .liquidCapital as number;
}

describe("funded SOE remittance against actual corporate cash", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caps a cash-limited remittance at whole units the SOE actually holds", async () => {
    // 100.6 on hand used to cap at Math.round(100.6) = 101, which the debit
    // guard ($gte 101) refused, aborting the whole corporation turn.
    const db = world(100.6);

    const { perCorp } = await remitOnce(db);

    expect(perCorp.map((row) => [row.corpId.toHexString(), row.amountLocal])).toEqual([
      [shortCorpId.toHexString(), 100],
      [flushCorpId.toHexString(), 1000],
    ]);
    expect(cash(db, shortCorpId)).toBeCloseTo(0.6);
    expect(cash(db, flushCorpId)).toBe(4000);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 1100,
      treasuryBalance: 1100,
    });
    const receipts = db.collection("bankMoneyMoves").docs;
    expect(receipts.map((doc) => [doc._id, doc.status])).toEqual([
      [shortKey, "applied"],
      [flushKey, "applied"],
    ]);
  });

  it("skips a refused remittance receipt left by an earlier attempt without aborting the sweep", async () => {
    const db = world(100.6);
    // The earlier attempt's quote, refused by the debit guard before any cash moved.
    await expect(
      remitToTreasury(
        db as unknown as Db,
        { countryId: "CN", corpId: shortCorpId, amountLocal: 101, corpCurrency: "CNY" },
        now,
        { context: await loadTreasuryCashContext(db as unknown as Db, TURN) }
      )
    ).resolves.toBe(0);
    const refused = db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)!;
    expect(refused.status).toBe("rejected");

    const { perCorp } = await remitOnce(db);

    // The refused receipt stays authoritative: no second debit under its key.
    expect(perCorp.map((row) => row.corpId.toHexString())).toEqual([flushCorpId.toHexString()]);
    expect(cash(db, shortCorpId)).toBe(100.6);
    expect(cash(db, flushCorpId)).toBe(4000);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 1000,
      treasuryBalance: 1000,
    });
    expect(db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)).toEqual(
      refused
    );
  });

  it("still stops on a partial receipt whose debit landed but credit did not", async () => {
    const db = world(5000);
    const crashing = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
    });
    await expect(
      remitToTreasury(
        crashing.db,
        { countryId: "CN", corpId: shortCorpId, amountLocal: 1000, corpCurrency: "CNY" },
        now,
        { context: await loadTreasuryCashContext(db as unknown as Db, TURN) }
      )
    ).rejects.toBeInstanceOf(InjectedCrash);
    const partial = structuredClone(
      db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)
    );
    expect(partial).toMatchObject({ status: "partial" });
    expect(cash(db, shortCorpId)).toBe(4000);

    // Undelivered money is not an ordinary refusal: the sweep stops for recovery.
    await expect(remitOnce(db)).rejects.toThrow(/has not landed every leg/);

    expect(cash(db, shortCorpId)).toBe(4000);
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);
    expect(db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)).toEqual(
      partial
    );
  });
});
