/**
 * Redemption liquidity: sell fund-held shares back to issuer public float so
 * NPPs, other funds, and players can absorb them (mirror of absorption buys).
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation, IndexFundHolding } from "@/lib/db/types";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  equityPoolCurrency,
  loadEquityQuote,
  readEquityPool,
  loadEquityPoolsByCurrency,
} from "@/lib/equities/marketPool";
import type { EquityMarketPool } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import {
  fundSettlementDb,
  claimFundFloatPlan,
  settleFundFloatPlan,
  reverseCompletedFundFloatPlan,
  type SettlementFund,
} from "./fundFloatSettlement";
import {
  prepareFundFloatTrade,
  loadFloatAuditContext,
  type FloatAuditContext,
} from "./fundFloatTradePlan";

export type HoldingSaleInput = {
  corporationId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  /** Finite currency-pool bid depth available for this holding right now. */
  maxShares?: number;
};

export type HoldingSalePlan = HoldingSaleInput & {
  sharesToSell: number;
  proceedsAnchor: number;
};

/** Plan proportional share sales to raise up to `cashNeededAnchor` (round down). */
export function planProportionalHoldingsSale(
  holdings: HoldingSaleInput[],
  cashNeededAnchor: number
): HoldingSalePlan[] {
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0) return [];

  const eligible = holdings.filter(
    (h) => h.shares > 0 && Number.isFinite(h.pricePerShareAnchor) && h.pricePerShareAnchor > 0
  );
  if (eligible.length === 0) return [];

  const sellableShares = (h: HoldingSaleInput) =>
    Math.max(0, Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER));
  const totalValue = eligible.reduce(
    (sum, h) => sum + sellableShares(h) * h.pricePerShareAnchor,
    0
  );
  if (totalValue <= 0) return [];

  if (cashNeededAnchor >= totalValue) {
    return eligible.map((h) => ({
      ...h,
      sharesToSell: sellableShares(h),
      proceedsAnchor: sellableShares(h) * h.pricePerShareAnchor,
    }));
  }

  const plans: HoldingSalePlan[] = [];
  let remainingCash = cashNeededAnchor;

  const targets = eligible.map((h) => ({
    ...h,
    holdingValue: sellableShares(h) * h.pricePerShareAnchor,
    targetProceeds: (cashNeededAnchor * sellableShares(h) * h.pricePerShareAnchor) / totalValue,
  }));

  const soldByCorp = new Map<string, number>();

  for (const target of targets) {
    const sharesToSell = Math.min(
      sellableShares(target),
      Math.floor(target.targetProceeds / target.pricePerShareAnchor)
    );
    if (sharesToSell <= 0) continue;
    const proceedsAnchor = sharesToSell * target.pricePerShareAnchor;
    plans.push({
      corporationId: target.corporationId,
      shares: target.shares,
      pricePerShareAnchor: target.pricePerShareAnchor,
      sharesToSell,
      proceedsAnchor,
    });
    soldByCorp.set(target.corporationId.toString(), sharesToSell);
    remainingCash -= proceedsAnchor;
  }

  // Assign remainder one share at a time (largest holdings first).
  const byValue = [...eligible].sort(
    (a, b) => sellableShares(b) * b.pricePerShareAnchor - sellableShares(a) * a.pricePerShareAnchor
  );

  while (remainingCash > 0) {
    let assigned = false;
    for (const holding of byValue) {
      const key = holding.corporationId.toString();
      const alreadySold = soldByCorp.get(key) ?? 0;
      const remainingShares = sellableShares(holding) - alreadySold;
      if (remainingShares <= 0) continue;
      if (holding.pricePerShareAnchor > remainingCash + 1e-9) continue;

      const existing = plans.find((p) => p.corporationId.toString() === key);
      if (existing) {
        existing.sharesToSell += 1;
        existing.proceedsAnchor += holding.pricePerShareAnchor;
        soldByCorp.set(key, existing.sharesToSell);
      } else {
        plans.push({
          corporationId: holding.corporationId,
          shares: holding.shares,
          pricePerShareAnchor: holding.pricePerShareAnchor,
          sharesToSell: 1,
          proceedsAnchor: holding.pricePerShareAnchor,
        });
        soldByCorp.set(key, 1);
      }
      remainingCash -= holding.pricePerShareAnchor;
      assigned = true;
      break;
    }
    if (!assigned) break;
  }

  return plans.filter((p) => p.sharesToSell > 0);
}

