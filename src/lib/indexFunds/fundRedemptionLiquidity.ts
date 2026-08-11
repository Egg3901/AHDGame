/**
 * Redemption liquidity: sell fund-held shares back to issuer public float so
 * NPPs, other funds, and players can absorb them (mirror of absorption buys).
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation, IndexFund, IndexFundHolding } from "@/lib/db/types";
import { debitSharesFromFund } from "@/lib/corporations/shareholderOps";
import {
  isOrderFlowPriceEligible,
  resolveShareExecutionPrice,
} from "@/lib/corporations/marketExecution";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  onFloatSellCommitted,
  reverseFloatSellDebit,
  settleFloatSellDebit,
} from "@/lib/corporations/shareEscrowSettlement";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { insertFundTransaction, updateFundHoldings } from "@/lib/indexFunds/fundQueries";

export type HoldingSaleInput = {
  corporationId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
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

  const totalValue = eligible.reduce((sum, h) => sum + h.shares * h.pricePerShareAnchor, 0);
  if (totalValue <= 0) return [];

  if (cashNeededAnchor >= totalValue) {
    return eligible.map((h) => ({
      ...h,
      sharesToSell: Math.floor(h.shares),
      proceedsAnchor: Math.floor(h.shares) * h.pricePerShareAnchor,
    }));
  }

  const plans: HoldingSalePlan[] = [];
  let remainingCash = cashNeededAnchor;

  const targets = eligible.map((h) => ({
    ...h,
    holdingValue: h.shares * h.pricePerShareAnchor,
    targetProceeds: (cashNeededAnchor * h.shares * h.pricePerShareAnchor) / totalValue,
  }));

  const soldByCorp = new Map<string, number>();

  for (const target of targets) {
    const sharesToSell = Math.min(
      Math.floor(target.shares),
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
    (a, b) => b.shares * b.pricePerShareAnchor - a.shares * a.pricePerShareAnchor
  );

  while (remainingCash > 0) {
    let assigned = false;
    for (const holding of byValue) {
      const key = holding.corporationId.toString();
      const alreadySold = soldByCorp.get(key) ?? 0;
      const remainingShares = Math.floor(holding.shares) - alreadySold;
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
  fund: IndexFund,
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
  const corps = (await db
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

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const pricedHoldings: HoldingSaleInput[] = [];
  for (const holding of holdingsToSell) {
    const corp = corpMap.get(holding.corporationId.toString());
    if (!corp) continue;
    const executionPrice = resolveShareExecutionPrice(corp);
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const pricePerShareAnchor = shareTradeAnchorValue(
      1,
      { ...corp, sharePrice: executionPrice },
      fxRate
    );
    if (pricePerShareAnchor <= 0) continue;
    pricedHoldings.push({
      corporationId: holding.corporationId,
      shares: holding.shares,
      pricePerShareAnchor,
    });
  }

  const plan = filterSet
    ? pricedHoldings.map((h) => ({
        ...h,
        sharesToSell: Math.floor(h.shares),
        proceedsAnchor: Math.floor(h.shares) * h.pricePerShareAnchor,
      }))
    : planProportionalHoldingsSale(pricedHoldings, cashNeededAnchor);
  if (plan.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  let holdings = [...fund.holdings];
  let cashRaisedAnchor = 0;
  let sharesSold = 0;
  let salesExecuted = 0;
  const turn = await getCurrentTurn(db);
  const now = new Date();

  for (const sale of plan) {
    if (cashRaisedAnchor >= cashNeededAnchor) break;

    const corp = corpMap.get(sale.corporationId.toString());
    if (!corp) continue;

    const saleResult = await executeOneHoldingSale(db, fund, corp, sale, holdings, turn, now, {
      session: options?.session,
      note: options?.note,
    });
    if (!saleResult) continue;

    cashRaisedAnchor += saleResult.proceedsAnchor;
    sharesSold += sale.sharesToSell;
    salesExecuted++;
    holdings = saleResult.updatedHoldings;
  }

  return { cashRaisedAnchor, sharesSold, salesExecuted };
}

// ── Shared per-sale execution helper ─────────────────────────────────────────

type OneHoldingSaleOptions = {
  session?: ClientSession;
  note?: string;
};

type OneHoldingSaleResult = {
  proceedsAnchor: number;
  updatedHoldings: IndexFundHolding[];
};

/**
 * Execute a single holding-sale leg: settle issuer debit, debit shares from
 * fund, credit cash, update holdings, insert tx + trade history.
 * Returns null if the sale could not be executed (issuer block, insufficient
 * holdings, etc.) — the caller must skip and continue.
 */
