import { queueBankFundSubscription } from "./subscriptionOrders";
import { BSON, ObjectId, type ClientSession, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser, getAuthUserWithCharacter } from "@/lib/auth";
import { charterFund } from "./sponsorship/charterFund";
import { fundCreationEligibility } from "./sponsorship/eligibility";
import { bankMayManageFunds } from "./sponsorship/rules/eligibility";
import { cancelBankFundSubscription, settleBankFundSubscriptions } from "./subscriptions";
import { rebalanceConstituents, rebalanceFundToTarget } from "./fundCronRebalance";
import { processQueuedRedemptions } from "./processQueuedRedemptions";
import { executeFundShareBuy } from "./fundFloatBuyExecution";
import { openFundFloatBatch, loadFloatAuditContext } from "./fundFloatTradePlan";
import { placeFundQuotesBatch } from "./fundShareOrders";
import { recoverAllFundFloatSettlements } from "./fundFloatSettlement";
import {
  pickedStockPurchaseShares,
  validatePickedStocks,
  type PickedStockMandate,
} from "./rules/mandate";
import { computeFundAllocationBreakdown } from "./fundAllocation";
import { planEquityLiquidityQuotes } from "./equityLiquidityFacility";
import { indexFundOwnershipFraction } from "@/lib/corporations/indexOwnership";
import { fundTradeCapabilities } from "./tradeCapabilities";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { canRedeemSponsorUnits } from "./sponsorship/sponsorUnits";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(async () => ({ ok: true, user: await getAuthUser() })),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn(), getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", async (original) => ({
  ...(await original<typeof import("@/lib/audit/recordAudit")>()),
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", async (original) => ({
  ...(await original<typeof import("@/lib/financialTxLog/emit")>()),
  emitTx: vi.fn(async (db: Db, entry: Record<string, unknown>) => {
    await db.collection("financialTxLog").insertOne({ _id: new ObjectId(), ...entry });
    return "applied";
  }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/currency/corporationCapital", async (original) => ({
  ...(await original<typeof import("@/lib/currency/corporationCapital")>()),
  getCorpFxRate: vi.fn(async () => 2),
  loadFxRatesRecord: vi.fn(async () => ({ USD: 2, GBP: 3 })),
}));

