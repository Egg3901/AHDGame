/**
 * Public float trades freeze the existing price, IPO split and cash counterparty.
 * prepareFundFloatTrade records cash, custody and read models for recovery.
 */
import { createHash, randomUUID } from "node:crypto";
import { ObjectId, type Db, type Document, type ClientSession } from "mongodb";
import type { Corporation, GameConfig, IndexFundHolding, EquityMarketPool } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { TransitionLeg, TransitionProjection } from "@/lib/banking/rules/boundary";
import {
  buildAuditEnvelope,
  buildTxDocs,
  loadTxThresholds,
  type TxInput,
} from "@/lib/financialTxLog/emit";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { resolveLedgerTurn } from "@/lib/ledger/ledgerTurn";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { equityPoolCurrency } from "@/lib/equities/marketPool";
import { quoteFloatCustody } from "./rules/floatCustody";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { loadQueuedPayoutAuditContext } from "./queuedPayoutSettlement";
import { type FundFloatPlan, type SettlementFund } from "./fundFloatSettlement";

export type FloatAuditContext = Awaited<ReturnType<typeof loadQueuedPayoutAuditContext>>;
export async function loadFloatAuditContext(
  db: Db,
  session?: ClientSession,
  preloadedThresholds?: TxThresholds
): Promise<FloatAuditContext> {
  if (!session && !preloadedThresholds) return loadQueuedPayoutAuditContext(db);
  // Existing transactions require sequential commands on their session.
  const thresholds = preloadedThresholds ?? (await loadTxThresholds(db));
  const turnLength = await loadTurnLengthMinutes(db);
  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  return {
    thresholds,
    turnLength,
    shadow: config?.ledgerShadow === true,
    auditEnabled: config?.auditLog !== false,
    ledgerTurn: await resolveLedgerTurn(db),
  };
}
type FloatCorp = Pick<
  Corporation,
  "_id" | "countryId" | "liquidCurrencyCode" | "publicFloat" | "totalShares"
> & { name?: string; shareBuybackMode?: string };
type CorpSnapshot = Pick<
  Corporation,
  | "_id"
  | "shareholders"
  | "publicFloat"
  | "pendingShareIssuance"
  | "shareEscrowBalance"
  | "liquidCapital"
  | "orderFlowWindowBuyValue"
  | "orderFlowWindowSellValue"
>;
type Input = {
  fund: SettlementFund;
  corp: FloatCorp;
  direction: "buy" | "sell";
  shares: number;
  priceLocal: number;
  priceAnchor: number;
  amountAnchor: number;
  turn: number;
  pools: ReadonlyMap<CurrencyCode, EquityMarketPool>;
  issuerFunded?: boolean;
  note?: string;
  audit: FloatAuditContext;
  expectedGeneration?: number;
  holdingsAfter: (holdings: IndexFundHolding[]) => IndexFundHolding[];
};
type CashSide = {
  collection: string;
  id: ObjectId | CurrencyCode;
  path: string;
  amount: number;
  trackIssuance?: boolean;
};
function receiptId(key: string, name: string) {
  return new ObjectId(createHash("sha256").update(`${key}:${name}`).digest("hex").slice(0, 24));
}
function originalField(document: object, field: string) {
  return Object.hasOwn(document, field) ? Reflect.get(document, field) : { $exists: false };
}