export function updateHoldingAfterSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  sharesSold: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  return holdings
    .map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares - sharesSold;
      if (newShares <= 0) return null;
      return {
        ...h,
        shares: newShares,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    })
    .filter((h): h is IndexFundHolding => h !== null);
}

export type SellHoldingsForRedemptionResult = {
  cashRaisedAnchor: number;
  sharesSold: number;
  salesExecuted: number;
  /** Standalone-only economic reversal for completed sales, in reverse order. */
  undo?: () => Promise<void>;
};

type CorpQuoteRow = Pick<
  Corporation,
  | "_id"
  | "name"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "publicFloat"
  | "totalShares"
  | "liquidCurrencyCode"
  | "countryId"
  | "shareBuybackMode"
>;

/**
 * Sell fund holdings into public float until `cashNeededAnchor` is raised or
 * sales are exhausted (issuer treasury may block individual corps).
 */
export async function sellFundHoldingsForRedemptionCash(
  db: Db,
  fund: SettlementFund,
  cashNeededAnchor: number,
  options?: {
    session?: ClientSession;
    note?: string;
    corporationIds?: import("mongodb").ObjectId[];
  }
): Promise<SellHoldingsForRedemptionResult> {
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0 || fund.holdings.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const filterSet = options?.corporationIds
    ? new Set(options.corporationIds.map((id) => id.toString()))
    : null;
  const holdingsToSell = filterSet
    ? fund.holdings.filter((h) => filterSet.has(h.corporationId.toString()))
    : fund.holdings;
  if (holdingsToSell.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const corpIds = holdingsToSell.map((h) => h.corporationId);
  const settlementDb = fundSettlementDb(db, options?.session);
  const corps = (await settlementDb
    .collection<CorpQuoteRow>("corporations")
    .find({ _id: { $in: corpIds } })
    .project({
      _id: 1,
      name: 1,
      sharePrice: 1,
      fundamentalSharePrice: 1,
      publicFloat: 1,
      totalShares: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
      shareBuybackMode: 1,
    })
    .toArray()) as CorpQuoteRow[];
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));

  const pools = await loadEquityPoolsByCurrency(settlementDb);
  const audit = await loadFloatAuditContext(settlementDb, options?.session);
  const fxByCurrency = await loadFxRatesByCurrency(settlementDb);
  const pricedHoldings: HoldingSaleInput[] = [];
  for (const holding of holdingsToSell) {
    const corp = corpMap.get(holding.corporationId.toString());
    if (!corp) continue;
    const quote = await loadEquityQuote(settlementDb, corp, { pools });
    const executionPrice = quote.bidPriceLocal;
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const pricePerShareAnchor = shareTradeAnchorValue(
      1,
      { ...corp, sharePrice: executionPrice },
      fxRate
    );
    if (!Number.isFinite(pricePerShareAnchor) || pricePerShareAnchor <= 0) continue;
    pricedHoldings.push({
      corporationId: holding.corporationId,
      shares: holding.shares,
      pricePerShareAnchor,
      maxShares: quote.active ? quote.bidDepthShares : undefined,
    });
  }

  const plan = filterSet
    ? pricedHoldings.map((h) => ({
        ...h,
        sharesToSell: Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER),
        proceedsAnchor:
          Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER) *
          h.pricePerShareAnchor,
      }))
    : planProportionalHoldingsSale(pricedHoldings, cashNeededAnchor);
  if (plan.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  let settlementGeneration = fund.floatSettlementGeneration ?? 0;
  let cashRaisedAnchor = 0;
  let sharesSold = 0;
  let salesExecuted = 0;
  const saleUndos: Array<() => Promise<void>> = [];
  const turn = await getCurrentTurn(settlementDb);

  for (const sale of plan) {
    if (cashRaisedAnchor >= cashNeededAnchor) break;

    const corp = corpMap.get(sale.corporationId.toString());
    if (!corp || !Number.isFinite(sale.sharesToSell) || sale.sharesToSell <= 0) continue;

    const saleResult = await executeOneHoldingSale(db, fund, corp, sale, turn, {
      session: options?.session,
      note: options?.note,
      fxByCurrency,
      pools,
      audit,
      expectedGeneration: settlementGeneration,
    });
    if (!saleResult) {
      // A compensated refusal consumes a generation but must not block other holdings.
      const current = await settlementDb
        .collection<SettlementFund>("indexFunds")
        .findOne({ _id: fund._id }, { projection: { floatSettlementGeneration: 1 } });
      settlementGeneration = current?.floatSettlementGeneration ?? settlementGeneration;
      continue;
    }

    cashRaisedAnchor += saleResult.proceedsAnchor;
    sharesSold += sale.sharesToSell;
    salesExecuted++;
    settlementGeneration = saleResult.settlementGeneration;
    if (saleResult.undo) saleUndos.push(saleResult.undo);
  }

  return {
    cashRaisedAnchor,
    sharesSold,
    salesExecuted,
    ...(saleUndos.length > 0 && !options?.session
      ? {
          undo: async () => {
            const errors: unknown[] = [];
            for (const revert of saleUndos.reverse()) {
              try {
                await revert();
              } catch (error) {
                errors.push(error);
              }
            }
            if (errors.length > 0) {
              throw new AggregateError(
                errors,
                "One or more redemption liquidity sales could not be reversed"
              );
            }
          },
        }
      : {}),
  };
}