function fixture(type: "retail" | "investment" | "universal" = "investment") {
  const memory = createInMemoryDb();
  const session = { endSession: vi.fn(async () => {}) } as unknown as ClientSession;
  let loseCommit = false;
  session.withTransaction = vi.fn(async (work: (s: ClientSession) => Promise<unknown>) => {
    const saved = new Map(
      [...memory.collections].map(([name, c]) => [
        name,
        BSON.EJSON.parse(BSON.EJSON.stringify(c.docs)),
      ])
    );
    let result: unknown;
    try {
      result = await work(session);
    } catch (e) {
      for (const name of memory.collections.keys())
        memory.collection(name).docs = saved.get(name) ?? [];
      throw e;
    }
    if (loseCommit) {
      loseCommit = false;
      throw new Error("UnknownTransactionCommitResult");
    }
    return result;
  }) as ClientSession["withTransaction"];
  const db = Object.assign(memory, { client: { startSession: () => session } }) as unknown as Db;
  const userId = new ObjectId();
  const sponsor = {
    _id: new ObjectId(),
    userId,
    name: "Managing Bank",
    countryId: "US",
    liquidCurrencyCode: "USD",
    liquidCapital: 50_000_000,
    bankCharter: {
      status: "active",
      type,
      currency: "USD",
      postedCapital: 12_000_000,
      totalDeposits: 8_000_000,
      cashReserves: 2_000_000,
      propBook: [{ asset: "equity", ref: String(new ObjectId()), units: 10, costBasis: 1000 }],
    },
  } as unknown as Corporation;
  const issuer = {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Public Company",
    countryId: "US",
    type: "technology",
    sharePrice: 10,
    fundamentalSharePrice: 10,
    totalShares: 100_000,
    publicFloat: 50_000,
    liquidCapital: 1000,
    liquidCurrencyCode: "USD",
    shareholders: [],
  };
  const character = {
    _id: new ObjectId(),
    userId,
    name: "Investor",
    countryId: "US",
    homeCurrency: "USD",
    currencyBalances: { personal: { USD: 100_000 } },
  };
  const mandate: PickedStockMandate = {
    version: 1,
    mode: "picked_stocks",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    cashWeightBps: 2500,
    issuerCapBps: 1500,
    stocks: [{ corporationId: String(issuer._id), weightBps: 1500 }],
  };
  const fund = {
    _id: new ObjectId(),
    slug: "sponsored-pick",
    name: "Picked Fund",
    tickerSymbol: "PICK",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 100,
    reserveUnits: 0,
    cashAnchor: 10_000,
    holdings: [],
    targetConstituents: [],
    mandate,
    sponsorCorporationId: sponsor._id,
    seedAccounting: "paid_units",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as IndexFund;
  memory.seed("corporations", [sponsor as unknown as Record<string, unknown>, issuer]);
  memory.seed("characters", [character]);
  memory.seed("indexFunds", [fund as unknown as Record<string, unknown>]);
  memory.seed("indexFundPositions", [
    {
      _id: new ObjectId(),
      fundId: fund._id,
      holderKind: "corporation",
      corporationId: sponsor._id,
      units: 100,
      legacyUnits: 0,
      avgNavAnchor: 100,
    },
  ]);
  memory.seed("corporateSectors", [
    { _id: new ObjectId(), corporationId: sponsor._id, sectorType: "financial" },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 10 }]);
  memory.seed("gameConfig", [
    {
      _id: "default",
      indexFundsMode: "full",
      playerFundSponsorshipEnabled: false,
      auditLog: false,
    },
  ]);
  memory.seed("federalBudget", [
    { _id: new ObjectId(), countryId: "US", currencyCode: "USD", treasuryBalance: 0 },
  ]);
  memory.seed("exchangeRates", [{ _id: new ObjectId(), currencyCode: "USD", rate: 2 }]);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getAuthUser).mockResolvedValue({ userId: String(userId) } as never);
  vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
    userId: String(userId),
    character,
  } as never);
  const book = () =>
    memory
      .collection("indexFunds")
      .docs.find((f) => String(f._id) === String(fund._id)) as unknown as IndexFund;
  const orders = () => memory.collection("indexFundCommands").docs;
  const total = () =>
    Number(
      memory.collection("characters").docs[0].currencyBalances &&
        (memory.collection("characters").docs[0].currencyBalances as { personal: { USD: number } })
          .personal.USD
    ) /
      2 +
    book().cashAnchor +
    orders().reduce((sum, o) => {
      const s = o.subscription as { status: string; amountAnchor: number };
      return sum + (s?.status === "queued" ? s.amountAnchor : 0);
    }, 0);
  const input = {
    fund,
    characterId: character._id,
    userId: String(userId),
    operationId: "8c307cff-4c27-4628-b03e-f947cd099b6a",
    units: 10,
  };
  const creation = {
    sponsor,
    name: "Domestic Selected Fund",
    tickerSymbol: "NEW",
    scope: "country" as const,
    countryId: "US" as const,
    kind: "broad" as const,
    pickedStocks: mandate.stocks,
    expenseRatioAnnual: 0.005,
    seedCapitalAnchor: 10_000_000,
    currentTurn: 10,
  };
  return {
    memory,
    session,
    db,
    sponsor,
    issuer,
    character,
    fund,
    mandate,
    book,
    orders,
    total,
    input,
    creation,
    loseCommit: () => {
      loseCommit = true;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("bank fund eligibility and segregation", () => {
  it("enforces eligibility and the picked-stock contract through the charter route", async () => {
    const f = fixture();
    const { POST } = await import("@/app/api/index-funds/charter/route");
    const response = await POST(
      new Request("http://localhost/charter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f.creation,
          sponsor: undefined,
          sponsorCorporationId: String(f.sponsor._id),
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(f.memory.collection("indexFunds").docs[1]).toMatchObject({
      mandate: { mode: "picked_stocks" },
    });
  });
  it("queues subscriptions through the investor route and cancels through its owner route", async () => {
    const f = fixture();
    const { POST } = await import("@/app/api/investment-funds/[slug]/subscribe/route");
    const response = await POST(
      new Request("http://localhost/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: f.input.operationId, units: 10 }),
      }),
      { params: Promise.resolve({ slug: f.fund.slug }) }
    );
    expect(response.status).toBe(200);
    expect((await response.json()).queued).toBe(true);
    expect(f.book().cashAnchor).toBe(10000);
    const { DELETE } = await import("@/app/api/investment-funds/subscriptions/[operationId]/route");
    expect(
      (
        await DELETE(new Request("http://localhost/cancel", { method: "DELETE" }), {
          params: Promise.resolve({ operationId: f.input.operationId }),
        })
      ).status
    ).toBe(200);
    expect(f.orders()[0]).toMatchObject({ subscription: { status: "refunded" } });
  });

  it.each(["investment", "universal", "retail"] as const)(
    "uses the same %s charter verdict in creation and the capability",
    async (type) => {
      const f = fixture(type);
      const { GET } = await import("@/app/api/corporations/[id]/funds/route");
      const response = await GET(new Request("http://localhost/funds"), {
        params: Promise.resolve({ id: String(f.sponsor._id) }),
      });
      const capability = (await response.json()).canCreate;
      expect(capability).toBe(type !== "retail");
      const bankBefore = BSON.EJSON.stringify(
        f.memory.collection("corporations").docs[0].bankCharter
      );
      expect((await charterFund(f.db, f.creation)).ok).toBe(capability);
      expect(BSON.EJSON.stringify(f.memory.collection("corporations").docs[0].bankCharter)).toBe(
        bankBefore
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  );
  it.each(["investment", "universal"] as const)(
    "hides and rejects %s bank creation and investing when the fund engine is off",
    async (type) => {
      const f = fixture(type);
      f.memory.collection("gameConfig").docs[0].indexFundsMode = "off";
      const before = f.total();
      const { GET } = await import("@/app/api/corporations/[id]/funds/route");
      const response = await GET(new Request("http://localhost/funds"), {
        params: Promise.resolve({ id: String(f.sponsor._id) }),
      });
      expect(await response.json()).toMatchObject({ canCreate: false, stockChoices: [] });
      expect(await fundCreationEligibility(f.db, f.sponsor)).not.toBeNull();
      expect((await charterFund(f.db, f.creation)).ok).toBe(false);
      expect(
        (await fundTradeCapabilities(f.db, f.fund, { hasCharacter: true, units: 0 })).canSubscribe
      ).toBe(false);
      const { GET: getFund } = await import("@/app/api/investment-funds/[slug]/route");
      const detail = await getFund(new Request("http://localhost/fund"), {
        params: Promise.resolve({ slug: f.fund.slug }),
      });
      expect(detail.status).toBe(200);
      expect((await detail.json()).fund.canSubscribe).toBe(false);
      expect((await queueBankFundSubscription(f.db, f.input)).status).toBe(403);
      const { POST } = await import("@/app/api/investment-funds/[slug]/subscribe/route");
      expect(
        (
          await POST(
            new Request("http://localhost/subscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ units: 10, operationId: f.input.operationId }),
            }),
            { params: Promise.resolve({ slug: f.fund.slug }) }
          )
        ).status
      ).toBe(403);
      expect(f.orders()).toHaveLength(0);
      expect(f.total()).toBe(before);
      f.memory.collection("gameConfig").docs[0].indexFundsMode = "full";
      expect(await fundCreationEligibility(f.db, f.sponsor)).toBeNull();
      expect(
        (await fundTradeCapabilities(f.db, f.fund, { hasCharacter: true, units: 0 })).canSubscribe
      ).toBe(true);
    }
  );

  it("hides creation from other viewers and refuses inactive charters", async () => {
    const f = fixture();
    vi.mocked(getAuthUser).mockResolvedValue({ userId: String(new ObjectId()) } as never);
    const { GET } = await import("@/app/api/corporations/[id]/funds/route");
    expect(
      (
        await (
          await GET(new Request("http://localhost/funds"), {
            params: Promise.resolve({ id: String(f.sponsor._id) }),
          })
        ).json()
      ).canCreate
    ).toBe(false);
    f.sponsor.bankCharter!.status = "revoked";
    expect(bankMayManageFunds(f.sponsor.bankCharter)).toBe(false);
    // A revoked charter counts as no charter: no longer refused as a bank...
    expect(await fundCreationEligibility(f.db, f.sponsor)).not.toMatch(/active/);
    // ...but picking companies still needs an active bank.
    expect((await charterFund(f.db, f.creation)).ok).toBe(false);
  });
  it("matches creation capability when the charter fee cannot settle", async () => {
    const f = fixture();
    f.memory.collection("federalBudget").docs[0].currencyCode = "GBP";
    const { GET } = await import("@/app/api/corporations/[id]/funds/route");
    const response = await GET(new Request("http://localhost/funds"), {
      params: Promise.resolve({ id: String(f.sponsor._id) }),
    });
    expect((await response.json()).canCreate).toBe(false);
    expect((await charterFund(f.db, f.creation)).ok).toBe(false);
  });
  it("replays the same funded contract even after cash falls below the creation minimum", async () => {
    const f = fixture();
    f.creation.seedCapitalAnchor = 22_500_000;
    const first = await charterFund(f.db, f.creation);
    expect(first.ok).toBe(true);
    const changed = f.memory.collection("corporations").docs[0];
    expect(changed.liquidCapital).toBe(0);
    expect(
      (await charterFund(f.db, { ...f.creation, sponsor: changed as unknown as Corporation })).ok
    ).toBe(true);
    expect(f.memory.collection("indexFunds").docs).toHaveLength(2);
  });
  it.each(["private", "foreign", "controlled"])(
    "refuses a %s issuer at creation",
    async (reason) => {
      const f = fixture();
      const issuer = f.memory.collection("corporations").docs[1];
      if (reason === "private") issuer.isPrivate = true;
      if (reason === "foreign") issuer.countryId = "UK";
      if (reason === "controlled") issuer.userId = f.sponsor.userId;
      expect((await charterFund(f.db, f.creation)).ok).toBe(false);
      expect(f.memory.collection("indexFunds").docs).toHaveLength(1);
    }
  );
});

describe("picked-stock limits", () => {
  it("keeps the 25% reserve through six real purchases without renormalizing unavailable stocks", async () => {
    const f = fixture();
    const issuers = Array.from({ length: 6 }, () => ({
      ...f.issuer,
      _id: new ObjectId(),
      userId: new ObjectId(),
    }));
    f.memory.collection("corporations").docs.push(...issuers);
    f.mandate.stocks = issuers.map((c) => ({ corporationId: String(c._id), weightBps: 1250 }));
    f.memory.collection("indexFunds").docs[0].mandate = f.mandate;
    await rebalanceConstituents(f.db, f.book(), issuers as never, { USD: 2 }, 11);
    await rebalanceFundToTarget(
      f.db,
      f.book(),
      issuers as never,
      { USD: 2 },
      new Map(issuers.map((c) => [String(c._id), 10000])),
      11
    );
    expect(f.book().holdings).toHaveLength(6);
    expect(f.book().cashAnchor).toBeGreaterThanOrEqual(2500);
    expect(f.book().holdings.every((h) => h.lastValueAnchor! <= 1250)).toBe(true);
    expect(
      f.book().cashAnchor + f.book().holdings.reduce((sum, h) => sum + h.lastValueAnchor!, 0)
    ).toBeCloseTo(10000);
  });

  it("refuses stale bulk plans and standing quotes for a managed fund", async () => {
    const f = fixture();
    const staleFund = { ...f.fund, mandate: undefined };
    expect(
      await openFundFloatBatch(f.db, {
        fund: staleFund,
        corps: [f.issuer as never],
        turn: 11,
        pools: new Map(),
        audit: await loadFloatAuditContext(f.db),
      })
    ).toBeUndefined();
    expect(await placeFundQuotesBatch(f.db, staleFund, [], new Map())).toBeNull();
    expect(f.book().cashAnchor).toBe(10000);
    expect(f.book().holdings).toEqual([]);
  });

  it("validates count, duplicates, weights, cash target and issuer caps", () => {
    const f = fixture();
    const validate = (change: Partial<PickedStockMandate>) =>
      validatePickedStocks({ ...f.mandate, ...change });
    expect(validate({})).toBeNull();
    expect(validate({ stocks: [] })).toMatch(/1 to 10/);
    expect(validate({ stocks: Array.from({ length: 11 }, () => f.mandate.stocks[0]) })).toMatch(
      /1 to 10/
    );
    expect(validate({ stocks: [f.mandate.stocks[0], f.mandate.stocks[0]] })).toMatch(/once/);
    for (const weightBps of [0, 1501, NaN, 12.5])
      expect(
        validate({ stocks: [{ corporationId: String(f.issuer._id), weightBps }] })
      ).not.toBeNull();
    expect(
      validate({
        stocks: Array.from({ length: 6 }, () => ({
          corporationId: String(new ObjectId()),
          weightBps: 1500,
        })),
      })
    ).toMatch(/75%/);
    expect(validate({ cashWeightBps: 0 as never })).not.toBeNull();
    expect(validate({ issuerCapBps: 1600 as never })).not.toBeNull();
  });
  it("retains capped and unavailable allocation as cash, with no bonds or liquidity quotes", async () => {
    const f = fixture();
    await rebalanceConstituents(f.db, f.fund, [f.issuer as never], { USD: 2 }, 11);
    const outcome = await rebalanceFundToTarget(
      f.db,
      f.book(),
      [f.issuer as never],
      { USD: 2 },
      new Map([[String(f.issuer._id), 10_000]]),
      11
    );
    expect(outcome.buys).toBe(1);
    const fund = f.book();
    const held = fund.holdings[0];
    expect(held.lastValueAnchor).toBeLessThanOrEqual(1500);
    expect(fund.cashAnchor).toBeGreaterThanOrEqual(8500);
    expect(fund.cashAnchor + held.lastValueAnchor!).toBeCloseTo(10000);
    const corp = f.memory.collection("corporations").docs[1];
    expect((corp.shareholders as { shares: number }[])[0].shares).toBe(held.shares);
    expect(indexFundOwnershipFraction(corp as unknown as Corporation)).toBe(0);
    expect(
      computeFundAllocationBreakdown(fund, { bondLiquidityTargetEnabled: true })
        .bondDeploymentNeededAnchor
    ).toBe(0);
    expect(
      planEquityLiquidityQuotes({ funds: [fund], listings: [], turn: 11, totalListings: 1 })
    ).toEqual([]);
    expect(f.memory.collection("shareOrders").docs).toHaveLength(0);
    expect(
      pickedStockPurchaseShares({
        mandate: f.mandate,
        corporationId: String(new ObjectId()),
        cashAnchor: 10000,
        holdings: [],
        requestedShares: 10,
        priceAnchor: 10,
      })
    ).toBe(0);
  });
  it("caps the execution spread and refuses repeated or off-mandate buys", async () => {
    const f = fixture();
    const result = await executeFundShareBuy(f.db, f.fund, f.issuer as never, 10_000, 5, 11);
    expect(result.ok).toBe(true);
    expect(result.anchorSpent).toBeLessThanOrEqual(1500);
    const again = await executeFundShareBuy(f.db, f.book(), f.issuer as never, 10_000, 5, 11);
    expect(again.sharesBought).toBe(0);
    const outsider = { ...f.issuer, _id: new ObjectId() };
    expect((await executeFundShareBuy(f.db, f.book(), outsider as never, 10, 5, 11)).ok).toBe(
      false
    );
    await recoverAllFundFloatSettlements(f.db);
    expect(f.book().holdings[0].shares).toBe(result.sharesBought);
  });
});

describe("next-turn subscription conservation", () => {
  it("reconciles reservation, cancellation and settlement as real cash transfers", async () => {
    const f = fixture();
    const opening = await collectBalances(f.db);
    const reconcile = async () => {
      const entries = deriveLedgerEntries(
        f.memory.collection("financialTxLog").docs as unknown as FinancialTxLogEntry[]
      ).map(finalizeLedgerEntry);
      const report = reconcileLedger({
        turn: 11,
        openingBalances: opening,
        closingBalances: await collectBalances(f.db),
        entries,
      });
      expect(report.stockVsFlow.divergentCount).toBe(0);
      expect(report.trialBalance.unbalancedCount).toBe(0);
    };
    await queueBankFundSubscription(f.db, f.input);
    await reconcile();
    await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
    await reconcile();
    await queueBankFundSubscription(f.db, {
      ...f.input,
      operationId: "3f1ac456-f84b-43fb-903d-7e59974fc214",
    });
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    await reconcile();
  });
  it.each(["character", "corporation"] as const)(
    "records the %s investor and escrow as distinct subjects",
    async (holderKind) => {
      const f = fixture();
      await queueBankFundSubscription(f.db, {
        ...f.input,
        ...(holderKind === "corporation" ? { corporationId: String(f.sponsor._id) } : {}),
      });
      const rows = f.memory.collection("financialTxLog").docs;
      expect(rows[0]).toMatchObject({
        subjectType: holderKind,
        subjectId: holderKind === "corporation" ? f.sponsor._id : f.character._id,
        amount: -2000,
        anchorAmount: -1000,
      });
      expect(rows[0].subjectName).toEqual(expect.any(String));
      expect(rows[1]).toMatchObject({ subjectType: "system", amount: 2000, anchorAmount: 1000 });
      expect(rows[1].subjectId).toBeUndefined();
      await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
      expect(rows[2]).toMatchObject({ subjectType: "system", amount: -2000, anchorAmount: -1000 });
      expect(rows[2].subjectId).toBeUndefined();
      expect(rows[3]).toMatchObject({ subjectType: "fund", subjectId: f.fund._id, amount: 1000 });
    }
  );

  it("rolls back a partially matched receipt batch before retrying", async () => {
    const f = fixture();
    const before = f.total();
    await queueBankFundSubscription(f.db, f.input);
    const commands = f.memory.collection("indexFundCommands");
    const bulkWrite = commands.bulkWrite.bind(commands);
    vi.spyOn(commands, "bulkWrite").mockImplementationOnce(async (operations) => ({
      ...(await bulkWrite(operations)),
      matchedCount: 0,
    }));
    await expect(settleBankFundSubscriptions(f.db, 11, [f.fund._id])).rejects.toThrow(
      "Subscription receipts changed"
    );
    expect(f.total()).toBe(before);
    expect(f.book().unitSupply).toBe(100);
    expect(f.orders()[0]).toMatchObject({ subscription: { status: "queued" } });
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(f.total()).toBe(before);
    expect(f.book().unitSupply).toBe(110);
  });

  it("settles more than one bounded batch in the same due turn", async () => {
    const f = fixture();
    const before = f.total();
    for (let i = 0; i < 101; i++) {
      const response = await queueBankFundSubscription(f.db, {
        ...f.input,
        units: 1,
        operationId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      });
      expect(response.status).toBe(200);
    }
    vi.mocked(f.session.withTransaction).mockClear();
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(vi.mocked(f.session.withTransaction).mock.calls).toHaveLength(2);
    expect(
      f.orders().every((o) => (o.subscription as { status: string }).status === "settled")
    ).toBe(true);
    expect(f.book().cashAnchor).toBe(20100);
    expect(f.book().unitSupply).toBe(201);
    expect(f.total()).toBe(before);
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(f.book().unitSupply).toBe(201);
  });

  it("gives a common batch value to two subscribers and preserves burned withdrawal exposure", async () => {
    const f = fixture();
    await queueBankFundSubscription(f.db, f.input);
    await queueBankFundSubscription(f.db, {
      ...f.input,
      operationId: "3f1ac456-f84b-43fb-903d-7e59974fc214",
      units: 20,
    });
    f.memory.collection("indexFunds").docs[0].unitSupply = 90;
    f.memory.seed("indexFundRedemptionQueue", [
      {
        _id: new ObjectId(),
        fundId: f.fund._id,
        units: 10,
        unitsBurnedAtRequest: true,
        status: "queued",
      },
    ]);
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(f.orders().map((o) => (o.subscription as { units: number }).units)).toEqual([10, 20]);
    expect(f.book().unitSupply).toBe(120);
    expect(f.book().cashAnchor).toBe(13000);
    expect(f.memory.collection("indexFundRedemptionQueue").docs[0].units).toBe(10);
  });

  it("reserves cash without minting, then settles at the next marked NAV and replays once", async () => {
    const f = fixture();
    const before = f.total();
    expect((await queueBankFundSubscription(f.db, f.input)).status).toBe(200);
    expect(f.book().cashAnchor).toBe(10000);
    expect(f.book().unitSupply).toBe(100);
    expect(f.total()).toBe(before);
    await settleBankFundSubscriptions(f.db, 10, [f.fund._id]);
    expect(f.book().unitSupply).toBe(100);
    expect(await canRedeemSponsorUnits(f.db, f.book(), f.sponsor._id)).toBe(false);
    // A genuine price move is marked before the batch. It changes NAV, not cash.
    f.memory.collection("indexFunds").docs[0].holdings = [
      { corporationId: f.issuer._id, shares: 100, lastValueAnchor: 1234 },
    ];
    const markedTotal = f.total();
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    const position = f.memory
      .collection("indexFundPositions")
      .docs.find((p) => p.holderKind === "character")!;
    expect(position.units).toBeCloseTo(1000 / 112.34);
    expect(f.book().holdings).toEqual([
      { corporationId: f.issuer._id, shares: 100, lastValueAnchor: 1234 },
    ]);
    expect(f.total()).toBe(markedTotal);
    expect(f.book().unitSupply).toBeCloseTo(100 + 1000 / 112.34);
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect((await (await queueBankFundSubscription(f.db, f.input)).json()).units).toBeCloseTo(
      1000 / 112.34
    );
    expect(f.book().cashAnchor).toBe(11000);
    expect(f.memory.collection("indexFundTransactions").docs).toHaveLength(1);
    expect((await queueBankFundSubscription(f.db, { ...f.input, units: 20 })).status).toBe(409);
  });
  it("withdraws fractional next-turn units through the existing investor route exactly once", async () => {
    const f = fixture();
    const before = f.total();
    await queueBankFundSubscription(f.db, f.input);
    // A changed marked value creates a fractional allocation.
    f.memory.collection("indexFunds").docs[0].unitSupply = 101;
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    const held = f.memory
      .collection("indexFundPositions")
      .docs.find((p) => p.holderKind === "character")!;
    const units = held.units as number;
    expect(Number.isInteger(units)).toBe(false);
    const { POST } = await import("@/app/api/investment-funds/[slug]/redeem/route");
    const request = () =>
      new Request("http://localhost/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: "89bf9fcc-19c4-488b-bcd1-3a686b1f7d20", units }),
      });
    const response = await POST(request(), { params: Promise.resolve({ slug: f.fund.slug }) });
    expect(response.status).toBe(200);
    expect(f.total()).toBeCloseTo(before);
    expect(f.book().unitSupply).toBeCloseTo(101);
    expect(f.book().cashAnchor).toBeCloseTo(10000);
    expect((await POST(request(), { params: Promise.resolve({ slug: f.fund.slug }) })).status).toBe(
      200
    );
    expect(f.total()).toBeCloseTo(before);
    expect(f.book().unitSupply).toBeCloseTo(101);
  });

  it("settles a fractional queued withdrawal without dropping its claim on retry", async () => {
    const f = fixture();
    const before = f.total();
    f.memory.seed("indexFundRedemptionQueue", [
      {
        _id: new ObjectId(),
        fundId: f.fund._id,
        holderKind: "character",
        characterId: f.character._id,
        units: 0.25,
        requestedNavAnchor: 100,
        requestedAmountAnchor: 25,
        paidAmountAnchor: 0,
        status: "queued",
        unitsBurnedAtRequest: true,
        redeemFxRate: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await processQueuedRedemptions(f.db, f.book(), true, 11);
    expect(f.memory.collection("indexFundRedemptionQueue").docs[0]).toMatchObject({
      units: 0,
      status: "paid",
    });
    expect(f.total()).toBeCloseTo(before);
    const paidCash = f.book().cashAnchor;
    await processQueuedRedemptions(f.db, f.book(), true, 11);
    expect(f.book().cashAnchor).toBe(paidCash);
    expect(f.total()).toBeCloseTo(before);
  });

  it.each(["character", "corporation"] as const)(
    "pays no %s refund or witness when the queued status cannot change",
    async (holderKind) => {
      const f = fixture();
      await queueBankFundSubscription(f.db, {
        ...f.input,
        ...(holderKind === "corporation" ? { corporationId: String(f.sponsor._id) } : {}),
      });
      const cash = vi.spyOn(
        f.memory.collection(holderKind === "corporation" ? "corporations" : "characters"),
        "updateOne"
      );
      const witness = vi.spyOn(f.memory.collection("financialTxLog"), "insertOne");
      const commands = vi
        .spyOn(f.memory.collection("indexFundCommands"), "updateOne")
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 });
      await expect(
        cancelBankFundSubscription(f.db, f.character._id, f.input.operationId)
      ).rejects.toThrow("Subscription refund status changed");
      expect(commands).toHaveBeenCalledWith(
        { _id: `fund:${f.character._id}:${f.input.operationId}`, "subscription.status": "queued" },
        expect.anything(),
        expect.objectContaining({ session: f.session })
      );
      expect(cash).not.toHaveBeenCalled();
      expect(witness).not.toHaveBeenCalled();
      await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
      expect(cash).toHaveBeenCalledTimes(1);
      expect(witness).toHaveBeenCalledTimes(2);
      cash.mockClear();
      witness.mockClear();
      expect(
        (await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId)).status
      ).toBe(200);
      await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
      expect(cash).not.toHaveBeenCalled();
      expect(witness).not.toHaveBeenCalled();
    }
  );

  it.each(["cash", "witness"])(
    "rolls back the refund status after a %s failure and retries once",
    async (step) => {
      const f = fixture();
      const before = f.total();
      await queueBankFundSubscription(f.db, f.input);
      const rowsBefore = f.memory.collection("financialTxLog").docs.length;
      if (step === "cash")
        vi.spyOn(f.memory.collection("characters"), "updateOne").mockRejectedValueOnce(
          new Error("interrupted")
        );
      else
        vi.spyOn(f.memory.collection("financialTxLog"), "insertOne").mockRejectedValueOnce(
          new Error("interrupted")
        );
      await expect(
        cancelBankFundSubscription(f.db, f.character._id, f.input.operationId)
      ).rejects.toThrow("interrupted");
      expect(f.orders()[0]).toMatchObject({ subscription: { status: "queued" } });
      expect(f.memory.collection("financialTxLog").docs).toHaveLength(rowsBefore);
      expect(f.total()).toBe(before);
      await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
      await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
      expect(f.orders()[0]).toMatchObject({ subscription: { status: "refunded" } });
      expect(f.memory.collection("financialTxLog").docs).toHaveLength(rowsBefore + 2);
      expect(f.total()).toBe(before);
    }
  );

  it("cancels before settlement with an exact refund, including native FX", async () => {
    const f = fixture();
    const before = f.total();
    await queueBankFundSubscription(f.db, f.input);
    await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
    await cancelBankFundSubscription(f.db, f.character._id, f.input.operationId);
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(f.total()).toBe(before);
    expect(f.book().unitSupply).toBe(100);
    expect(f.orders()[0]).toMatchObject({ subscription: { status: "refunded" } });
    expect(f.memory.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 100000 } },
    });
  });
  it("reserves corporate cash without touching bank deposits or custody and refunds after charter loss", async () => {
    const f = fixture();
    const bank = BSON.EJSON.stringify(f.sponsor.bankCharter);
    await queueBankFundSubscription(f.db, { ...f.input, corporationId: String(f.sponsor._id) });
    expect(f.memory.collection("corporations").docs[0].liquidCapital).toBe(49998000);
    expect(BSON.EJSON.stringify(f.memory.collection("corporations").docs[0].bankCharter)).toBe(
      bank
    );
    (f.memory.collection("corporations").docs[0].bankCharter as { status: string }).status =
      "failed";
    expect(
      (await fundTradeCapabilities(f.db, f.book(), { hasCharacter: true, units: 0 })).canSubscribe
    ).toBe(false);
    await settleBankFundSubscriptions(f.db, 11, []);
    expect(f.memory.collection("corporations").docs[0].liquidCapital).toBe(50000000);
    expect(f.book().holdings).toEqual([]);
    expect(f.book().unitSupply).toBe(100);
  });
  it.each(["indexFundCommands", "financialTxLog"])(
    "rolls back a crash while reserving at %s",
    async (collection) => {
      const f = fixture();
      const before = f.total();
      vi.spyOn(f.memory.collection(collection), "insertOne").mockRejectedValueOnce(
        new Error("interrupted")
      );
      await expect(queueBankFundSubscription(f.db, f.input)).rejects.toThrow("interrupted");
      expect(f.total()).toBe(before);
      expect(f.orders()).toHaveLength(0);
      expect((await queueBankFundSubscription(f.db, f.input)).status).toBe(200);
      expect(f.total()).toBe(before);
    }
  );
  it.each(["position", "receipt", "cash", "command", "witness"])(
    "recovers a crash at the %s settlement step without losing cash or units",
    async (step) => {
      const f = fixture();
      await executeFundShareBuy(f.db, f.fund, f.issuer as never, 100, 5, 11);
      const holdingsBefore = BSON.EJSON.parse(BSON.EJSON.stringify(f.book().holdings));
      const cashBefore = f.book().cashAnchor;
      const before = f.total();
      await queueBankFundSubscription(f.db, f.input);
      const collection =
        step === "position"
          ? "indexFundPositions"
          : step === "receipt"
            ? "indexFundTransactions"
            : step === "cash"
              ? "indexFunds"
              : step === "command"
                ? "indexFundCommands"
                : "financialTxLog";
      if (step === "command")
        vi.spyOn(f.memory.collection(collection), "bulkWrite").mockRejectedValueOnce(
          new Error("interrupted")
        );
      else if (step === "cash")
        vi.spyOn(f.memory.collection(collection), "updateOne").mockRejectedValueOnce(
          new Error("interrupted")
        );
      else
        vi.spyOn(f.memory.collection(collection), "insertOne").mockRejectedValueOnce(
          new Error("interrupted")
        );
      await expect(settleBankFundSubscriptions(f.db, 11, [f.fund._id])).rejects.toThrow(
        "interrupted"
      );
      expect(f.total()).toBe(before);
      expect(f.book().unitSupply).toBe(100);
      expect(f.book().holdings).toEqual(holdingsBefore);
      expect(f.orders()[0]).toMatchObject({ subscription: { status: "queued" } });
      await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
      await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
      expect(f.total()).toBe(before);
      expect(f.book().cashAnchor).toBe(cashBefore + 1000);
      expect(f.book().holdings).toEqual(holdingsBefore);
      expect(f.book().unitSupply).toBe(110);
    }
  );
  it("reconciles lost commit acknowledgements for reservation and settlement", async () => {
    const f = fixture();
    const before = f.total();
    f.loseCommit();
    expect((await queueBankFundSubscription(f.db, f.input)).status).toBe(200);
    expect(f.orders()).toHaveLength(1);
    f.loseCommit();
    await expect(settleBankFundSubscriptions(f.db, 11, [f.fund._id])).rejects.toThrow(
      "UnknownTransactionCommitResult"
    );
    await settleBankFundSubscriptions(f.db, 11, [f.fund._id]);
    expect(f.total()).toBe(before);
    expect(f.book().unitSupply).toBe(110);
  });
  it("refuses unsupported transactions before debiting cash", async () => {
    const f = fixture();
    const before = f.total();
    f.session.withTransaction = vi.fn(async () => {
      throw new Error("Transactions unsupported");
    });
    await expect(queueBankFundSubscription(f.db, f.input)).rejects.toThrow(
      "Transactions unsupported"
    );
    expect(f.total()).toBe(before);
    expect(f.orders()).toHaveLength(0);
  });
});