function custody(input: Input, snapshot: CorpSnapshot, ipoShares: number) {
  const before = snapshot.shareholders ?? [];
  const held = before.filter((holder) => holder.fundId?.toString() === input.fund._id.toString());
  if (held.length > 1) return undefined;
  const own = held[0];
  const quote = quoteFloatCustody({
    direction: input.direction,
    fundShares: own?.shares ?? 0,
    publicFloat: snapshot.publicFloat ?? 0,
    shares: input.shares,
    price: input.priceLocal,
    average: own?.avgCostPerShare,
  });
  if (!quote || (quote.average !== undefined && !Number.isFinite(quote.average))) return undefined;
  const updatedHolder = {
    ...own,
    fundId: input.fund._id,
    shares: quote.fundShares,
    ...(quote.average !== undefined ? { avgCostPerShare: quote.average } : {}),
  };
  const after = before.flatMap((holder) =>
    holder.fundId?.toString() !== input.fund._id.toString()
      ? [holder]
      : quote.fundShares > 0
        ? [updatedHolder]
        : []
  );
  if (!own && quote.fundShares > 0) after.push(updatedHolder);
  const guard: Document = {
    _id: input.corp._id,
    shareholders: originalField(snapshot, "shareholders"),
    publicFloat: originalField(snapshot, "publicFloat"),
  };
  const set: Document = { shareholders: after, publicFloat: quote.publicFloat };
  const undo: Document = { shareholders: before, publicFloat: snapshot.publicFloat ?? 0 };
  const flow = input.direction === "buy" ? "orderFlowWindowBuyValue" : "orderFlowWindowSellValue";
  if (isOrderFlowPriceEligible(input.corp.publicFloat ?? 0, input.corp.totalShares)) {
    guard[flow] = originalField(snapshot, flow);
    set[flow] = (snapshot[flow] ?? 0) + input.shares * input.priceLocal;
    undo[flow] = snapshot[flow] ?? 0;
  }
  if (ipoShares > 0 && snapshot.pendingShareIssuance) {
    guard.pendingShareIssuance = snapshot.pendingShareIssuance;
    set.pendingShareIssuance = {
      ...snapshot.pendingShareIssuance,
      remainingShares: snapshot.pendingShareIssuance.remainingShares - ipoShares,
    };
    undo.pendingShareIssuance = snapshot.pendingShareIssuance;
  }
  return {
    forward: {
      kind: "asset" as const,
      amount: 0,
      collection: "corporations",
      filter: guard,
      set,
      note: "Original frozen equity custody",
    },
    inverse: {
      kind: "asset" as const,
      amount: 0,
      collection: "corporations",
      filter: { _id: input.corp._id, ...set },
      set: undo,
      note: "Restore original refused equity custody",
    },
  };
}

function cashRouting(input: Input, snapshot: CorpSnapshot, currency: CurrencyCode) {
  const amount = input.shares * input.priceLocal;
  const hasPool = !input.issuerFunded && input.pools.has(currency);
  const sides: CashSide[] = [];
  let ipoShares = 0;
  if (hasPool) {
    if (
      input.direction === "buy" &&
      snapshot.pendingShareIssuance?.source === "ipo" &&
      snapshot.pendingShareIssuance.issuedUpfront
    ) {
      ipoShares = Math.min(
        input.shares,
        Math.max(0, snapshot.pendingShareIssuance.remainingShares)
      );
    }
    const issuerAmount =
      input.direction === "buy" && ipoShares > 0
        ? Math.round((amount * ipoShares * 100) / input.shares) / 100
        : 0;
    const poolAmount =
      input.direction === "sell" ? amount : Math.round((amount - issuerAmount) * 100) / 100;
    if (issuerAmount > 0)
      sides.push({
        collection: "corporations",
        id: input.corp._id,
        path: "liquidCapital",
        amount: issuerAmount,
        trackIssuance: true,
      });
    if (poolAmount > 0)
      sides.push({
        collection: "equityMarketPools",
        id: currency,
        path: "cashLocal",
        amount: poolAmount,
      });
  } else if (getShareBuybackMode(input.corp) === "escrow") {
    const escrow =
      input.direction === "buy"
        ? amount
        : Math.min(amount, Math.max(0, snapshot.shareEscrowBalance ?? 0));
    if (escrow > 0)
      sides.push({
        collection: "corporations",
        id: input.corp._id,
        path: "shareEscrowBalance",
        amount: escrow,
      });
    if (amount - escrow > 0)
      sides.push({
        collection: "corporations",
        id: input.corp._id,
        path: "liquidCapital",
        amount: amount - escrow,
      });
  } else
    sides.push({
      collection: "corporations",
      id: input.corp._id,
      path: "liquidCapital",
      amount,
      trackIssuance: true,
    });
  return { sides, ipoShares, amount };
}

