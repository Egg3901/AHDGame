import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { tradeCorporationFund } from "./corporationTrade";
import { loadCorporationFundPortfolio } from "./corporationPortfolio";
import { POST as subscribeRoute } from "@/app/api/investment-funds/[slug]/subscribe/route";
import { POST as redeemRoute } from "@/app/api/investment-funds/[slug]/redeem/route";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { processIndexFundDividend, processIndexFundDividendsBatch } from "./dividendPassThrough";
import { payCorporateWindUpHolders } from "./sponsorship/corporateHolderPayout";
import { payFundHolderCash } from "./sponsorship/holderPayout";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import { resumeFundCommandAudit } from "./playerCommandAudit";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/currency/autoConvert", () => ({
  autoConvertForPurchase: vi.fn(),
  convertForExplicitPay: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/transactionWithRetry", () => ({
  runTransactionWithSessionRetry: vi.fn(
    async (_get: unknown, run: (session?: undefined) => Promise<unknown>) => run(undefined)
  ),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: vi.fn(async () => {}),
  loadTxThresholds: vi.fn(async () => ({})),
}));
vi.mock("./playerCommandAudit", () => ({ resumeFundCommandAudit: vi.fn() }));
vi.mock("./featureFlag", () => ({
  isIndexFundsFullMode: vi.fn(async () => true),
  isIndexFundsEnabled: vi.fn(async () => true),
  INDEX_FUNDS_DISABLED_MESSAGE: "disabled",
  INDEX_FUNDS_PARTIAL_MESSAGE: "partial",
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/currency/corporationCapital", async (original) => ({
  ...(await original<typeof import("@/lib/currency/corporationCapital")>()),
  loadFxRatesRecord: vi.fn(async () => ({ USD: 1, JPY: 100, GBP: 2 })),
}));
vi.mock("@/lib/currency/euro/service", () => ({
  loadEuroMonetaryUnion: vi.fn(async () => undefined),
}));
vi.mock("@/lib/currency/euro/quotes", () => ({
  loadForexSpreadStrengths: vi.fn(async () => ({})),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 5) }));
vi.mock("@/lib/api/rejectDuringTurn", () => ({ rejectDuringTurn: vi.fn(async () => null) }));

const user = new ObjectId();
const character = new ObjectId();
const corporationId = new ObjectId();
const fundId = new ObjectId();
const fund = {
  _id: fundId,
  slug: "test-fund",
  name: "Test fund",
  tickerSymbol: "TEST",
  quotedNav: 100,
  status: "active",
  anchorCurrencyCode: "USD",
  unitSupply: 100,
  cashAnchor: 10000,
} as IndexFund;

function setup(capital = 1000, currency = "USD") {
  const memory = createInMemoryDb();
  memory.seed("corporations", [
    {
      _id: corporationId,
      userId: user,
      name: "Investor corporation",
      liquidCapital: capital,
      liquidCurrencyCode: currency,
    },
  ]);
  memory.seed("characters", [{ _id: character, cashOnHand: 500 }]);
  memory.seed("indexFunds", [{ ...fund }]);
  return { memory, db: memory as unknown as Db };
}
function order(units = 2) {
  return { corporationId: corporationId.toString(), units, operationId: crypto.randomUUID() };
}

