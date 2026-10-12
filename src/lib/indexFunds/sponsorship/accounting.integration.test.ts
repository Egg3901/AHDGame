import { beforeEach, describe, expect, it, vi } from "vitest";
import { BSON, ObjectId, type ClientSession, type Db } from "mongodb";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { charterFund } from "./charterFund";
import { chargeSponsorExpenseFees } from "./expenseFees";
import { completeWindUp } from "./windUp";
import { emitTx } from "@/lib/financialTxLog/emit";
import { expenseFeeForTurn } from "./constants";

vi.mock("@/lib/mongodb", () => ({ getMongoClient: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(async (db: Db, entry: Record<string, unknown>) => {
    await db.collection("financialTxLog").insertOne({ _id: new ObjectId(), ...entry });
    return "applied";
  }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/currency/corporationCapital", async (original) => ({
  ...(await original<typeof import("@/lib/currency/corporationCapital")>()),
  getCorpFxRate: vi.fn(async () => 1.7),
  loadFxRatesRecord: vi.fn(async () => ({ USD: 1.7, GBP: 2.3 })),
}));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn(),
}));

/** Driver double with snapshot rollback and an optional lost commit response. */
function fixture() {
  const memory = createInMemoryDb();
  const session = { endSession: vi.fn(async () => {}) } as unknown as ClientSession;
  let loseCommitResponse = false;
  const withTransaction = vi.fn(async (work: (session: ClientSession) => Promise<unknown>) => {
    const saved = new Map(
      [...memory.collections].map(([name, collection]) => [
        name,
        BSON.EJSON.parse(BSON.EJSON.stringify(collection.docs)),
      ])
    );
    let result: unknown;
    try {
      result = await work(session);
    } catch (error) {
      for (const name of [...memory.collections.keys()]) {
        memory.collection(name).docs = saved.get(name) ?? [];
      }
      throw error;
    }
    if (loseCommitResponse) {
      loseCommitResponse = false;
      throw new Error("UnknownTransactionCommitResult");
    }
    return result;
  });
  session.withTransaction = withTransaction as ClientSession["withTransaction"];
  const db = Object.assign(memory, { client: { startSession: () => session } }) as unknown as Db;
  const sponsor = {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Sponsor",
    countryId: "US",
    liquidCurrencyCode: "USD",
    liquidCapital: 50_000_000 * 1.7,
  } as Corporation;
  memory.seed("corporations", [sponsor as unknown as Record<string, unknown>]);
  memory.seed("exchangeRates", [{ _id: new ObjectId(), currencyCode: "USD", rate: 1.7 }]);
  memory.seed("gameConfig", [
    { _id: "default", playerFundSponsorshipEnabled: true, indexFundsMode: "full" },
  ]);
  memory.seed("corporateSectors", [
    { _id: new ObjectId(), corporationId: sponsor._id, sectorType: "financial" },
  ]);
  memory.seed("federalBudget", [
    { _id: new ObjectId(), countryId: "US", currencyCode: "USD", treasuryBalance: 0 },
  ]);
  const input = {
    sponsor,
    name: "Domestic Equity Trust",
    tickerSymbol: "DET",
    scope: "country" as const,
    countryId: "US" as const,
    kind: "broad" as const,
    expenseRatioAnnual: 0.01,
    seedCapitalAnchor: 10_000_000.123,
    currentTurn: 10,
  };
  const book = () => memory.collection("indexFunds").docs[0] as unknown as IndexFund;
  const totalCash = () =>
    Number(memory.collection("corporations").docs[0].liquidCapital) / 1.7 +
    Number(memory.collection("federalBudget").docs[0].treasuryBalance) / 1.7 +
    memory.collection("indexFunds").docs.reduce((sum, fund) => sum + Number(fund.cashAnchor), 0);
  return {
    memory,
    db,
    sponsor,
    input,
    book,
    totalCash,
    session,
    loseCommit: () => {
      loseCommitResponse = true;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("fund sponsor seed settlement", () => {
  it("buys ordinary sponsor units with posted cash, conserving cash and first-subscriber value", async () => {
    const f = fixture();
    const before = f.totalCash();
    expect((await charterFund(f.db, f.input)).ok).toBe(true);
    const fund = f.book();
    const position = f.memory.collection("indexFundPositions").docs[0];
    expect(fund.seedAccounting).toBe("paid_units");
    expect(fund.unitSupply * fund.quotedNav).toBeCloseTo(fund.cashAnchor, 8);
    expect(position.units).toBe(fund.unitSupply);
    expect(position.legacyUnits).toBe(0);
    expect(String(position.corporationId)).toBe(String(f.sponsor._id));
    expect(f.totalCash()).toBeCloseTo(before, 8);
    const subscription = 100_000;
    const subscribedUnits = subscription / fund.quotedNav;
    const nextNav = (fund.cashAnchor + subscription) / (fund.unitSupply + subscribedUnits);
    expect(subscribedUnits * nextNav).toBeCloseTo(subscription, 8);
    expect(fund.unitSupply * nextNav).toBeCloseTo(fund.cashAnchor, 8);
    const netWitness = f.memory
      .collection("financialTxLog")
      .docs.reduce((sum, tx) => sum + Number(tx.anchorAmount), 0);
    expect(netWitness).toBeCloseTo(0, 8);
  });

  it("reconciles a lost commit response without paying or minting again", async () => {
    const f = fixture();
    const before = f.totalCash();
    f.loseCommit();
    await expect(charterFund(f.db, f.input)).rejects.toThrow("UnknownTransactionCommitResult");
    const original = f.book();
    const result = await charterFund(f.db, f.input);
    expect(result.ok).toBe(true);
    expect(f.memory.collection("indexFunds").docs).toHaveLength(1);
    expect(f.memory.collection("indexFundPositions").docs).toHaveLength(1);
    expect(f.book().unitSupply).toBe(original.unitSupply);
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(f.memory.collection("financialTxLog").docs).toHaveLength(3);
    expect((await charterFund(f.db, { ...f.input, expenseRatioAnnual: 0.02 })).ok).toBe(false);
  });

  it("rolls back every cash leg if sponsor custody cannot be created", async () => {
    const f = fixture();
    const before = f.totalCash();
    vi.spyOn(f.memory.collection("indexFundPositions"), "insertOne").mockRejectedValueOnce(
      new Error("custody failed")
    );
    await expect(charterFund(f.db, f.input)).rejects.toThrow("custody failed");
    expect(f.memory.collection("indexFunds").docs).toHaveLength(0);
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect((await charterFund(f.db, f.input)).ok).toBe(true);
    expect(f.totalCash()).toBeCloseTo(before, 8);
  });

  it("refuses unsupported transaction deployments before writing cash", async () => {
    const f = fixture();
    const before = f.totalCash();
    f.session.withTransaction = vi.fn(async () => {
      throw new Error("Transactions unsupported");
    });
    await expect(charterFund(f.db, f.input)).rejects.toThrow("Transactions unsupported");
    expect(f.totalCash()).toBe(before);
    expect(f.memory.collection("indexFunds").docs).toHaveLength(0);
  });
});

function feeFixture() {
  const f = fixture();
  const fund: IndexFund = {
    _id: new ObjectId(),
    slug: "sponsored-test",
    name: "Test fund",
    tickerSymbol: "TEST",
    scope: "country",
    countryId: "US",
    kind: "broad",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 25_000,
    unitSupply: 1_000,
    reserveUnits: 0,
    quotedNav: 999,
    backingRatio: 1,
    holdings: [{ corporationId: new ObjectId(), shares: 750, lastValueAnchor: 75_000 }],
    targetConstituents: [],
    sponsorCorporationId: f.sponsor._id,
    expenseRatioAnnual: 0.01,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  f.memory.seed("indexFunds", [fund as unknown as Record<string, unknown>]);
  f.memory.seed("bonds", [
    {
      _id: new ObjectId(),
      matured: false,
      currencyCode: "USD",
      marketPrice: 1,
      holders: [{ fundId: fund._id, units: 68 }],
    },
  ]); // 40,000 anchor at USD 1.7
  f.memory.seed("shareOrders", [
    {
      _id: new ObjectId(),
      placerFundId: fund._id,
      type: "buy",
      status: "open",
      escrowAnchor: 10_000,
    },
  ]);
  f.memory.seed("indexFundRedemptionQueue", [
    {
      _id: new ObjectId(),
      fundId: fund._id,
      status: "queued",
      unitsBurnedAtRequest: true,
      units: 500,
      redeemFxRate: 2.5,
    },
  ]);
  return { ...f, fund };
}

describe("fund expense fee settlement", () => {
  it("includes all marked assets once and preserves queued rights with exact FX cash legs", async () => {
    const f = feeFixture();
    const before = f.totalCash();
    const fee = expenseFeeForTurn(150_000, 0.01);
    const result = await chargeSponsorExpenseFees(f.db, [f.fund], 11);
    expect(result.fundsCharged).toBe(1);
    expect(result.totalFeeAnchor).toBeCloseTo(fee, 8);
    expect(f.book().cashAnchor).toBeCloseTo(25_000 - fee, 8);
    expect(f.book().quotedNav).toBeCloseTo((150_000 - fee) / 1_500, 8);
    expect(f.book().lastExpenseFeeTurn).toBe(11);
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(f.memory.collection("indexFundRedemptionQueue").docs[0].redeemFxRate).toBe(2.5);
    expect(f.memory.collection("indexFundTransactions").docs).toHaveLength(1);
    expect(f.memory.collection("financialTxLog").docs[0].anchorAmount).toBeCloseTo(fee, 8);
  });

  it("charges once despite a lost commit acknowledgement and repeated or older turns", async () => {
    const f = feeFixture();
    const before = f.totalCash();
    f.loseCommit();
    await expect(chargeSponsorExpenseFees(f.db, [f.fund], 11)).rejects.toThrow(
      "UnknownTransactionCommitResult"
    );
    const cash = f.book().cashAnchor;
    expect((await chargeSponsorExpenseFees(f.db, [f.fund], 11)).fundsCharged).toBe(0);
    expect((await chargeSponsorExpenseFees(f.db, [f.fund], 10)).fundsCharged).toBe(0);
    expect(f.book().cashAnchor).toBe(cash);
    expect(f.memory.collection("indexFundTransactions").docs).toHaveLength(1);
    expect(f.totalCash()).toBeCloseTo(before, 8);
  });

  it.each(["credit", "receipt", "witness"])(
    "rolls back a failed %s then retries without leakage",
    async (failure) => {
      const f = feeFixture();
      const before = f.totalCash();
      if (failure === "credit")
        vi.spyOn(f.memory.collection("corporations"), "bulkWrite").mockRejectedValueOnce(
          new Error("failed credit")
        );
      if (failure === "receipt")
        vi.spyOn(f.memory.collection("indexFundTransactions"), "insertMany").mockRejectedValueOnce(
          new Error("failed receipt")
        );
      if (failure === "witness") vi.mocked(emitTx).mockResolvedValueOnce("failed");
      await expect(chargeSponsorExpenseFees(f.db, [f.fund], 11)).rejects.toThrow(/failed/i);
      expect(f.book().cashAnchor).toBe(25_000);
      expect(f.book().lastExpenseFeeTurn).toBeUndefined();
      expect(f.memory.collection("indexFundTransactions").docs).toHaveLength(0);
      expect(f.totalCash()).toBeCloseTo(before, 8);
      expect((await chargeSponsorExpenseFees(f.db, [f.fund], 11)).fundsCharged).toBe(1);
      expect(f.totalCash()).toBeCloseTo(before, 8);
    }
  );
});

describe("paid sponsor units at wind-up", () => {
  it("pays the sponsor's ordinary units without a second seed refund and safely replays", async () => {
    const f = fixture();
    const before = f.totalCash();
    await charterFund(f.db, f.input);
    await f.db
      .collection("indexFunds")
      .updateOne({ _id: f.book()._id }, { $set: { status: "winding_down" } });
    const fund = f.book();
    expect(await completeWindUp(f.db, fund, 12)).toBe(1);
    expect(f.book().cashAnchor).toBe(0);
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(await completeWindUp(f.db, fund, 12)).toBe(0);
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(f.memory.collection("indexFundPositions").docs[0].units).toBe(0);
  });

  it("conserves wind-up payouts for character, imperial, NPP and pension holders", async () => {
    const f = fixture();
    await charterFund(f.db, f.input);
    const fund = f.book();
    const character = new ObjectId();
    const imperial = new ObjectId();
    const npp = new ObjectId();
    const pension = new ObjectId();
    f.memory.seed("characters", [{ _id: character, currencyBalances: { personal: { USD: 0 } } }]);
    f.memory.seed("imperialCharacters", [
      { _id: imperial, currencyBalances: { personal: { USD: 0 } } },
    ]);
    f.memory.seed("npps", [{ _id: npp, nppInvestmentCashAnchor: 0 }]);
    f.memory.seed("pensionSchemes", [{ _id: pension, assetsAnchor: 0 }]);
    f.memory.seed("indexFundPositions", [
      {
        _id: new ObjectId(),
        fundId: fund._id,
        holderKind: "character",
        characterId: character,
        units: 1,
        legacyUnits: 0,
      },
      {
        _id: new ObjectId(),
        fundId: fund._id,
        holderKind: "imperial_character",
        imperialCharacterId: imperial,
        units: 1,
        legacyUnits: 0,
      },
      {
        _id: new ObjectId(),
        fundId: fund._id,
        holderKind: "npp",
        nppId: npp,
        units: 1,
        legacyUnits: 0,
      },
      {
        _id: new ObjectId(),
        fundId: fund._id,
        holderKind: "pension_scheme",
        pensionSchemeId: pension,
        units: 1,
        legacyUnits: 0,
      },
    ]);
    await f.db.collection("indexFunds").updateOne(
      { _id: fund._id },
      {
        $set: { status: "winding_down" },
        $inc: { unitSupply: 4, cashAnchor: 400 },
      }
    );
    const before = f.totalCash();
    expect(await completeWindUp(f.db, fund, 12)).toBe(5);
    const characterWallet = await f.db.collection("characters").findOne({ _id: character });
    const imperialWallet = await f.db.collection("imperialCharacters").findOne({ _id: imperial });
    const paidAnchor =
      Number(characterWallet?.currencyBalances.personal.USD) / 1.7 +
      Number(imperialWallet?.currencyBalances.personal.USD) / 1.7 +
      Number(f.memory.collection("npps").docs[0].nppInvestmentCashAnchor) +
      Number(f.memory.collection("pensionSchemes").docs[0].assetsAnchor);
    expect(paidAnchor).toBeCloseTo(400, 8);
    expect(f.totalCash() + paidAnchor).toBeCloseTo(before, 8);
    expect(await completeWindUp(f.db, fund, 12)).toBe(0);
  });

  it("rolls back payouts when the final fund write fails, then pays once on retry", async () => {
    const f = fixture();
    await charterFund(f.db, f.input);
    await f.db
      .collection("indexFunds")
      .updateOne({ _id: f.book()._id }, { $set: { status: "winding_down" } });
    const before = f.totalCash();
    vi.spyOn(f.memory.collection("indexFunds"), "updateOne").mockRejectedValueOnce(
      new Error("final write failed")
    );
    await expect(completeWindUp(f.db, f.book(), 12)).rejects.toThrow("final write failed");
    expect(f.book().status).toBe("winding_down");
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(await completeWindUp(f.db, f.book(), 12)).toBe(1);
    expect(f.totalCash()).toBeCloseTo(before, 8);
  });

  it("keeps paid claims intact when a holder currency quote is unavailable", async () => {
    const f = fixture();
    await charterFund(f.db, f.input);
    const character = new ObjectId();
    f.memory.seed("characters", [{ _id: character, currencyBalances: { personal: { USD: 0 } } }]);
    await f.db.collection("indexFundPositions").insertOne({
      _id: new ObjectId(),
      fundId: f.book()._id,
      holderKind: "character",
      characterId: character,
      units: 1,
    });
    await f.db.collection("indexFunds").updateOne(
      { _id: f.book()._id },
      {
        $set: { status: "winding_down", anchorCurrencyCode: "GBP" },
        $inc: { cashAnchor: 100, unitSupply: 1 },
      }
    );
    const before = f.totalCash();
    await expect(completeWindUp(f.db, f.book(), 12)).rejects.toThrow(
      "Fund payout exchange rate unavailable"
    );
    expect(f.book().status).toBe("winding_down");
    expect(f.totalCash()).toBeCloseTo(before, 8);
    expect(
      f.memory.collection("indexFundPositions").docs.every((position) => Number(position.units) > 0)
    ).toBe(true);
  });

  it("waits for actual bond custody, order escrow and pending withdrawals before clearing claims", async () => {
    const f = feeFixture();
    await f.db
      .collection("indexFunds")
      .updateOne({ _id: f.fund._id }, { $set: { status: "winding_down", holdings: [] } });
    await expect(completeWindUp(f.db, f.fund, 12)).rejects.toThrow("settlement must finish");
    expect(f.book().status).toBe("winding_down");
    expect(f.book().cashAnchor).toBe(25_000);
  });
});