function cashLegs(
  input: Input,
  fund: SettlementFund,
  key: string,
  asset: TransitionLeg,
  sides: CashSide[],
  holdings: IndexFundHolding[]
): TransitionLeg[] {
  const buying = input.direction === "buy";
  const legs: TransitionLeg[] = [
    {
      kind: buying ? "debit" : "credit",
      amount: input.amountAnchor,
      collection: "indexFunds",
      path: "cashAnchor",
      filter: { _id: fund._id, "floatSettlementPlan.key": key, holdings: fund.holdings },
      set: { holdings },
      note: "Original frozen fund cash and holding book",
    },
    asset,
    ...sides.map((side): TransitionLeg => ({
      kind: buying ? "credit" : "debit",
      amount: side.amount,
      collection: side.collection,
      filter: { _id: side.id },
      path: side.path,
      note: "Original frozen cash counterparty",
    })),
  ];
  const native = sides.reduce((sum, side) => sum + side.amount, 0);
  if (native !== input.amountAnchor)
    legs.push(
      {
        kind: "burn",
        amount: buying ? input.amountAnchor : native,
        note: "Frozen debit side of the existing FX conversion",
      },
      {
        kind: "mint",
        amount: buying ? native : input.amountAnchor,
        note: "Frozen credit side of the same FX conversion",
      }
    );
  return legs;
}

function cashCounters(input: Input, sides: CashSide[], inverse = false): TransitionProjection[] {
  const sign = input.direction === "buy" ? 1 : -1;
  const reversal = inverse ? -1 : 1;
  return sides.flatMap((side): TransitionProjection[] => {
    if (side.collection === "equityMarketPools")
      return [
        {
          collection: side.collection,
          filter: { _id: side.id },
          update: {
            $inc: {
              [`lifetime.${input.direction === "buy" ? "purchasesIn" : "salesOut"}`]:
                reversal * side.amount,
            },
          },
          note: "Original pool conservation counter",
        },
      ];
    if (!side.trackIssuance) return [];
    return [
      {
        collection: side.collection,
        filter: { _id: side.id },
        update: { $inc: { shareIssuanceProceeds: reversal * sign * side.amount } },
        note: "Original issuer cash flow marker",
      },
    ];
  });
}