describe("corporation fund accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isForexEnabled).mockResolvedValue(false);
  });
  it("moves corporate cash into a NAV-valued asset, safely replays the order, and redeems to corporate cash", async () => {
    const { memory, db } = setup();
    const buy = order();
    const response = await tradeCorporationFund(
      db,
      user.toString(),
      character,
      fund,
      buy,
      "subscribe"
    );
    expect(response.status).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
    expect(memory.collection("characters").docs[0].cashOnHand).toBe(500);
    const asset = await loadCorporationFundPortfolio(db, corporationId);
    expect(asset.valueAnchor).toBe(200);
    expect(
      Number(memory.collection("corporations").docs[0].liquidCapital) + asset.valueAnchor
    ).toBe(1000);
    expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10200);
    expect(memory.collection("indexFunds").docs[0].unitSupply).toBe(102);
    expect(memory.collection("indexFundPositions").docs[0]).toMatchObject({
      holderKind: "corporation",
      corporationId,
      units: 2,
      legacyUnits: 0,
    });
    expect(memory.collection("indexFundCommands").docs[0].audit).toMatchObject({
      holderKind: "corporation",
      holderId: corporationId,
      entries: [{ amountNative: -200, balanceAfter: 800 }],
    });
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, buy, "subscribe")).status
    ).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
    expect(memory.collection("indexFundTransactions").docs).toHaveLength(1);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "redeem")).status
    ).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
    expect((await loadCorporationFundPortfolio(db, corporationId)).valueAnchor).toBe(0);
    expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10000);
    expect(resumeFundCommandAudit).toHaveBeenCalled();
  });
  it("denies a non-CEO before moving money or claiming an order", async () => {
    const { memory, db } = setup();
    expect(
      (
        await tradeCorporationFund(
          db,
          new ObjectId().toString(),
          character,
          fund,
          order(),
          "subscribe"
        )
      ).status
    ).toBe(403);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
    expect(memory.collection("indexFundCommands").docs).toHaveLength(0);
  });
  it("cannot mint units with insufficient corporate cash", async () => {
    const { memory, db } = setup(50);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "subscribe"))
        .status
    ).toBe(400);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(50);
    expect(memory.collection("indexFundPositions").docs).toHaveLength(0);
  });
  it("normalizes a yen corporation purchase and redemption through anchor NAV", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { memory, db } = setup(100000, "JPY");
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "subscribe"))
        .status
    ).toBe(200);
    const after = Number(memory.collection("corporations").docs[0].liquidCapital);
    expect(after).toBeLessThanOrEqual(80000);
    expect((await loadCorporationFundPortfolio(db, corporationId)).valueAnchor).toBe(200);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "redeem")).status
    ).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(after + 20000);
    expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10000);
  });
  it("rejects insufficient cross-currency cash without charging a capped partial quote", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { memory, db } = setup(100, "JPY");
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "subscribe"))
        .status
    ).toBe(400);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(100);
    expect(memory.collection("indexFundPositions").docs).toHaveLength(0);
  });
  it("leaves units invested when cash is reserved for queued redemptions", async () => {
    const { memory, db } = setup();
    await tradeCorporationFund(db, user.toString(), character, fund, order(), "subscribe");
    memory.collection("indexFunds").docs[0].cashAnchor = 200;
    memory.seed("indexFundRedemptionQueue", [
      {
        _id: new ObjectId(),
        fundId,
        status: "queued",
        unitsBurnedAtRequest: true,
        units: 1,
        requestedNavAnchor: 100,
        requestedAmountAnchor: 100,
        paidAmountAnchor: 0,
      },
    ]);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, order(), "redeem")).status
    ).toBe(400);
    expect(memory.collection("indexFundPositions").docs[0].units).toBe(2);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
  });
  it("compensates a standalone failure without charging again on retry", async () => {
    const { memory, db } = setup();
    const buy = order();
    vi.spyOn(memory.collection("indexFundTransactions"), "insertOne").mockRejectedValueOnce(
      new Error("write failed")
    );
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, buy, "subscribe")).status
    ).toBe(409);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
    expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10000);
    expect((await loadCorporationFundPortfolio(db, corporationId)).valueAnchor).toBe(0);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, buy, "subscribe")).status
    ).toBe(409);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
  });
  it.each(["single", "batch"])(
    "pays %s dividends to corporate cash in the corporation currency",
    async (path) => {
      vi.mocked(isForexEnabled).mockResolvedValue(true);
      const { memory, db } = setup(100000, "JPY");
      const position = {
        _id: new ObjectId(),
        fundId,
        holderKind: "corporation",
        corporationId,
        units: 2,
        legacyUnits: 0,
      };
      memory.seed("indexFundPositions", [position]);
      if (path === "single") await processIndexFundDividend(db, fundId, 1000, corporationId, 1);
      else
        await processIndexFundDividendsBatch(
          db,
          [{ fundId, corporationId, shares: 1, amountAnchor: 1000 }],
          5
        );
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(100500);
      expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10995);
      const entries = vi.mocked(emitTxBulk).mock.calls.flatMap((call) => call[1]);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subjectType: "corporation",
            subjectId: corporationId,
            amount: 500,
            anchorAmount: 5,
            currencyCode: "JPY",
          }),
        ])
      );
    }
  );
  it("pays wind-up distributions to corporate cash and records corporate ownership", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { memory, db } = setup(100000, "JPY");
    const position = {
      _id: new ObjectId(),
      fundId,
      holderKind: "corporation" as const,
      corporationId,
      units: 2,
      legacyUnits: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(await payFundHolderCash(db, fund, position, 50, 5, new Date())).toBe(true);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(105000);
    expect(memory.collection("indexFundTransactions").docs[0]).toMatchObject({
      kind: "wind_up_distribution",
      holderKind: "corporation",
      corporationId,
      amountAnchor: 50,
    });
  });

  it("routes corporation purchase and redemption bodies to corporate accounting", async () => {
    const { memory, db } = setup();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: user.toString(),
      username: "test",
      character: { _id: character, name: "Investor", countryId: "US" },
    } as never);
    const request = (kind: string) =>
      new Request(`http://localhost/api/investment-funds/test-fund/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order()),
      });
    expect(
      (
        await subscribeRoute(request("subscribe"), {
          params: Promise.resolve({ slug: "test-fund" }),
        })
      ).status
    ).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
    expect(
      (await redeemRoute(request("redeem"), { params: Promise.resolve({ slug: "test-fund" }) }))
        .status
    ).toBe(200);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
    expect(memory.collection("characters").docs[0].cashOnHand).toBe(500);
  });
  it("preserves financial writes when receipt completion is uncertain", async () => {
    const { memory, db } = setup();
    const buy = order();
    const commands = memory.collection("indexFundCommands");
    const originalUpdate = commands.updateOne.bind(commands);
    vi.spyOn(commands, "updateOne").mockImplementation(async (filter, update, options) => {
      if (JSON.stringify(update).includes('"state":"completed"'))
        throw new Error("receipt unavailable");
      return originalUpdate(filter, update, options);
    });
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, buy, "subscribe")).status
    ).toBe(409);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
    expect(memory.collection("indexFundPositions").docs[0].units).toBe(2);
    expect(memory.collection("indexFunds").docs[0].cashAnchor).toBe(10200);
    expect(
      (await tradeCorporationFund(db, user.toString(), character, fund, buy, "subscribe")).status
    ).toBe(409);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(800);
  });
  it("batches corporate wind-up payouts for multiple corporate holders", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { memory, db } = setup(100000, "JPY");
    const secondId = new ObjectId();
    memory.seed("corporations", [
      { _id: secondId, name: "Second", liquidCapital: 1000, liquidCurrencyCode: "GBP" },
    ]);
    const positions = [corporationId, secondId].map((id) => ({
      _id: new ObjectId(),
      fundId,
      holderKind: "corporation" as const,
      corporationId: id,
      units: 2,
      legacyUnits: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const find = vi.spyOn(memory.collection("corporations"), "find");
    const bulk = vi.spyOn(memory.collection("corporations"), "bulkWrite");
    expect(await payCorporateWindUpHolders(db, fund, positions, 25, 5, new Date())).toEqual({
      holdersPaid: 2,
      distributedAnchor: 100,
    });
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(105000);
    expect(memory.collection("corporations").docs[1].liquidCapital).toBe(1100);
    expect(find).toHaveBeenCalledTimes(1);
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(memory.collection("indexFundTransactions").docs).toHaveLength(2);
  });
});