// ── Shared per-sale execution helper ─────────────────────────────────────────

type OneHoldingSaleOptions = {
  audit?: FloatAuditContext;
  expectedGeneration?: number;
  session?: ClientSession;
  note?: string;
  settlementCounterparty?: "market" | "issuer";
  /** Preloaded FX inputs shared across the sale pass. */
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>;
  /**
   * The sale's equity pool, read once by the caller. Prices the quote and
   * answers pool existence for the settle and commit legs, which would
   * otherwise each read the same document again.
   */
  pools?: Map<CurrencyCode, EquityMarketPool>;
};

type OneHoldingSaleResult = {
  proceedsAnchor: number;
  updatedHoldings: IndexFundHolding[];
  settlementGeneration: number;
  undo?: () => Promise<void>;
};

/**
 * Execute a single holding-sale leg: settle issuer debit, debit shares from
 * fund, credit cash, update holdings, insert tx + trade history.
 * Returns null if the sale could not be executed (issuer block, insufficient
 * holdings, etc.). The caller skips a proven refusal and resumes an unknown outcome.
 */
async function executeOneHoldingSale(
  db: Db,
  fund: SettlementFund,
  corp: CorpQuoteRow,
  sale: { corporationId: ObjectId; sharesToSell: number; pricePerShareAnchor: number },
  turn: number,
  options?: OneHoldingSaleOptions
): Promise<OneHoldingSaleResult | null> {
  const settlementDb = fundSettlementDb(db, options?.session);
  const pools = options?.pools ?? (await loadEquityPoolsByCurrency(settlementDb));
  const quote = await loadEquityQuote(settlementDb, corp, { pools });
  const issuerFunded = options?.settlementCounterparty === "issuer";
  if (!issuerFunded && quote.active && sale.sharesToSell > quote.bidDepthShares) return null;
  const executionPrice = issuerFunded ? resolveShareExecutionPrice(corp) : quote.bidPriceLocal;
  const fxByCurrency = options?.fxByCurrency ?? (await loadFxRatesByCurrency(settlementDb));
  const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
  const proceedsAnchor =
    Math.round(
      shareTradeAnchorValue(sale.sharesToSell, { ...corp, sharePrice: executionPrice }, fxRate) *
        100
    ) / 100;
  const audit = options?.audit ?? (await loadFloatAuditContext(settlementDb, options?.session));
  const prepared = await prepareFundFloatTrade(settlementDb, {
    fund,
    corp,
    direction: "sell",
    shares: sale.sharesToSell,
    priceLocal: executionPrice,
    priceAnchor: sale.pricePerShareAnchor,
    amountAnchor: proceedsAnchor,
    turn,
    pools,
    issuerFunded,
    audit,
    expectedGeneration: options?.expectedGeneration,
    note: options?.note ?? "Redemption liquidity",
    holdingsAfter: (holdings) =>
      updateHoldingAfterSale(
        holdings,
        sale.corporationId,
        sale.sharesToSell,
        sale.pricePerShareAnchor
      ),
  });
  if (!prepared || !(await claimFundFloatPlan(settlementDb, prepared.fund, prepared.plan)))
    return null;
  if (!(await settleFundFloatPlan(settlementDb, fund._id, prepared.plan))) return null;
  const pool = pools.get(prepared.currency);
  if (pool) pool.cashLocal += prepared.poolDelta;
  return {
    proceedsAnchor,
    updatedHoldings: prepared.plan.holdingsAfter,
    settlementGeneration: (prepared.fund.floatSettlementGeneration ?? 0) + 1,
    ...(options?.session
      ? {}
      : {
          undo: async () => {
            await reverseCompletedFundFloatPlan(db, fund._id, prepared.plan);
          },
        }),
  };
}