function receipts(
  input: Input,
  fund: SettlementFund,
  key: string,
  sides: CashSide[],
  currency: CurrencyCode,
  now: Date
): { forward: TransitionProjection[]; reversal: TransitionProjection[] } {
  const buying = input.direction === "buy",
    sign = buying ? -1 : 1;
  const totalLocal = sides.reduce((sum, side) => sum + side.amount, 0);
  const txs: TxInput[] = [
    {
      type: buying ? "stock_trade_buy" : "stock_trade_sell",
      turn: input.turn,
      createdAt: now,
      subjectType: "fund",
      subjectId: fund._id,
      subjectName: fund.name,
      amount: sign * input.amountAnchor,
      anchorAmount: sign * input.amountAnchor,
      currencyCode: fund.anchorCurrencyCode,
      counterpartyType: "system",
      counterpartyName: "Public float",
      meta: {
        corporationId: String(input.corp._id),
        shares: input.shares,
        pricePerShareAnchor: input.priceAnchor,
        source: input.note ?? "fund-cron-float-trade",
        settlementKey: key,
      },
    },
  ];
  for (const side of sides)
    txs.push({
      type: buying ? "stock_trade_sell" : "stock_trade_buy",
      turn: input.turn,
      createdAt: now,
      subjectType:
        side.collection === "corporations" && side.path === "liquidCapital"
          ? "corporation"
          : "system",
      ...(side.collection === "corporations" ? { subjectId: input.corp._id } : {}),
      subjectName:
        side.collection === "corporations"
          ? (input.corp.name ?? "Public float issuer")
          : `Equity pool ${currency}`,
      amount: -sign * side.amount,
      anchorAmount: (-sign * input.amountAnchor * side.amount) / totalLocal,
      currencyCode: currency,
      counterpartyType: "system",
      counterpartyName: "Public float",
      meta: { source: "fund-float-counterparty", settlementKey: key, cashPath: side.path },
    });
  const financial = buildTxDocs(txs, input.audit.thresholds, input.audit.turnLength, new Map());
  financial.forEach((row, i) => (row._id = receiptId(key, `financial:${i}`)));
  const projections: TransitionProjection[] = [
    {
      collection: "indexFundTransactions",
      insert: {
        _id: receiptId(key, "fund"),
        fundId: fund._id,
        kind: buying ? "public_float_buy" : "public_float_sell",
        corporationId: input.corp._id,
        shares: input.shares,
        navAnchor: input.priceAnchor,
        amountAnchor: input.amountAnchor,
        note: input.note,
        createdAt: now,
      },
      note: "Original fund trade receipt",
    },
    ...financial.map((row): TransitionProjection => ({
      collection: "financialTxLog",
      insert: { ...row },
      note: "Original native cash witness",
    })),
  ];
  if (input.audit.shadow)
    projections.push(
      ...deriveLedgerEntries(financial).map((row, i): TransitionProjection => ({
        collection: "ledgerEntries",
        insert: {
          ...finalizeLedgerEntry({ ...row, turn: input.audit.ledgerTurn ?? row.turn }),
          _id: receiptId(key, `ledger:${i}`),
        },
        note: "Original authoritative cash witness",
      }))
    );
  if (input.audit.auditEnabled)
    projections.push(
      ...financial.map((row, i): TransitionProjection => ({
        collection: "actionAuditLog",
        insert: {
          ...prepareAuditRecord(buildAuditEnvelope(row), {
            turn: input.turn,
            ts: now,
            turnLengthMinutes: input.audit.turnLength,
          }),
          _id: receiptId(key, `audit:${i}`),
        },
        note: "Original trade action audit",
      }))
    );
  projections.push({
    collection: "shareTradeHistory",
    insert: {
      _id: receiptId(key, "history"),
      corporationId: input.corp._id,
      kind: buying ? "market_buy" : "market_sell",
      turn: input.turn,
      createdAt: now,
      shares: input.shares,
      pricePerShareAnchor: buying ? input.priceAnchor : input.amountAnchor / input.shares,
      totalAnchor: Math.round(input.amountAnchor * 100) / 100,
      from: buying ? null : { name: `${fund.name} (index fund)` },
      to: buying ? { name: `${fund.name} (index fund)` } : null,
      corpCurrencyCode: currency,
      note: input.note ?? "Index fund public-float trade",
    },
    note: "Original share trade history",
  });
  const undoKey = `${key}:undo`;
  const reverseFinancial = buildTxDocs(
    txs.map((tx): TxInput => ({
      ...tx,
      type: tx.type === "stock_trade_buy" ? "stock_trade_sell" : "stock_trade_buy",
      amount: -tx.amount,
      anchorAmount: tx.anchorAmount === undefined ? undefined : -tx.anchorAmount,
      meta: { ...tx.meta, settlementKey: undoKey, reversalOf: key },
    })),
    input.audit.thresholds,
    input.audit.turnLength,
    new Map()
  );
  reverseFinancial.forEach((row, i) => (row._id = receiptId(undoKey, `financial:${i}`)));
  const reversal: TransitionProjection[] = [
    {
      collection: "indexFundTransactions",
      insert: {
        ...projections[0].insert,
        _id: receiptId(undoKey, "fund"),
        kind: buying ? "public_float_sell" : "public_float_buy",
        note: "Reversal of the original completed trade",
      },
      note: "Explicit inverse fund receipt",
    },
    ...reverseFinancial.map((row): TransitionProjection => ({
      collection: "financialTxLog",
      insert: { ...row },
      note: "Explicit inverse native cash witness",
    })),
  ];
  if (input.audit.shadow)
    reversal.push(
      ...deriveLedgerEntries(reverseFinancial).map((row, i): TransitionProjection => ({
        collection: "ledgerEntries",
        insert: {
          ...finalizeLedgerEntry({ ...row, turn: input.audit.ledgerTurn ?? row.turn }),
          _id: receiptId(undoKey, `ledger:${i}`),
        },
        note: "Explicit inverse authoritative cash witness",
      }))
    );
  if (input.audit.auditEnabled)
    reversal.push(
      ...reverseFinancial.map((row, i): TransitionProjection => ({
        collection: "actionAuditLog",
        insert: {
          ...prepareAuditRecord(buildAuditEnvelope(row), {
            turn: input.turn,
            ts: now,
            turnLengthMinutes: input.audit.turnLength,
          }),
          _id: receiptId(undoKey, `audit:${i}`),
        },
        note: "Explicit inverse action audit",
      }))
    );
  const history = projections[projections.length - 1].insert!;
  reversal.push({
    collection: "shareTradeHistory",
    insert: {
      ...history,
      _id: receiptId(undoKey, "history"),
      kind: buying ? "market_sell" : "market_buy",
      from: history.to,
      to: history.from,
      note: "Reversal of the original completed trade",
    },
    note: "Explicit inverse trade history",
  });
  return { forward: projections, reversal };
}