async function executeOneHoldingSale(
  db: Db,
  fund: IndexFund,
  corp: CorpQuoteRow,
  sale: { corporationId: ObjectId; sharesToSell: number; pricePerShareAnchor: number },
  currentHoldings: IndexFundHolding[],
  turn: number,
  now: Date,
  options?: OneHoldingSaleOptions
): Promise<OneHoldingSaleResult | null> {
  const executionPrice = resolveShareExecutionPrice(corp);
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares);
  const issuerBuyback = sale.sharesToSell * executionPrice;

  const issuerDebit = await settleFloatSellDebit(db, corp, issuerBuyback, {
    session: options?.session,
  });
  if (!issuerDebit.ok) return null;

  const remaining = await debitSharesFromFund(
    db,
    corp._id,
    fund._id,
    sale.sharesToSell,
    {
      $inc: {
        publicFloat: sale.sharesToSell,
        ...(orderFlowEligible
          ? { orderFlowWindowSellValue: sale.sharesToSell * executionPrice }
          : {}),
      },
      $set: { updatedAt: now },
    },
    { requireSufficient: true, session: options?.session }
  );

  if (remaining < 0) {
    await reverseFloatSellDebit(db, corp, issuerBuyback, {
      session: options?.session,
      split: issuerDebit.split,
    });
    return null;
  }

  const fxRate = fxRateForCorpFromMap(corp, await loadFxRatesByCurrency(db));
  const proceedsAnchor =
    Math.round(
      shareTradeAnchorValue(sale.sharesToSell, { ...corp, sharePrice: executionPrice }, fxRate) *
        100
    ) / 100;

  const updatedHoldings = updateHoldingAfterSale(
    currentHoldings,
    sale.corporationId,
    sale.sharesToSell,
    sale.pricePerShareAnchor
  );

  await db
    .collection("indexFunds")
    .updateOne(
      { _id: fund._id },
      { $inc: { cashAnchor: proceedsAnchor }, $set: { updatedAt: now } },
      options?.session ? { session: options.session } : undefined
    );

  await updateFundHoldings(db, fund._id, updatedHoldings, { session: options?.session });

  await insertFundTransaction(
    db,
    {
      fundId: fund._id,
      kind: "public_float_sell",
      corporationId: sale.corporationId,
      shares: sale.sharesToSell,
      navAnchor: sale.pricePerShareAnchor,
      amountAnchor: proceedsAnchor,
      note: options?.note ?? "Redemption liquidity",
      createdAt: now,
    },
    { session: options?.session }
  );

  void recordShareTrade(db, {
    corporationId: corp._id,
    kind: "market_sell",
    turn,
    shares: sale.sharesToSell,
    pricePerShareAnchor: proceedsAnchor / sale.sharesToSell,
    from: { name: `${fund.name} (index fund)` },
    to: null,
    corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp) ?? undefined,
    note: options?.note ?? "Index fund redemption liquidity",
  });

  await onFloatSellCommitted(db, corp, issuerBuyback, { session: options?.session });

  return { proceedsAnchor, updatedHoldings };
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
  fund: IndexFund,
  corporationId: ObjectId,
  maxShares: number,
  options?: { session?: ClientSession; note?: string }
): Promise<SellHoldingsForRedemptionResult> {
  const holding = fund.holdings.find(
    (h) => h.corporationId.toString() === corporationId.toString()
  );
  if (!holding || holding.shares <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const sharesToSell = Math.min(maxShares, Math.floor(holding.shares));
  if (sharesToSell <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const corps = (await db
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

  const executionPrice = resolveShareExecutionPrice(corp);
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const fxRate = fxRateForCorpFromMap(corp, await loadFxRatesByCurrency(db));
  const pricePerShareAnchor = shareTradeAnchorValue(
    1,
    { ...corp, sharePrice: executionPrice },
    fxRate
  );
  if (pricePerShareAnchor <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const turn = await getCurrentTurn(db);
  const now = new Date();

  const saleResult = await executeOneHoldingSale(
    db,
    fund,
    corp,
    { corporationId, sharesToSell, pricePerShareAnchor },
    [...fund.holdings],
    turn,
    now,
    options
  );

  if (!saleResult) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  return {
    cashRaisedAnchor: saleResult.proceedsAnchor,
    sharesSold: sharesToSell,
    salesExecuted: 1,
  };
}
