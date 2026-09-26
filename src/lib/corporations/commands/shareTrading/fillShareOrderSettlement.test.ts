import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, getAccessedCollections, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation, ShareOrder } from "@/lib/db/types";
import {
  deriveLedgerEntries,
  fundMirrorAccount,
  type DerivableTx,
} from "@/lib/ledger/deriveFromTx";

vi.mock("./shareFillMoney", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  executeShareFillMoneyFlow: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));

import { executeShareFillMoneyFlow } from "./shareFillMoney";
import { emitSellerFundProceedsRow, settleBuyOrderFill } from "./fillShareOrderSettlement";
import type { ShareFillAuditPlan } from "./shareFillAudit";
import type { ShareFillMoneyPlan } from "./shareFillMoney";

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

function corporation(id: ObjectId): Corporation {
  return {
    _id: id,
    name: "Acme",
    countryId: "US",
    liquidCurrencyCode: "USD",
    sharePrice: 10,
    totalShares: 10_000,
    publicFloat: 1_000,
    shareholders: [],
  } as unknown as Corporation;
}

function fundRowArgs(overrides: Record<string, unknown> = {}) {
  const fundId = new ObjectId();
  const buyerId = new ObjectId();
  const corporationId = new ObjectId();
  const orderId = new ObjectId();
  return {
    ids: { fundId, buyerId, corporationId, orderId },
    args: {
      db: db as unknown as Db,
      fundId,
      fundName: "Market Fund",
      fundAnchorCurrency: "USD",
      total: 980,
      buyer: { type: "corporation", id: buyerId, name: "BuyerCorp" },
      corporationId,
      orderId,
      shares: 100,
      pricePerShare: 9.8,
      currentTurn: 7,
      now: new Date(),
      dedupeId: new ObjectId(),
      ...overrides,
    },
  };
}

describe("emitSellerFundProceedsRow — corporation-buyer site", () => {
  it("emits exactly one fund-subject row naming the corp buyer under the attempt dedupe id", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockResolvedValue("applied");
    const { ids, args } = fundRowArgs();

    await emitSellerFundProceedsRow(args as never);

    // The cashAnchor credit is a keyed money leg now: no indexFunds write here.
    expect(getAccessedCollections(db)).not.toContain("indexFunds");

    expect(emitTx).toHaveBeenCalledTimes(1);
    const [emitDb, row, , options] = vi.mocked(emitTx).mock.calls[0]!;
    expect(emitDb).toBe(db);
    expect(options).toMatchObject({ _id: args.dedupeId });
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "fund",
      subjectId: ids.fundId,
      subjectName: "Market Fund",
      amount: 980,
      anchorAmount: 980,
      currencyCode: "USD",
      counterpartyType: "corporation",
      counterpartyId: ids.buyerId,
      counterpartyName: "BuyerCorp",
      meta: {
        corporationId: ids.corporationId.toString(),
        orderId: ids.orderId.toString(),
        shares: 100,
        pricePerShare: 9.8,
        source: "order_fill_sell_order",
      },
    });

    // No duplicate mirror: fund-subject rows evidence the fund side directly.
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const entries = deriveLedgerEntries([row as unknown as DerivableTx]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0]).toMatchObject({
      account: `fund:${ids.fundId.toString()}:USD`,
      amount: 980,
      anchorAmount: 980,
      role: "primary",
    });
    expect(entries[0]!.legs[1].account).toBe(`corporation:${ids.buyerId.toString()}:USD`);
  });
});

describe("emitSellerFundProceedsRow — character-buyer site", () => {
  it("emits exactly one fund-subject row naming the character buyer", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockResolvedValue("applied");
    const buyerId = new ObjectId();
    const { ids, args } = fundRowArgs({
      total: 490,
      shares: 50,
      buyer: { type: "character", id: buyerId, name: "Buyer" },
    });

    await emitSellerFundProceedsRow(args as never);

    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "fund",
      subjectId: ids.fundId,
      amount: 490,
      anchorAmount: 490,
      currencyCode: "USD",
      counterpartyType: "character",
      counterpartyId: buyerId,
      counterpartyName: "Buyer",
      meta: {
        corporationId: ids.corporationId.toString(),
        orderId: ids.orderId.toString(),
        shares: 50,
        pricePerShare: 9.8,
        source: "order_fill_sell_order",
      },
    });

    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const entries = deriveLedgerEntries([row as unknown as DerivableTx]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0].account).toBe(`fund:${ids.fundId.toString()}:USD`);
    expect(entries[0]!.legs[1].account).toBe(`character:${buyerId.toString()}:USD`);
  });
});

describe("emitSellerFundProceedsRow — convergence", () => {
  it("a duplicate dedupe id converges instead of double-booking", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockResolvedValue("already-applied");
    const { args } = fundRowArgs();

    await expect(emitSellerFundProceedsRow(args as never)).resolves.toBeUndefined();
    expect(emitTx).toHaveBeenCalledTimes(1);
  });

  it("throws when the row cannot land, so the attempt stays in_progress", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockResolvedValue("failed");
    const { args } = fundRowArgs();

    await expect(emitSellerFundProceedsRow(args as never)).rejects.toThrow(
      "share-fill:fund-proceeds-row-failed"
    );
  });
});