export async function prepareFundFloatTrade(db: Db, input: Input) {
  if (
    !Number.isFinite(input.amountAnchor) ||
    input.amountAnchor <= 0 ||
    !Number.isFinite(input.priceLocal) ||
    input.priceLocal <= 0 ||
    !Number.isFinite(input.priceAnchor) ||
    input.priceAnchor <= 0 ||
    !Number.isSafeInteger(input.shares) ||
    input.shares <= 0
  )
    return undefined;
  const fundRow = await db.collection<SettlementFund>("indexFunds").findOne(
    { _id: input.fund._id },
    {
      projection: {
        cashAnchor: 1,
        holdings: 1,
        floatSettlementPlan: 1,
        floatSettlementGeneration: 1,
      },
    }
  );
  const snapshot = await db.collection<CorpSnapshot>("corporations").findOne(
    { _id: input.corp._id },
    {
      projection: {
        shareholders: 1,
        publicFloat: 1,
        pendingShareIssuance: 1,
        shareEscrowBalance: 1,
        liquidCapital: 1,
        orderFlowWindowBuyValue: 1,
        orderFlowWindowSellValue: 1,
      },
    }
  );
  if (!fundRow || !snapshot || fundRow.floatSettlementPlan?.state === "pending") return undefined;
  const expected = input.expectedGeneration ?? input.fund.floatSettlementGeneration ?? 0;
  if ((fundRow.floatSettlementGeneration ?? 0) !== expected) return undefined;
  const fund = { ...input.fund, ...fundRow };
  if (input.direction === "buy" && fund.cashAnchor < input.amountAnchor) return undefined;
  const currency = equityPoolCurrency(input.corp);
  const route = cashRouting(input, snapshot, currency);
  if (!Number.isFinite(route.amount) || route.amount <= 0 || route.sides.length === 0)
    return undefined;
  const assets = custody(input, snapshot, route.ipoShares);
  if (!assets) return undefined;
  const holdings = input.holdingsAfter(fund.holdings ?? []),
    key = `fund-float:${fund._id}:${randomUUID()}`;
  const witness = receipts(input, fund, key, route.sides, currency, new Date());
  const projections = [
    ...cashCounters(input, route.sides),
    ...witness.forward,
    {
      collection: "indexFunds",
      filter: { _id: fund._id, "floatSettlementPlan.key": key },
      update: { $set: { "floatSettlementPlan.state": "completed" } },
      note: "Release the completed original trade quote",
    },
  ];
  const plan: FundFloatPlan = {
    key,
    state: "pending",
    direction: input.direction,
    corporationId: input.corp._id,
    shares: input.shares,
    amountAnchor: input.amountAnchor,
    holdingsBefore: fund.holdings,
    holdingsAfter: holdings,
    inverseCustody: assets.inverse,
    reversalProjections: [...cashCounters(input, route.sides, true), ...witness.reversal],
    transition: {
      key,
      kind: `fund_float_${input.direction}`,
      turn: input.turn,
      currency,
      legs: cashLegs(input, fund, key, assets.forward, route.sides, holdings),
      projections,
      event: { kind: "prop.traded", command: `fund_float_${input.direction}` },
    },
  };
  return {
    fund,
    plan,
    poolDelta: route.sides
      .filter((side) => side.collection === "equityMarketPools")
      .reduce((sum, side) => sum + (input.direction === "buy" ? side.amount : -side.amount), 0),
    currency,
  };
}