// ── sellFundHoldingShares ─────────────────────────────────────────────────────

/**
 * Sell exactly `min(maxShares, held)` shares of ONE corporation back to the
 * public float. Uses the same issuer-settlement body as
 * `sellFundHoldingsForRedemptionCash` via the shared `executeOneHoldingSale`
 * helper, so behaviour is identical — only the share cap differs.
 */
export async function sellFundHoldingShares(
  db: Db,
  fund: SettlementFund,
  corporationId: ObjectId,
  maxShares: number,
  options?: {
    session?: ClientSession;
    note?: string;
    settlementCounterparty?: "market" | "issuer";
    thresholds?: TxThresholds;
    fxByCurrency?: ReadonlyMap<CurrencyCode, number>;
    turn?: number;
    audit?: FloatAuditContext;
    pools?: Map<CurrencyCode, EquityMarketPool>;
  }
): Promise<SellHoldingsForRedemptionResult> {
  const holding = fund.holdings.find(
    (h) => h.corporationId.toString() === corporationId.toString()
  );
  if (!holding || holding.shares <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const settlementDb = fundSettlementDb(db, options?.session);
  const corps = (await settlementDb
    .collection<CorpQuoteRow>("corporations")
    .find({ _id: corporationId })
    .project({
      _id: 1,
      name: 1,
      sharePrice: 1,
      fundamentalSharePrice: 1,
      publicFloat: 1,
      totalShares: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
      shareBuybackMode: 1,
    })
    .toArray()) as CorpQuoteRow[];

  const corp = corps[0];
  if (!corp) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  // One read of the sale's pool serves both quotes and both pool-existence
  // checks below; nothing writes the pool before the sale's own debit.
  const currency = equityPoolCurrency(corp);
  const pools = options?.pools ?? new Map<CurrencyCode, EquityMarketPool>();
  if (!options?.pools) {
    const pool = await readEquityPool(settlementDb, currency);
    if (pool) pools.set(currency, pool);
  }
  const quote = await loadEquityQuote(settlementDb, corp, { pools });
  const issuerFunded = options?.settlementCounterparty === "issuer";
  const sharesToSell = Math.min(
    maxShares,
    Math.floor(holding.shares),
    issuerFunded || !quote.active ? Number.MAX_SAFE_INTEGER : quote.bidDepthShares
  );
  if (sharesToSell <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const executionPrice = issuerFunded ? resolveShareExecutionPrice(corp) : quote.bidPriceLocal;
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const fxByCurrency = options?.fxByCurrency ?? (await loadFxRatesByCurrency(settlementDb));
  const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
  const pricePerShareAnchor = shareTradeAnchorValue(
    1,
    { ...corp, sharePrice: executionPrice },
    fxRate
  );
  if (pricePerShareAnchor <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const turn = options?.turn ?? (await getCurrentTurn(settlementDb));

  const saleResult = await executeOneHoldingSale(
    db,
    fund,
    corp,
    { corporationId, sharesToSell, pricePerShareAnchor },
    turn,
    {
      ...options,
      audit:
        options?.audit ??
        (await loadFloatAuditContext(settlementDb, options?.session, options?.thresholds)),
      fxByCurrency,
      pools,
    }
  );

  if (!saleResult) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  return {
    cashRaisedAnchor: saleResult.proceedsAnchor,
    sharesSold: sharesToSell,
    salesExecuted: 1,
    ...(saleResult.undo ? { undo: saleResult.undo } : {}),
  };
}