function buyFillOrder(orderId: ObjectId, corporationId: ObjectId, fundId: ObjectId): ShareOrder {
  return {
    _id: orderId,
    corporationId,
    placerFundId: fundId,
    liquidityProvider: true,
    type: "buy",
    shares: 50,
    sharesRemaining: 50,
    pricePerShare: 9.8,
    escrowAmount: 490,
    escrowAnchor: 490,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buyFillPlan(
  orderId: ObjectId,
  corporationId: ObjectId,
  fundId: ObjectId,
  fillerId: ObjectId,
  now: Date
): ShareFillAuditPlan {
  return {
    version: 1,
    orderIdHex: orderId.toHexString(),
    corpIdHex: corporationId.toHexString(),
    corpCcy: "USD",
    orderType: "buy",
    shares: 50,
    pricePerShare: 9.8,
    totalAnchor: 490,
    turn: 7,
    nowIso: now.toISOString(),
    preClaimRemaining: 50,
    filler: {
      idHex: fillerId.toHexString(),
      collection: "characters",
      name: "Seller",
      homeCurrency: "USD",
      imperial: false,
    },
    fillerAmount: 490,
    placerKind: "fund",
    placerIdHex: fundId.toHexString(),
    placerName: "Index fund",
    fundTx: false,
    moneyCommitted: false,
  };
}

describe("settleBuyOrderFill — fund buy order (peer fill) moves no fund cash", () => {
  it("runs the keyed buy-fill plan and converges audit without touching indexFunds", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(executeShareFillMoneyFlow).mockResolvedValue({ sharesMoved: 50 });

    const corporationId = new ObjectId();
    const fundId = new ObjectId();
    const fillerId = new ObjectId();
    const orderId = new ObjectId();
    const now = new Date();
    const order = buyFillOrder(orderId, corporationId, fundId);
    const plan = buyFillPlan(orderId, corporationId, fundId, fillerId, now);
    const restoreClaimedOrder = vi.fn();

    const result = await settleBuyOrderFill({
      db: db as unknown as Db,
      corporation: corporation(corporationId),
      order,
      orderCharacterId: undefined,
      buyOrderBuyerCorp: null,
      shares: 50,
      total: 490,
      totalInFillerHome: 490,
      fillerId,
      fillerName: "Seller",
      fillerCollectionName: "characters",
      fillerHomeCurrency: "USD",
      isImperialFiller: false,
      forexEnabled: false,
      currentTurn: 7,
      now,
      restoreClaimedOrder,
      fillKey: "test-fill-key-buy-fund",
      plan,
    });

    expect(result).toBeNull();
    expect(restoreClaimedOrder).not.toHaveBeenCalled();

    // The keyed plan carries the whole fill: filler share debit, fund cap
    // credit at the anchor fill price, fund holdings credit, escrow release
    // — and deliberately NO fund-cash leg (escrow moved at placement).
    expect(executeShareFillMoneyFlow).toHaveBeenCalledTimes(1);
    const moneyPlan = vi.mocked(executeShareFillMoneyFlow).mock.calls[0]![1] as ShareFillMoneyPlan;
    expect(moneyPlan).toMatchObject({
      direction: "buy-fill",
      shares: 50,
      fillerDebit: null,
      sellerProceeds: null,
      fundInventoryDebit: null,
    });
    expect(moneyPlan.fillerCredit).toMatchObject({
      collection: "characters",
      idHex: fillerId.toHexString(),
      amount: 490,
    });
    expect(moneyPlan.sellerDebit).toMatchObject({ field: "characterId" });
    expect(moneyPlan.buyerCredit).toMatchObject({ field: "fundId", pricePerShare: 9.8 });
    expect(moneyPlan.buyerHoldingsCredit).toMatchObject({
      fundIdHex: fundId.toHexString(),
      pricePerShareAnchor: 9.8,
    });

    // No fund cash moves at fill, so the indexFunds collection is never read.
    expect(getAccessedCollections(db)).not.toContain("indexFunds");

    // One ledger row only: the filler's sale against the fund's escrow.
    // Deliberately no fund-subject row — no fund cash moved.
    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "character",
      subjectId: fillerId,
      subjectName: "Seller",
      amount: 490,
      currencyCode: "USD",
      counterpartyType: "system",
      counterpartyName: "Index fund",
      meta: {
        corporationId: corporationId.toString(),
        orderId: orderId.toString(),
        shares: 50,
        pricePerShare: 9.8,
        source: "order_fill_buy_order",
      },
    });
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const stamped = { ...row, anchorAmount: 490 } as unknown as DerivableTx;
    const entries = deriveLedgerEntries([stamped]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0]).toMatchObject({
      account: `character:${fillerId.toString()}:USD`,
      amount: 490,
      anchorAmount: 490,
    });
  });

  it("maps a lost seller-share race to the legacy 409 and restores the claim", async () => {
    vi.mocked(executeShareFillMoneyFlow).mockRejectedValue(
      new Error("SHARE_FILL_MONEY_SELLER_SHARES:guard-rejected")
    );

    const corporationId = new ObjectId();
    const fundId = new ObjectId();
    const fillerId = new ObjectId();
    const orderId = new ObjectId();
    const now = new Date();
    const restoreClaimedOrder = vi.fn();

    const result = await settleBuyOrderFill({
      db: db as unknown as Db,
      corporation: corporation(corporationId),
      order: buyFillOrder(orderId, corporationId, fundId),
      orderCharacterId: undefined,
      buyOrderBuyerCorp: null,
      shares: 50,
      total: 490,
      totalInFillerHome: 490,
      fillerId,
      fillerName: "Seller",
      fillerCollectionName: "characters",
      fillerHomeCurrency: "USD",
      isImperialFiller: false,
      forexEnabled: false,
      currentTurn: 7,
      now,
      restoreClaimedOrder,
      fillKey: "test-fill-key-buy-fund-race",
      plan: buyFillPlan(orderId, corporationId, fundId, fillerId, now),
    });

    expect(restoreClaimedOrder).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
    expect(await result!.json()).toMatchObject({
      error: "You no longer have enough shares to fill this order",
    });
  });
});