/** A batch stays well under the 16 MB document limit: the plan lives on the fund document. */
const BATCH_MAX_TRADES = 24;
const BATCH_MAX_CUSTODY_BYTES = 2_000_000;

export type FundFloatBatchTrade = Pick<
  Input,
  "corp" | "shares" | "priceLocal" | "priceAnchor" | "amountAnchor" | "note" | "holdingsAfter"
>;

export type FundFloatBatchAdd =
  | { status: "accepted"; poolDelta: number; currency: CurrencyCode }
  | { status: "refused" }
  | { status: "full" };

/**
 * Several public float purchases for one fund, frozen as ONE settlement plan.
 *
 * Each trade is judged in order against the fund's running cash and holdings,
 * with the same refusal rules and per-trade rounding as `prepareFundFloatTrade`,
 * so a batch accepts exactly the trades a sequential run would. What changes is
 * the commit: one claim, one journal key, aggregated fund and pool cash legs,
 * and receipts published as grouped inserts. The sealed plan is the recoverable
 * settlement record: it is claimed atomically against the fund's cash, holdings
 * and settlement generation (the epoch that serialises concurrent player trades),
 * and `recoverAllFundFloatSettlements` finishes it after a crash without posting
 * anything twice. Purchases only; liquidity sales keep their own sequential flow.
 */
