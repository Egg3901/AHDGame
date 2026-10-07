import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSoeRemittance } from "./soeRemittance";
import { remitToTreasury } from "./treasury";
import { loadTreasuryCashContext } from "./treasuryLedger";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { estimateNationalizedOperatingIncome } from "@/lib/budget/publicEnterpriseRevenue";

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

const FX_SHIFT = 3.277539218868548;

/** Move every live input the remittance quote reads: cash, income and FX. */
function shiftLiveInputs(db: ReturnType<typeof createInMemoryDb>) {
  for (const doc of db.collection("corporations").docs) {
    doc.liquidCapital = (doc.liquidCapital as number) + 777;
  }
  db.collection("exchangeRates").docs[0]!.rate = FX_SHIFT;
  vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1500);
}

function cash(db: ReturnType<typeof createInMemoryDb>, id: ObjectId): number {
  return db.collection("corporations").docs.find((doc) => String(doc._id) === id.toHexString())!
    .liquidCapital as number;
}

describe("funded SOE remittance against actual corporate cash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);
  });

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

  it("keeps a fully applied receipt authoritative when the replay reprices the transfer", async () => {
    const db = world(5000);
    await remitOnce(db);
    const settled = structuredClone(db.collection("bankMoneyMoves").docs);
    const treasury = structuredClone(db.collection("federalBudget").docs[0]);
    expect(cash(db, shortCorpId)).toBe(4000);

    // A crash resume replays the same turn after cash, income and FX moved.
    // The changed rate alone used to collide with the frozen valued quote.
    shiftLiveInputs(db);

    const { perCorp, remitted } = await remitOnce(db);

    expect(remitted).toBe(0);
    expect(perCorp).toEqual([]);
    expect(cash(db, shortCorpId)).toBe(4777);
    expect(cash(db, flushCorpId)).toBe(4777);
    expect(db.collection("federalBudget").docs[0]).toEqual(treasury);
    expect(db.collection("bankMoneyMoves").docs).toEqual(settled);
  });

  it("finishes a receipt whose debit landed with the frozen credit, not a new quote", async () => {
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
    shiftLiveInputs(db);

    const { perCorp } = await remitOnce(db);

    // The debit already left the enterprise on the first attempt, so the
    // caller folds nothing for it; only the fresh flush corp is new cash.
    expect(perCorp.map((row) => [row.corpId.toHexString(), row.amountLocal])).toEqual([
      [flushCorpId.toHexString(), 1500],
    ]);
    expect(cash(db, shortCorpId)).toBe(4777);
    const receipt = db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)!;
    expect(receipt.status).toBe("applied");
    const partialLegs = partial?.legs;
    if (!Array.isArray(partialLegs)) throw new Error("Expected frozen partial settlement legs");
    expect(receipt.legs).toEqual(
      partialLegs.map((leg: Record<string, unknown>) => ({ ...leg, applied: true }))
    );
    const frozenCredit = partialLegs[1].amount as number;
    const flushCredit = (
      db.collection("bankMoneyMoves").docs.find((doc) => doc._id === flushKey)!.legs as {
        amount: number;
      }[]
    )[1].amount;
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: frozenCredit + flushCredit,
      treasuryBalance: frozenCredit + flushCredit,
    });
  });

  it("finishes a receipt that stopped before its debit at the frozen amount", async () => {
    const db = world(5000);
    const crashing = withInjectedCrash(db, {
      collection: "corporations",
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
    expect(cash(db, shortCorpId)).toBe(5000);
    shiftLiveInputs(db);

    const { perCorp } = await remitOnce(db);

    // The frozen 1000 is what moved in this call, so that is what the caller folds.
    expect(perCorp.map((row) => [row.corpId.toHexString(), row.amountLocal])).toEqual([
      [shortCorpId.toHexString(), 1000],
      [flushCorpId.toHexString(), 1500],
    ]);
    expect(cash(db, shortCorpId)).toBe(5777 - 1000);
    expect(db.collection("bankMoneyMoves").docs.find((doc) => doc._id === shortKey)).toMatchObject({
      status: "applied",
      legs: [{ amount: 1000 }, { amount: 1000 }],
    });
  });

  it("refuses a receipt under this key that does not belong to this remittance", async () => {
    const db = world(5000);
    await remitOnce(db);
    const receipts = db.collection("bankMoneyMoves").docs;
    const owned = receipts.find((doc) => doc._id === shortKey)!;
    // The flush corp's legs filed under the short corp's key.
    owned.legs = structuredClone(receipts.find((doc) => doc._id === flushKey)!.legs);
    const before = structuredClone(receipts);
    shiftLiveInputs(db);

    await expect(remitOnce(db)).rejects.toThrow(/does not debit this enterprise's cash/);

    expect(cash(db, shortCorpId)).toBe(4777);
    expect(db.collection("bankMoneyMoves").docs).toEqual(before);
  });

  it("keeps the generic valued-quote guard strict for a repriced direct settlement", async () => {
    const db = world(5000);
    await remitOnce(db);
    const before = structuredClone(db.collection("bankMoneyMoves").docs);

    const { settleTransition } = await import("@/lib/banking/settlementJournal");
    const original = before.find((doc) => doc._id === shortKey)!;
    const result = await settleTransition(db as unknown as Db, {
      key: shortKey,
      kind: "soe_profit_remittance",
      turn: TURN,
      currency: "CNY",
      legs: (original.legs as Record<string, unknown>[]).map((leg) => ({
        kind: leg.kind as "debit" | "credit",
        amount: (leg.amount as number) + 1,
        valuation: leg.valuation as { currencyCode: string; localPerAnchor: number },
        collection: leg.collection as string,
        filter: leg.filter as Record<string, unknown>,
        path: leg.path as string,
        note: leg.note as string,
      })),
      projections: [],
      event: { kind: "monetary.executed", command: "turn.soe.remittance" },
    });

    expect(result).toMatchObject({ status: "rejected" });
    expect(result.error).toMatch(/already owns a different valued settlement quote/);
    expect(db.collection("bankMoneyMoves").docs).toEqual(before);
  });
});