export async function openFundFloatBatch(
  db: Db,
  ctx: {
    fund: SettlementFund;
    corps: FloatCorp[];
    turn: number;
    pools: ReadonlyMap<CurrencyCode, EquityMarketPool>;
    audit: FloatAuditContext;
    expectedGeneration?: number;
  }
) {
  const snapshotProjection = {
    shareholders: 1,
    publicFloat: 1,
    pendingShareIssuance: 1,
    shareEscrowBalance: 1,
    liquidCapital: 1,
    orderFlowWindowBuyValue: 1,
    orderFlowWindowSellValue: 1,
  };
  const [fundRow, snapshotRows] = await Promise.all([
    db.collection<SettlementFund>("indexFunds").findOne(
      { _id: ctx.fund._id },
      {
        projection: {
          cashAnchor: 1,
          holdings: 1,
          floatSettlementPlan: 1,
          floatSettlementGeneration: 1,
        },
      }
    ),
    db
      .collection<CorpSnapshot>("corporations")
      .find({ _id: { $in: ctx.corps.map((corp) => corp._id) } }, { projection: snapshotProjection })
      .toArray(),
  ]);
  if (!fundRow || fundRow.floatSettlementPlan?.state === "pending") return undefined;
  const expected = ctx.expectedGeneration ?? ctx.fund.floatSettlementGeneration ?? 0;
  if ((fundRow.floatSettlementGeneration ?? 0) !== expected) return undefined;
  const snapshots = new Map(snapshotRows.map((row) => [row._id.toString(), row]));
  const fund: SettlementFund = { ...ctx.fund, ...fundRow };
  const key = `fund-float:${fund._id}:${randomUUID()}`;

  type Staged = {
    input: Input;
    route: ReturnType<typeof cashRouting>;
    assets: NonNullable<ReturnType<typeof custody>>;
    currency: CurrencyCode;
    witness: ReturnType<typeof receipts>;
  };
  const staged: Staged[] = [];
  const seen = new Set<string>();
  let cash = fund.cashAnchor;
  let holdings: IndexFundHolding[] = fund.holdings ?? [];
  let custodyBytes = 0;

  return {
    fund,
    key,
    /** Judge one more purchase against the running book. */
    add(trade: FundFloatBatchTrade): FundFloatBatchAdd {
      if (staged.length >= BATCH_MAX_TRADES || custodyBytes > BATCH_MAX_CUSTODY_BYTES)
        return { status: "full" };
      if (
        !Number.isFinite(trade.amountAnchor) ||
        trade.amountAnchor <= 0 ||
        !Number.isFinite(trade.priceLocal) ||
        trade.priceLocal <= 0 ||
        !Number.isFinite(trade.priceAnchor) ||
        trade.priceAnchor <= 0 ||
        !Number.isSafeInteger(trade.shares) ||
        trade.shares <= 0
      )
        return { status: "refused" };
      const corpKey = trade.corp._id.toString();
      const snapshot = snapshots.get(corpKey);
      // One position per corporation per batch: a second buy of the same name
      // would need the first buy's custody, which a batch freezes up front.
      if (!snapshot || seen.has(corpKey)) return { status: "refused" };
      if (cash < trade.amountAnchor) return { status: "refused" };
      const input: Input = {
        ...trade,
        fund: { ...fund, cashAnchor: cash, holdings },
        direction: "buy",
        turn: ctx.turn,
        pools: ctx.pools,
        audit: ctx.audit,
      };
      const currency = equityPoolCurrency(trade.corp);
      const route = cashRouting(input, snapshot, currency);
      if (!Number.isFinite(route.amount) || route.amount <= 0 || route.sides.length === 0)
        return { status: "refused" };
      const assets = custody(input, snapshot, route.ipoShares);
      if (!assets) return { status: "refused" };
      const witness = receipts(
        input,
        fund,
        `${key}:t${staged.length}`,
        route.sides,
        currency,
        new Date()
      );
      seen.add(corpKey);
      cash -= trade.amountAnchor;
      holdings = trade.holdingsAfter(holdings);
      custodyBytes += JSON.stringify([assets.forward, assets.inverse]).length;
      staged.push({ input, route, assets, currency, witness });
      return {
        status: "accepted",
        currency,
        poolDelta: route.sides
          .filter((side) => side.collection === "equityMarketPools")
          .reduce((sum, side) => sum + side.amount, 0),
      };
    },
    count: () => staged.length,
    /** Freeze every accepted purchase into the single recoverable plan. */
    seal() {
      if (staged.length === 0) return undefined;
      const totalAnchor = staged.reduce((sum, trade) => sum + trade.input.amountAnchor, 0);
      const credits = new Map<string, TransitionLeg>();
      let burn = 0;
      let mint = 0;
      const assetLegs: TransitionLeg[] = [];
      for (const trade of staged) {
        assetLegs.push(trade.assets.forward);
        for (const side of trade.route.sides) {
          const id = `${side.collection}:${String(side.id)}:${side.path}`;
          const existing = credits.get(id);
          if (existing) existing.amount += side.amount;
          else
            credits.set(id, {
              kind: "credit",
              amount: side.amount,
              collection: side.collection,
              filter: { _id: side.id },
              path: side.path,
              note: "Original frozen cash counterparty",
            });
        }
        const native = trade.route.sides.reduce((sum, side) => sum + side.amount, 0);
        if (native !== trade.input.amountAnchor) {
          burn += trade.input.amountAnchor;
          mint += native;
        }
      }
      const legs: TransitionLeg[] = [
        {
          kind: "debit",
          amount: totalAnchor,
          collection: "indexFunds",
          path: "cashAnchor",
          filter: { _id: fund._id, "floatSettlementPlan.key": key, holdings: fund.holdings },
          set: { holdings },
          note: "Original frozen fund cash and holding book",
        },
        ...assetLegs,
        ...credits.values(),
      ];
      if (burn > 0 || mint > 0)
        legs.push(
          {
            kind: "burn",
            amount: burn,
            note: "Frozen debit side of the existing FX conversion",
          },
          {
            kind: "mint",
            amount: mint,
            note: "Frozen credit side of the same FX conversion",
          }
        );
      // Pool counters aggregate per pool; issuer counters stay per corporation.
      const counters = new Map<string, TransitionProjection>();
      const reversalCounters: TransitionProjection[] = [];
      for (const trade of staged) {
        for (const counter of cashCounters(trade.input, trade.route.sides)) {
          const id = `${counter.collection}:${JSON.stringify(counter.filter)}`;
          const existing = counters.get(id);
          if (!existing) {
            const inc = (counter.update as { $inc: Record<string, number> }).$inc;
            counters.set(id, { ...counter, update: { $inc: { ...inc } } });
          } else {
            const inc = (existing.update as { $inc: Record<string, number> }).$inc;
            const add = (counter.update as { $inc: Record<string, number> }).$inc;
            for (const [path, amount] of Object.entries(add)) inc[path] = (inc[path] ?? 0) + amount;
          }
        }
        reversalCounters.push(...cashCounters(trade.input, trade.route.sides, true));
      }
      const groupInserts = (
        pick: (witness: Staged["witness"]) => TransitionProjection[]
      ): TransitionProjection[] => {
        const byCollection = new Map<string, Record<string, unknown>[]>();
        for (const trade of staged)
          for (const projection of pick(trade.witness))
            if (projection.insert) {
              const rows = byCollection.get(projection.collection) ?? [];
              rows.push(projection.insert);
              byCollection.set(projection.collection, rows);
            }
        return [...byCollection].map(([collection, inserts]) => ({
          collection,
          inserts,
          note: "Original batched trade receipts",
        }));
      };
      const projections: TransitionProjection[] = [
        ...counters.values(),
        ...groupInserts((witness) => witness.forward),
        {
          collection: "indexFunds",
          filter: { _id: fund._id, "floatSettlementPlan.key": key },
          update: { $set: { "floatSettlementPlan.state": "completed" } },
          note: "Release the completed original trade quote",
        },
      ];
      const plan: FundFloatPlan = {
        key,
        state: "pending",
        direction: "buy",
        corporationId: staged[0].input.corp._id,
        shares: staged.reduce((sum, trade) => sum + trade.input.shares, 0),
        amountAnchor: totalAnchor,
        holdingsBefore: fund.holdings,
        holdingsAfter: holdings,
        inverseCustody: staged[0].assets.inverse,
        inverseCustodies: staged.map((trade) => trade.assets.inverse),
        reversalProjections: [...reversalCounters, ...groupInserts((witness) => witness.reversal)],
        transition: {
          key,
          kind: "fund_float_buy",
          turn: ctx.turn,
          currency: staged[0].currency,
          legs,
          projections,
          event: { kind: "prop.traded", command: "fund_float_buy" },
        },
      };
      return { fund, plan };
    },
  };
}
