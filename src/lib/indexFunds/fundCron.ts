/**
 * Index Fund Cron Engine
 *
 * Runs once per game turn (via the turn phase):
 *   Pass 1: mark holdings to market, recompute NAV, deploy bond reserve.
 *   Pass 2: recompute target constituents (financial-day cadence, or first init).
 *   Pass 3: two-sided rebalance toward those weights (sell overweight, buy underweight from public float).
 *   Pass 3b: cross-fund rebalancing (same financial-day cadence as Pass 2).
 *   Pass 3c: process queued redemptions and snapshot NAV.
 *   Step 6: NPP fund investing, throttled by NPP_FUND_INVESTMENT_INTERVAL.
 *   Step 7: sponsored expense fees and wind-down.
 *
 * Gated behind the `indexFundsMode` feature flag. If disabled, the engine
 * is a silent no-op. The HTTP route `/api/cron/index-fund` is a manual/debug
 * entry point; it is not registered in `src/lib/cron.ts`.
 */

import { ObjectId } from "mongodb";
import type { ClientSession, Db } from "mongodb";
import type {
  Corporation,
  ExchangeRate,
  GameConfig,
  IndexFund,
  IndexFundHolding,
  IndexFundRedemptionQueueEntry,
  IndexFundTargetConstituent,
} from "@/lib/db/types";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import {
  getFundById,
  listActiveFunds,
  listServiceableFunds,
  updateFundNav,
  updateFundConstituents,
  updateFundHoldings,
  listPendingRedemptions,
  insertFundTransaction,
  insertFundSnapshot,
  setFundStatus,
  FUND_REDEMPTION_QUEUE_COLLECTION,
} from "@/lib/indexFunds/fundQueries";
import {
  INDEX_FUND_INITIAL_NAV,
  calculateBackingRatio,
  quoteCashOnlyRedemption,
} from "@/lib/indexFunds/unitAccounting";
import {
  buildIndexFundTargetConstituents,
  type IndexFundCandidate,
} from "@/lib/indexFunds/constituents";
import { describeFailure } from "./listingStandards";
import { loadActiveWaiverIds, resolveDueListingPetitions } from "./petitions/service";
import { creditSharesToFund } from "@/lib/corporations/shareholderOps";
import {
  isOrderFlowPriceEligible,
  resolveShareExecutionPrice,
} from "@/lib/corporations/marketExecution";
import { applyFloatBuyCredit } from "@/lib/corporations/shareEscrowSettlement";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import {
  sellFundHoldingsForRedemptionCash,
  sellFundHoldingShares,
} from "@/lib/indexFunds/fundRedemptionLiquidity";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { deployBondReserveFromCash } from "@/lib/indexFunds/fundBondReserve";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  corpLiquidCapitalToAnchor,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  holdingsNeedMarkToMarketRefresh,
  refreshFundHoldingsMarkToMarket,
} from "@/lib/indexFunds/fundHoldingsValuation";
import { planFundTargetRebalance } from "@/lib/indexFunds/fundTargetRebalance";
import { calculateHourlyPublicFloatAbsorptionCap } from "@/lib/indexFunds/publicFloatAbsorption";
import {
  executeFundCrossRebalancing,
  planFundCrossRebalancing,
  type CrossRebalanceResult,
} from "@/lib/indexFunds/fundCrossRebalancing";
import { findRemovedConstituentHoldings } from "@/lib/indexFunds/fundConstituentLifecycle";
import {
  redemptionEntryStatusAfterPayout,
  remainingRedemptionUnits,
} from "@/lib/indexFunds/fundRedemptionQueue";
import { logIndexFundRedeem, resolveIndexFundHolder } from "@/lib/indexFunds/fundTxLog";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { TURNS_PER_DAY, MS_PER_TURN } from "@/lib/constants/turnTime";
import { placeFundShareBuyOrder, cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";
import {
  fundBidLimitPriceLocal,
  INDEX_FUND_BID_MAX_OPEN_TURNS,
} from "@/lib/indexFunds/fundBidPolicy";
import { fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ShareOrder } from "@/lib/db/types";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionLiabilityByFundId,
} from "@/lib/indexFunds/fundValuation";
import { refreshEquityLiquidityFacility } from "@/lib/indexFunds/equityLiquidityFacility";
import { loadEquityQuote } from "@/lib/equities/marketPool";

// ── Types ─────────────────────────────────────────────────────────────

export type FundCronResult = {
  fundsProcessed: number;
  navUpdates: number;
  floatPurchases: number;
  rebalances: number;
  crossFundTransfers: number;
  redemptionsPaid: number;
  redemptionsQueued: number;
  bondDeployments: number;
  nppsProcessed: number;
  nppInvested: number;
  /** A5: sponsored funds charged their expense fee this pass. */
  expenseFeesCharged: number;
  expenseFeeAnchor: number;
  /** A5: sponsored funds advanced through wind-up, and those that finished. */
  windDownsAdvanced: number;
  windDownsCompleted: number;
  equityLiquidityQuotePairs: number;
  equityLiquidityDepthAnchor: number;
  errors: string[];
};

// ── Helper: Load exchange rates ───────────────────────────────────────

async function loadExchangeRates(db: Db): Promise<Partial<Record<string, number>>> {
  const docs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  return Object.fromEntries(docs.map((r) => [r.currencyCode, r.rate]));
}

// ── Helper: Load eligible corporation candidates ──────────────────────

type CorpRow = Pick<
  Corporation,
  | "_id"
  | "countryId"
  | "type"
  | "secondaryType"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "totalShares"
  | "liquidCurrencyCode"
> & { publicFloat?: number; shareBuybackMode?: string; liquidCapital?: number };

type EligibleCorpRow = IndexFundCandidate & {
  publicFloat?: number;
  fundamentalSharePrice?: number;
  shareBuybackMode?: string;
  liquidCapital?: number;
};

const INDEX_FUND_CORP_PROJECTION = {
  _id: 1,
  countryId: 1,
  type: 1,
  secondaryType: 1,
  sharePrice: 1,
  fundamentalSharePrice: 1,
  totalShares: 1,
  liquidCurrencyCode: 1,
  publicFloat: 1,
  shareBuybackMode: 1,
  // A7 listing standards: free float and solvency are screened before a corp
  // may enter an index.
  liquidCapital: 1,
} as const;

const INDEX_FUND_CORP_QUERY = {
  isPrivate: { $ne: true },
  hiddenFromExchange: { $ne: true },
  isNationalized: { $ne: true },
  countryOwnerId: { $exists: false },
  sharePrice: { $gt: 0 },
  totalShares: { $gt: 0 },
} as const;

/** All exchange-listed corporations eligible for index composition (market-cap ranked). */
async function loadIndexFundCandidateCorporations(db: Db): Promise<EligibleCorpRow[]> {
  const corps = await db
    .collection<CorpRow>("corporations")
    .find(INDEX_FUND_CORP_QUERY)
    .project(INDEX_FUND_CORP_PROJECTION)
    .toArray();

  return corps.filter(
    (c) => Number.isFinite(c.sharePrice) && c.sharePrice > 0
  ) as EligibleCorpRow[];
}

/** Corporations with issuer-side float available for passive absorption buys. */
async function loadPublicFloatCorporations(db: Db): Promise<EligibleCorpRow[]> {
  const corps = await loadIndexFundCandidateCorporations(db);
  return corps.filter((c) => (c.publicFloat ?? 0) > 0);
}

async function applyMarkToMarketIfNeeded(
  db: Db,
  fund: IndexFund,
  corps: EligibleCorpRow[],
  exchangeRates: Partial<Record<string, number>>
): Promise<IndexFund> {
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));
  if (!holdingsNeedMarkToMarketRefresh(fund, corpById, exchangeRates)) {
    return fund;
  }

  const refreshedHoldings = refreshFundHoldingsMarkToMarket(fund, corpById, exchangeRates);
  await updateFundHoldings(db, fund._id, refreshedHoldings);
  return { ...fund, holdings: refreshedHoldings };
}

// ── Cash helpers for public-float buys ────────────────────────────────

async function atomicallyDebitFundCashAnchor(
  db: Db,
  fundId: IndexFund["_id"],
  amountAnchor: number,
  options?: { session?: ClientSession }
): Promise<Pick<IndexFund, "_id" | "cashAnchor" | "holdings"> | null> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return null;

  return db.collection<IndexFund>("indexFunds").findOneAndUpdate(
    { _id: fundId, cashAnchor: { $gte: amountAnchor } },
    { $inc: { cashAnchor: -amountAnchor }, $set: { updatedAt: new Date() } },
    {
      returnDocument: "after",
      projection: { _id: 1, cashAnchor: 1, holdings: 1 },
      ...(options?.session ? { session: options.session } : {}),
    }
  );
}

async function refundFundCashAnchor(
  db: Db,
  fundId: IndexFund["_id"],
  amountAnchor: number,
  options?: { session?: ClientSession }
): Promise<void> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return;
  await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId },
      { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: new Date() } },
      options?.session ? { session: options.session } : undefined
    );
}

// ── Pass 2 / Pass 3b cadence (financial-day boundary) ─────────────────

export function shouldRebalanceIndexFundConstituents(
  currentTurn: number,
  targetConstituentsLength: number
): boolean {
  // Lock market-cap baskets to the financial-day cadence. Intraday recomputes
  // churn positions, trigger sell/buy loops, and repeatedly hit order-flow.
  return targetConstituentsLength === 0 || (currentTurn > 0 && currentTurn % TURNS_PER_DAY === 0);
}

/**
 * Cross-fund rebalancing (cron Pass 3b) runs on the same daily cadence as
 * constituent rebalancing: inter-fund drift is created when target weights are
 * recomputed (Pass 2), so correcting it on every tick only churns trades
 * (and trade history) for sub-threshold drift. Gating to the day boundary keeps
 * the cross-fund market in step with the basket it is correcting toward.
 */
export function shouldRunCrossFundRebalancing(currentTurn: number): boolean {
  return currentTurn > 0 && currentTurn % TURNS_PER_DAY === 0;
}

// ── Pass 1: Recompute NAV ─────────────────────────────────────────────

export function recomputeNav(
  fund: IndexFund,
  options?: {
    bondPrincipalAnchor?: number;
    openOrdersEscrowAnchor?: number;
    queuedRedemptionLiabilityAnchor?: number;
  }
): number | null {
  const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
  const bondPrincipalAnchor = options?.bondPrincipalAnchor ?? 0;
  const openOrdersEscrowAnchor = options?.openOrdersEscrowAnchor ?? 0;
  const queuedRedemptionLiabilityAnchor = options?.queuedRedemptionLiabilityAnchor ?? 0;
  const totalBacking =
    fund.cashAnchor +
    holdingsValueAnchor +
    bondPrincipalAnchor +
    openOrdersEscrowAnchor -
    queuedRedemptionLiabilityAnchor;
  const totalUnits = fund.unitSupply;
  if (totalUnits <= 0) return INDEX_FUND_INITIAL_NAV;

  const nav = totalBacking / totalUnits;
  return Number.isFinite(nav) && nav > 0 ? nav : null;
}

// ── Pass 3 helper: Absorb public float ────────────────────────────────

/**
 * Execute a single index-fund share purchase from the public float.
 *
 * Debits `shares × sharePriceAnchor` from the fund's `cashAnchor`, credits the
 * shares to the fund, applies the issuer-side float credit, updates holdings,
 * inserts a `public_float_buy` transaction, and fires a `recordShareTrade`
 * side-effect. All writes are wrapped in `runWithOptionalTransaction` so they
 * are atomic on a replica set and individually guarded on standalone mongod.
 *
 * Returns `{ ok: true, sharesBought, anchorSpent }` on success or
 * `{ ok: false, sharesBought: 0, anchorSpent: 0 }` when the debit or credit
 * guard fails (e.g. insufficient cash or float already sold).
 */
export async function executeFundShareBuy(
  db: Db,
  fund: IndexFund,
  corp: EligibleCorpRow,
  shares: number,
  referencePriceAnchor: number,
  currentTurn: number
): Promise<{ ok: boolean; sharesBought: number; anchorSpent: number }> {
  const quote = await loadEquityQuote(db, corp);
  const executionPrice = quote.askPriceLocal;
  // The caller already loaded the fund's anchor-currency reference price in a
  // batch. Preserve that FX conversion and apply only the market-maker spread.
  const executionPriceAnchor =
    quote.mid > 0 ? referencePriceAnchor * (executionPrice / quote.mid) : referencePriceAnchor;
  const actualCost = shares * executionPriceAnchor;
  const actualIssuerCreditLocal = shares * executionPrice;
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat ?? 0, corp.totalShares);

  // Runs both inside a transaction (replica set) and as sequential writes
  // (standalone mongod) — every step is individually guarded/refunded.
  const applyPurchase = async (session?: ClientSession): Promise<boolean> => {
    const sessionOpts = session ? { session } : undefined;

    const debitedFund = await atomicallyDebitFundCashAnchor(db, fund._id, actualCost, sessionOpts);
    if (!debitedFund) return false;

    const creditOk = await creditSharesToFund(
      db,
      corp._id,
      fund._id,
      shares,
      executionPrice,
      {
        $inc: {
          publicFloat: -shares,
          ...(orderFlowEligible ? { orderFlowWindowBuyValue: actualIssuerCreditLocal } : {}),
        },
        $set: { updatedAt: new Date() },
      },
      {
        guardFilter: { publicFloat: { $gte: shares } },
        ...(session ? { session } : {}),
      }
    );

    if (!creditOk) {
      await refundFundCashAnchor(db, fund._id, actualCost, sessionOpts);
      return false;
    }

    await applyFloatBuyCredit(db, corp, actualIssuerCreditLocal, sessionOpts);

    const updatedHoldings = updateHoldingAfterPurchase(
      debitedFund.holdings ?? [],
      corp._id,
      shares,
      executionPriceAnchor
    );
    await updateFundHoldings(db, fund._id, updatedHoldings, sessionOpts);

    await insertFundTransaction(
      db,
      {
        fundId: fund._id,
        kind: "public_float_buy",
        corporationId: corp._id,
        shares,
        navAnchor: executionPriceAnchor,
        amountAnchor: actualCost,
        createdAt: new Date(),
      },
      sessionOpts
    );

    return true;
  };

  const purchaseApplied = await runWithOptionalTransaction(
    (session) => applyPurchase(session),
    () => applyPurchase()
  );

  if (!purchaseApplied) {
    return { ok: false, sharesBought: 0, anchorSpent: 0 };
  }

  void recordShareTrade(db, {
    corporationId: corp._id,
    kind: "market_buy",
    turn: currentTurn,
    shares,
    pricePerShareAnchor: executionPriceAnchor,
    from: null,
    to: { name: `${fund.name} (index fund)` },
    corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp) ?? undefined,
    note: "Index fund public-float absorption",
  });

  return { ok: true, sharesBought: shares, anchorSpent: actualCost };
}

// ── Pass 3: Two-sided drift rebalance ─────────────────────────────────────────

export async function rebalanceFundToTarget(
  db: Db,
  fund: IndexFund,
  corps: EligibleCorpRow[],
  exchangeRates: Partial<Record<string, number>>,
  capRemainingByCorpId: Map<string, number>,
  currentTurn: number
): Promise<{ buys: number; sells: number; bidsPlaced: number; bidsCancelled: number }> {
  const bondPrincipalAnchor = await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates);
  const plan = planFundTargetRebalance({
    fund,
    corps,
    exchangeRates,
    bondPrincipalAnchor,
    capRemainingByCorpId,
  });

  let sells = 0;
  // Sells first so freed cash funds the buys.
  for (const leg of plan.sells) {
    const refreshed = (await getFundById(db, fund._id)) ?? fund;
    const res = await sellFundHoldingShares(db, refreshed, leg.corporationId, leg.shares, {
      note: "Rebalance: trim overweight",
    });
    if (res.sharesSold > 0) sells++;
  }

  let buys = 0;
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));
  for (const leg of plan.buys) {
    const corp = corpMap.get(leg.corporationId.toString());
    if (!corp) continue;
    const refreshed = (await getFundById(db, fund._id)) ?? fund;
    const res = await executeFundShareBuy(
      db,
      refreshed,
      corp,
      leg.shares,
      leg.sharePriceAnchor,
      currentTurn
    );
    if (res.ok) buys++;
  }

  // Place/refresh standing premium bids for residual deficit not satisfiable from float.
  let bidsPlaced = 0;
  let bidsCancelled = 0;

  // Build the canonical in-basket set from targetConstituents (not from plan.bids,
  // which only contains corps with a residual deficit this turn and would wrongly
  // classify float-covered in-basket corps as off-basket).
  const inBasketIds = new Set(fund.targetConstituents.map((t) => t.corporationId.toString()));

  // Cancel stale or off-basket open bids for this fund before placing new ones.
  const allOpenFundBids = await db
    .collection<ShareOrder>("shareOrders")
    .find({ placerFundId: fund._id, type: "buy", status: "open" })
    .toArray();

  const now = Date.now();
  for (const order of allOpenFundBids) {
    const ageInTurns = Math.floor((now - order.createdAt.getTime()) / MS_PER_TURN);
    const corpIdStr = order.corporationId.toString();
    const isOffBasket = !inBasketIds.has(corpIdStr);
    const isStale = ageInTurns >= INDEX_FUND_BID_MAX_OPEN_TURNS;

    if (isOffBasket || isStale) {
      try {
        await cancelFundShareOrder(db, order._id);
        bidsCancelled++;
      } catch (err) {
        console.error(
          `[IndexFund] Failed to cancel stale/off-basket bid ${order._id.toString()}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // A4 perf: one FX map for the whole bid loop instead of a findOne per bid.
  // `getCorpFxRate` hits `exchangeRates` (plus an era-fallback read) every call,
  // and its own doc says to prefer the batch form inside loops. The cron already
  // loaded the whole rate table once at the top of the run, so a per-bid query
  // was re-reading data we were holding. At 50 constituents across every active
  // fund that is hundreds of round trips a turn for a table that cannot change
  // mid-pass.
  const fxByCurrency = new Map<CurrencyCode, number>(
    Object.entries(exchangeRates)
      .filter(([, rate]) => typeof rate === "number" && rate > 0)
      .map(([code, rate]) => [code as CurrencyCode, rate as number])
  );

  // Determine which corps still have open bids after cancellation (to avoid stacking).
  const remainingOpenBids = await db
    .collection<ShareOrder>("shareOrders")
    .find({ placerFundId: fund._id, type: "buy", status: "open" })
    .toArray();
  const openBidCorpIds = new Set(remainingOpenBids.map((o) => o.corporationId.toString()));

  for (const leg of plan.bids) {
    const corpIdStr = leg.corporationId.toString();
    // Never stack: skip if an open bid already exists for this (fund, corp).
    if (openBidCorpIds.has(corpIdStr)) continue;

    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    try {
      const executionPriceLocal = resolveShareExecutionPrice(corp);
      const limitPriceLocal = fundBidLimitPriceLocal(executionPriceLocal);
      const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);

      // Re-fetch fund so cashAnchor reflects all prior writes in this pass.
      const freshFund = (await getFundById(db, fund._id)) ?? fund;

      const result = await placeFundShareBuyOrder(db, {
        fund: freshFund,
        corp,
        shares: leg.shares,
        limitPriceLocal,
        fxRate,
      });

      if (result.ok) {
        openBidCorpIds.add(corpIdStr); // prevent a second bid within this loop
        bidsPlaced++;
      }
    } catch (err) {
      console.error(
        `[IndexFund] Failed to place bid for corp ${corpIdStr}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { buys, sells, bidsPlaced, bidsCancelled };
}

/** Update the holdings array after buying shares of a constituent. */
function updateHoldingAfterPurchase(
  holdings: IndexFundHolding[],
  corporationId: import("mongodb").ObjectId,
  additionalShares: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  const existing = holdings.find((h) => h.corporationId.toString() === corporationId.toString());
  if (existing) {
    return holdings.map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares + additionalShares;
      const newAvg = existing.avgCostPerShareAnchor
        ? (h.shares * h.avgCostPerShareAnchor! + additionalShares * sharePriceAnchor) / newShares
        : sharePriceAnchor;
      return {
        ...h,
        shares: newShares,
        avgCostPerShareAnchor: newAvg,
        lastValueAnchor: (h.lastValueAnchor ?? 0) + additionalShares * sharePriceAnchor,
      };
    });
  }
  return [
    ...holdings,
    {
      corporationId,
      shares: additionalShares,
      avgCostPerShareAnchor: sharePriceAnchor,
      lastValueAnchor: additionalShares * sharePriceAnchor,
    },
  ];
}

// ── Pass 2: Rebalance constituents (financial-day boundaries) ──────────

export async function rebalanceConstituents(
  db: Db,
  fund: IndexFund,
  corps: IndexFundCandidate[],
  exchangeRates: Partial<Record<string, number>>,
  _currentTurn: number,
  /** A7 part 2: corporations holding a committee waiver this turn. */
  waivedIds?: Set<string>
): Promise<boolean> {
  const removed = findRemovedConstituentHoldings(fund, corps);
  if (removed.length > 0) {
    const removalValue = computeHoldingsValueAnchor({ holdings: removed });
    if (removalValue > 0) {
      await sellFundHoldingsForRedemptionCash(db, fund, removalValue, {
        note: "Constituent removal",
        corporationIds: removed.map((h) => h.corporationId),
      });
    }

    fund = (await getFundById(db, fund._id)) ?? fund;
  }

  const definition = getAllFundDefinitions().find((d) => d.slug === fund.slug);
  if (!definition) return false;

  // A7 listing standards: an incumbent gets a grace period before it is sold,
  // so noise around the bar does not churn the position every turn. Incumbency
  // is "targeted OR held" — a corp mid-purchase is already the fund's problem.
  const incumbentIds = new Set<string>([
    ...fund.targetConstituents.map((t) => t.corporationId.toString()),
    ...fund.holdings.filter((h) => h.shares > 0).map((h) => h.corporationId.toString()),
  ]);
  const priorStreaks = new Map(
    (fund.listingFailureStreaks ?? []).map((s) => [
      s.corporationId.toString(),
      s.consecutiveFailures,
    ])
  );

  const targets = buildIndexFundTargetConstituents({
    corporations: corps,
    definition: {
      scope: definition.scope,
      kind: definition.kind,
      countryId: definition.countryId,
      sectorType: definition.sectorType,
      topN: definition.topN,
      anchorCurrencyCode: definition.anchorCurrencyCode,
    },
    exchangeRates,
    retention: { incumbentIds, priorStreaks, waivedIds },
  });

  const targetConstituents: IndexFundTargetConstituent[] = targets.constituents.map((t) => ({
    corporationId: t.corporationId,
    targetWeight: t.targetWeight,
    marketCapAnchor: t.marketCapAnchor,
  }));

  // Only carry streaks for corporations still in this index's candidate pool.
  // A corp that left the mandate entirely (relisted abroad, went private) is not
  // failing a standard, so keeping a stale count would drop it on re-entry.
  const listingFailureStreaks: NonNullable<IndexFund["listingFailureStreaks"]> =
    targets.streaks.map((s) => ({
      corporationId: new ObjectId(s.corporationId),
      consecutiveFailures: s.consecutiveFailures,
      failures: s.failures,
    }));

  await updateFundConstituents(db, fund._id, targetConstituents, new Date(), listingFailureStreaks);

  // Divest what ran out of grace. `findRemovedConstituentHoldings` cannot see
  // these: a delisted corp is still mechanically eligible, so without this it
  // would sit in the book forever, out of the target and never sold.
  if (targets.droppedIds.length > 0) {
    const dropped = new Set(targets.droppedIds);
    const delistedHoldings = fund.holdings.filter(
      (h) => dropped.has(h.corporationId.toString()) && h.shares > 0
    );
    const delistedValue = computeHoldingsValueAnchor({ holdings: delistedHoldings });
    if (delistedValue > 0) {
      // Name the standard that was missed. "Delisted" with no reason gives a
      // holder nothing to check the fund's judgement against.
      const reasons = Array.from(
        new Set(
          targets.streaks
            .filter((s) => dropped.has(s.corporationId))
            .flatMap((s) => s.failures.map(describeFailure))
        )
      );
      await sellFundHoldingsForRedemptionCash(db, fund, delistedValue, {
        note: `Delisted for failing listing standards. ${reasons.join(" ")}`.trim(),
        corporationIds: delistedHoldings.map((h) => h.corporationId),
      });
      fund = (await getFundById(db, fund._id)) ?? fund;
    }
  }

  await insertFundTransaction(db, {
    fundId: fund._id,
    kind: "rebalance",
    navAnchor: fund.quotedNav,
    amountAnchor: 0,
    note: `Rebalanced: ${targetConstituents.length} constituents`,
    createdAt: new Date(),
  });

  return true;
}

// ── Pass 3c: Process queued redemptions ───────────────────────────────

export async function processQueuedRedemptions(
  db: Db,
  fund: IndexFund,
  forexEnabled: boolean,
  currentTurn: number
): Promise<number> {
  const pending = await listPendingRedemptions(db, fund._id);
  if (pending.length === 0) return 0;

  // Wallet credits are in the fund's native currency; the ₳ → native multiplier
  // is stamped on each queue entry at request time (entry.redeemFxRate, ticket
  // #857 grandfather) — 1 for pre-fix legacy units, the fund rate for post-fix
  // units. Fund `cashAnchor` and NPP investment cash stay in ₳. We still gate on
  // rate availability so a momentary outage defers rather than risks a bad payout.
  if (forexEnabled) {
    const fxResult = await loadCharacterFxRate(db, fund.anchorCurrencyCode);
    if (!fxResult.ok) {
      // Rate unavailable — defer payouts to a later cycle.
      console.warn(
        `[indexfund-cron] deferring ${pending.length} queued redemption(s) for ${fund.slug}: FX rate for ${fund.anchorCurrencyCode} unavailable`
      );
      return 0;
    }
  }

  let paid = 0;
  let fundState = fund;
  let availableCash = fund.cashAnchor;

  for (const pendingEntry of pending) {
    // Claim before any fund debit or holder credit. If a later write fails, a
    // processing row is quarantined for manual reconciliation instead of being
    // paid a second time on the next turn. Automatic replay is unsafe because a
    // crash can occur on either side of the holder credit.
    const entry = await db
      .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
      .findOneAndUpdate(
        {
          _id: pendingEntry._id,
          status: pendingEntry.status,
          units: pendingEntry.units,
          paidAmountAnchor: pendingEntry.paidAmountAnchor,
        },
        { $set: { status: "processing", processingStartedAt: new Date(), updatedAt: new Date() } },
        { returnDocument: "before" }
      );
    if (!entry) continue;
    const restoreQueueClaim = async () => {
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing" },
          {
            $set: { status: entry.status, updatedAt: new Date() },
            $unset: { processingStartedAt: "" },
          }
        );
    };

    const unitsRemaining = remainingRedemptionUnits(entry);
    if (unitsRemaining <= 0) {
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing" },
          {
            $set: { status: "paid", updatedAt: new Date() },
            $unset: { processingStartedAt: "" },
          }
        );
      continue;
    }

    const redemptionNav =
      Number.isFinite(entry.requestedNavAnchor) && entry.requestedNavAnchor > 0
        ? entry.requestedNavAnchor
        : fundState.quotedNav;
    const entryObligation = unitsRemaining * redemptionNav;
    if (availableCash < entryObligation && fundState.holdings.length > 0) {
      await sellFundHoldingsForRedemptionCash(db, fundState, entryObligation - availableCash, {
        note: "Queued redemption liquidity",
      });
      fundState = (await getFundById(db, fund._id)) ?? fundState;
      availableCash = fundState.cashAnchor;
    }
    // Bonds are the next line of liquidity: sold to the market pool at its
    // bid, as far as the pool can pay. The only line for a bond fund.
    if (availableCash < entryObligation) {
      const bondSale = await sellFundBondHoldingsForCash(
        db,
        fundState,
        entryObligation - availableCash,
        new Date()
      );
      if (bondSale.proceedsAnchor > 0) {
        fundState = (await getFundById(db, fund._id)) ?? fundState;
        availableCash = fundState.cashAnchor;
      }
    }

    if (availableCash <= 0) {
      await restoreQueueClaim();
      break;
    }

    const quote = quoteCashOnlyRedemption({
      quotedNav: redemptionNav,
      requestedUnits: unitsRemaining,
      cashAnchor: availableCash,
    });

    if (quote.redeemableUnits <= 0) {
      await restoreQueueClaim();
      break;
    }

    const paidAmount = quote.paidAmountAnchor;
    // Native-currency equivalent for personal wallet credits (₳ × blended rate).
    // Absent redeemFxRate = pre-fix queue row → credit rate-free (× 1), matching
    // what the holder was owed under the old symmetric-scale code (no windfall).
    const redeemFxRate = entry.redeemFxRate ?? 1;
    const paidNative = forexEnabled ? paidAmount * redeemFxRate : paidAmount;

    // New queue rows burned units at request time; legacy rows burn as they pay.
    const shouldBurnUnitsNow = entry.unitsBurnedAtRequest !== true;
    const debitFilter: Record<string, unknown> = {
      _id: fund._id,
      cashAnchor: { $gte: paidAmount },
    };
    const debitInc: Record<string, number> = { cashAnchor: -paidAmount };
    if (shouldBurnUnitsNow) {
      debitFilter.unitSupply = { $gte: quote.redeemableUnits };
      debitInc.unitSupply = -quote.redeemableUnits;
    }

    // Guarded debit: only pay out if the fund still holds enough cash. Legacy
    // queued rows also require supply because their units were not burned yet.
    const debitResult = await db.collection<IndexFund>("indexFunds").updateOne(debitFilter, {
      $inc: debitInc,
      $set: { updatedAt: new Date() },
    });
    if (debitResult.matchedCount === 0) {
      await restoreQueueClaim();
      break;
    }
    availableCash -= paidAmount;

    if (entry.characterId) {
      const inc = buildPersonalBalanceInc(paidNative, fundState.anchorCurrencyCode, forexEnabled);
      const creditResult = await db
        .collection("characters")
        .updateOne({ _id: entry.characterId }, { $inc: inc, $set: { updatedAt: new Date() } });
      if (creditResult.matchedCount === 0) {
        // Character gone — refund the fund cash and skip this entry
        await db.collection<IndexFund>("indexFunds").updateOne(
          { _id: fund._id },
          {
            $inc: {
              cashAnchor: paidAmount,
              ...(shouldBurnUnitsNow ? { unitSupply: quote.redeemableUnits } : {}),
            },
          }
        );
        await restoreQueueClaim();
        continue;
      }
    } else if (entry.imperialCharacterId) {
      const inc = buildPersonalBalanceInc(paidNative, fundState.anchorCurrencyCode, forexEnabled);
      const creditResult = await db
        .collection("imperialCharacters")
        .updateOne(
          { _id: entry.imperialCharacterId },
          { $inc: inc, $set: { updatedAt: new Date() } }
        );
      if (creditResult.matchedCount === 0) {
        await db.collection<IndexFund>("indexFunds").updateOne(
          { _id: fund._id },
          {
            $inc: {
              cashAnchor: paidAmount,
              ...(shouldBurnUnitsNow ? { unitSupply: quote.redeemableUnits } : {}),
            },
          }
        );
        await restoreQueueClaim();
        continue;
      }
    } else if (entry.nppId) {
      const creditResult = await db.collection("npps").updateOne(
        { _id: entry.nppId },
        {
          $inc: { nppInvestmentCashAnchor: paidAmount },
          $set: { updatedAt: new Date() },
        }
      );
      if (creditResult.matchedCount === 0) {
        await db.collection<IndexFund>("indexFunds").updateOne(
          { _id: fund._id },
          {
            $inc: {
              cashAnchor: paidAmount,
              ...(shouldBurnUnitsNow ? { unitSupply: quote.redeemableUnits } : {}),
            },
          }
        );
        await restoreQueueClaim();
        continue;
      }
    } else {
      await db.collection<IndexFund>("indexFunds").updateOne(
        { _id: fund._id },
        {
          $inc: {
            cashAnchor: paidAmount,
            ...(shouldBurnUnitsNow ? { unitSupply: quote.redeemableUnits } : {}),
          },
        }
      );
      await restoreQueueClaim();
      continue;
    }

    const remainingAfterPay = quote.queuedUnits;
    await db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION).updateOne(
      { _id: entry._id, status: "processing" },
      {
        $set: {
          status: redemptionEntryStatusAfterPayout(remainingAfterPay),
          paidAmountAnchor: (entry.paidAmountAnchor ?? 0) + paidAmount,
          units: remainingAfterPay,
          requestedAmountAnchor: remainingAfterPay * redemptionNav,
          updatedAt: new Date(),
        },
        $unset: { processingStartedAt: "" },
      }
    );

    await insertFundTransaction(db, {
      fundId: fund._id,
      kind: "redemption",
      holderKind: entry.holderKind,
      characterId: entry.characterId,
      imperialCharacterId: entry.imperialCharacterId,
      nppId: entry.nppId,
      units: quote.redeemableUnits,
      navAnchor: redemptionNav,
      amountAnchor: paidAmount,
      note: "Paid from queued redemption",
      createdAt: new Date(),
    });

    if (entry.holderKind === "character" || entry.holderKind === "imperial_character") {
      const holder = await resolveIndexFundHolder(db, entry);
      if (holder) {
        void logIndexFundRedeem(db, {
          fund: fundState,
          holder,
          units: quote.redeemableUnits,
          navAnchor: redemptionNav,
          amountAnchor: paidAmount,
          source: "cron_queue",
          queuedRemainder: remainingAfterPay,
          turn: currentTurn,
        });
      }
    }

    paid++;
  }

  return paid;
}

// ── Main engine ───────────────────────────────────────────────────────

/**
 * Run the full index-fund cron cycle.
 *
 * Pass 1 marks holdings and recomputes NAV; Pass 2 recomputes constituents
 * on the financial-day cadence; Pass 3 two-sided rebalances (including float
 * buys); Pass 3b cross-fund market; Pass 3c redemptions and snapshot;
 * Step 6 NPP investing (throttled by NPP_FUND_INVESTMENT_INTERVAL); Step 7
 * sponsored fees and wind-down. Gated behind indexFundsMode.
 */
export async function runIndexFundCron(
  db: Db,
  options?: { currentTurn?: number }
): Promise<FundCronResult> {
  const result: FundCronResult = {
    fundsProcessed: 0,
    navUpdates: 0,
    floatPurchases: 0,
    rebalances: 0,
    crossFundTransfers: 0,
    redemptionsPaid: 0,
    redemptionsQueued: 0,
    bondDeployments: 0,
    nppsProcessed: 0,
    nppInvested: 0,
    expenseFeesCharged: 0,
    expenseFeeAnchor: 0,
    windDownsAdvanced: 0,
    windDownsCompleted: 0,
    equityLiquidityQuotePairs: 0,
    equityLiquidityDepthAnchor: 0,
    errors: [],
  };
  const currentTurn = options?.currentTurn ?? 0;

  if (!(await isIndexFundsEnabled())) {
    try {
      await refreshEquityLiquidityFacility({
        db,
        turn: currentTurn,
        enabled: false,
        funds: [],
        listings: [],
        totalListings: 0,
      });
    } catch (err) {
      result.errors.push(
        `Equity liquidity cleanup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return result;
  }

  // Env-gated pass-level timing (SIM_CORP_TIMING=1), same mechanism as the
  // corporation/NPP turn phases — zero-cost when off.
  const timingOn = process.env.SIM_CORP_TIMING === "1";
  const passTimings: Array<[string, number]> = [];
  let _tPrev = timingOn ? Date.now() : 0;
  const mark = (label: string): void => {
    if (!timingOn) return;
    const nowMs = Date.now();
    passTimings.push([label, nowMs - _tPrev]);
    _tPrev = nowMs;
  };

  const liquidityConfig = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        indexFundBondLiquidityEnabled: 1,
        equityLiquidityFacilityEnabled: 1,
      },
    }
  );
  const bondLiquidityEnabled = liquidityConfig?.indexFundBondLiquidityEnabled === true;
  const equityLiquidityEnabled = liquidityConfig?.equityLiquidityFacilityEnabled === true;
  const forexEnabled = await isForexEnabled();
  const exchangeRates = await loadExchangeRates(db);
  const candidateCorps = await loadIndexFundCandidateCorporations(db);
  const floatCorps = await loadPublicFloatCorporations(db);
  const absorptionRemainingByCorpId = new Map(
    floatCorps.map((corp) => [
      corp._id.toString(),
      calculateHourlyPublicFloatAbsorptionCap({
        totalShares: corp.totalShares,
        publicFloat: corp.publicFloat ?? 0,
      }),
    ])
  );
  let funds = await listServiceableFunds(db);
  const redemptionServiceFundIds = funds.map((fund) => fund._id);
  // Load valuation side ledgers once before Pass 1 so NAV includes committed
  // bid escrow and subtracts queued redemption payables.
  const fundIds = funds.map((fund) => fund._id);
  const openOrdersEscrowByFundId = await loadOpenOrdersEscrowByFundId(db, fundIds);
  const queuedLiabilityByFundId = await loadQueuedRedemptionLiabilityByFundId(db, fundIds);

  // Pass 1: mark holdings, recompute NAV, deploy bond reserve.
  const navReadyFundIds: IndexFund["_id"][] = [];
  for (const fund of funds) {
    try {
      const workingFund = await applyMarkToMarketIfNeeded(db, fund, candidateCorps, exchangeRates);

      const bondPrincipalAnchor = await sumFundBondHoldingsValueAnchor(
        db,
        workingFund,
        exchangeRates
      );
      const openOrdersEscrowAnchor = openOrdersEscrowByFundId.get(workingFund._id.toString()) ?? 0;
      const queuedRedemptionLiabilityAnchor =
        queuedLiabilityByFundId.get(workingFund._id.toString()) ?? 0;

      const newNav = recomputeNav(workingFund, {
        bondPrincipalAnchor,
        openOrdersEscrowAnchor,
        queuedRedemptionLiabilityAnchor,
      });

      if (newNav === null || !Number.isFinite(newNav) || newNav <= 0) {
        // Backing has collapsed (total assets minus queued liabilities went negative).
        // Freeze immediately so no new subscriptions deepen the hole. Write the true
        // backing ratio (≤ 0) so dashboards show the real state.
        const holdingsValue = computeHoldingsValueAnchor(workingFund);
        const actualBacking = Math.max(
          0,
          workingFund.cashAnchor +
            holdingsValue +
            bondPrincipalAnchor +
            openOrdersEscrowAnchor -
            queuedRedemptionLiabilityAnchor
        );
        const quotedLiability = workingFund.quotedNav * workingFund.unitSupply;
        await updateFundNav(db, workingFund._id, {
          quotedNav: workingFund.quotedNav,
          backingRatio: quotedLiability > 0 ? actualBacking / quotedLiability : 0,
        });
        await setFundStatus(db, workingFund._id, "paused", "backing_ratio");
        result.errors.push(
          `Fund ${workingFund.slug} auto-paused: backing collapsed (assets=${actualBacking.toFixed(0)}, liability=${quotedLiability.toFixed(0)})`
        );
        result.fundsProcessed++;
        continue;
      }

      const holdingsValue = computeHoldingsValueAnchor(workingFund);
      const backing = calculateBackingRatio({
        cashAnchor: workingFund.cashAnchor,
        holdingsValueAnchor: holdingsValue,
        bondPrincipalAnchor,
        openOrdersEscrowAnchor,
        queuedRedemptionLiabilityAnchor,
        quotedNav: newNav,
        unitSupply: workingFund.unitSupply,
      });

      await updateFundNav(db, workingFund._id, {
        quotedNav: newNav,
        backingRatio: backing.backingRatio,
      });

      if (backing.shouldAutoPause) {
        await setFundStatus(db, workingFund._id, "paused", backing.pauseReason);
        result.errors.push(
          `Fund ${workingFund.slug} auto-paused: backing ratio ${backing.backingRatio.toFixed(4)}`
        );
      } else if (workingFund.status === "paused" && workingFund.pauseReason === "backing_ratio") {
        await setFundStatus(db, workingFund._id, "active");
      }

      result.navUpdates++;

      const refreshedFund = await getFundById(db, workingFund._id);
      if (!refreshedFund) continue;

      const bondPrincipalAfterNav = await sumFundBondHoldingsValueAnchor(
        db,
        refreshedFund,
        exchangeRates
      );
      if (queuedRedemptionLiabilityAnchor <= 0) {
        const bondDeploy = await deployBondReserveFromCash(
          db,
          refreshedFund,
          bondPrincipalAfterNav,
          {
            liquidityTargetEnabled: bondLiquidityEnabled,
          }
        );
        if (bondDeploy.deployedAnchor > 0) {
          result.bondDeployments++;
        }
      }

      navReadyFundIds.push(workingFund._id);
      result.fundsProcessed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${fund.slug}: ${message}`);
    }
  }

  mark("pass1-nav");
  // Pass 2: recompute target weights before float absorption so buys use the
  // current basket. Runs every financial day (24 turns) or on first init.
  funds = (await listActiveFunds(db)).filter(
    (fund) =>
      navReadyFundIds.some((id) => id.toString() === fund._id.toString()) &&
      !queuedLiabilityByFundId.has(fund._id.toString())
  );
  const rebalancedFundIds = new Set<string>();

  // A7 part 2: settle every petition whose deadline has passed BEFORE the
  // screen runs, so a waiver granted this turn is honoured by this turn's
  // rebalance rather than sitting inert until the next one.
  try {
    await resolveDueListingPetitions(db, currentTurn);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Listing petitions: ${message}`);
  }
  const waivedIds = await loadActiveWaiverIds(db, currentTurn);

  for (const fund of funds) {
    // Bond funds hold no equities: nothing to select or rebalance here.
    if (fund.kind === "bond") continue;
    if (!shouldRebalanceIndexFundConstituents(currentTurn, fund.targetConstituents.length)) {
      continue;
    }

    try {
      const rebalanced = await rebalanceConstituents(
        db,
        fund,
        candidateCorps,
        exchangeRates,
        currentTurn,
        waivedIds
      );
      if (rebalanced) {
        result.rebalances++;
        rebalancedFundIds.add(fund._id.toString());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${fund.slug} rebalance: ${message}`);
    }
  }

  mark("pass2-targetWeights+absorb");
  // Pass 3: two-sided rebalance toward target weights (sell overweight, buy underweight).
  // This only runs after target weights are recomputed; otherwise funds can churn
  // the same holdings every turn and repeatedly hit short-window order flow.
  funds = (await listActiveFunds(db)).filter(
    (fund) =>
      navReadyFundIds.some((id) => id.toString() === fund._id.toString()) &&
      !queuedLiabilityByFundId.has(fund._id.toString())
  );
  const capRemainingByCorpId = new Map(absorptionRemainingByCorpId); // fresh per-pass copy
  if (rebalancedFundIds.size > 0) {
    for (const fund of funds) {
      if (!rebalancedFundIds.has(fund._id.toString())) continue;
      try {
        const r = await rebalanceFundToTarget(
          db,
          fund,
          candidateCorps,
          exchangeRates,
          capRemainingByCorpId,
          currentTurn
        );
        result.floatPurchases += r.buys;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Fund ${fund.slug} rebalance: ${message}`);
      }
    }
  }

  mark("pass3-rebalance");
  // Pass 3b: cross-fund rebalancing market. Runs on the daily rebalance cadence
  // (when Pass 2 moves target weights), over NAV-ready funds only, so overweight
  // funds can sell directly to underweight fund buyers.
  if (shouldRunCrossFundRebalancing(currentTurn)) {
    try {
      const rebalFunds = (await listActiveFunds(db)).filter(
        (fund) =>
          fund.kind !== "bond" &&
          navReadyFundIds.some((id) => id.toString() === fund._id.toString()) &&
          !queuedLiabilityByFundId.has(fund._id.toString())
      );
      const bondPrincipalByFundId = new Map<string, number>();
      for (const fund of rebalFunds) {
        const bondPrincipal = await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates);
        bondPrincipalByFundId.set(fund._id.toString(), bondPrincipal);
      }

      const crossPlans = planFundCrossRebalancing({
        funds: rebalFunds,
        corps: candidateCorps,
        exchangeRates,
        bondPrincipalByFundId,
      });

      if (crossPlans.length > 0) {
        const crossResult: CrossRebalanceResult = await executeFundCrossRebalancing(
          db,
          crossPlans,
          currentTurn
        );
        result.crossFundTransfers = crossResult.transfers;
        if (crossResult.errors.length > 0) {
          result.errors.push(...crossResult.errors);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Cross-fund rebalancing: ${message}`);
    }
  }

  mark("pass3b-crossFund");
  // Pass 3c: pay redemptions and snapshot after cross-fund market settles.
  funds = (
    await Promise.all(redemptionServiceFundIds.map((fundId) => getFundById(db, fundId)))
  ).filter((fund): fund is IndexFund => fund !== null);
  for (const fund of funds) {
    try {
      const refreshedFund = (await getFundById(db, fund._id)) ?? fund;

      const paidRedemptions = await processQueuedRedemptions(
        db,
        refreshedFund,
        forexEnabled,
        currentTurn
      );
      result.redemptionsPaid += paidRedemptions;

      if (currentTurn > 0) {
        const finalFund = await getFundById(db, fund._id);
        if (finalFund) {
          const holdingValue = computeHoldingsValueAnchor(finalFund);
          await insertFundSnapshot(db, {
            fundId: finalFund._id,
            turn: currentTurn,
            quotedNav: finalFund.quotedNav,
            unitSupply: finalFund.unitSupply,
            cashAnchor: finalFund.cashAnchor,
            totalHoldingsValueAnchor: holdingValue,
            backingRatio: finalFund.backingRatio ?? 1,
            targetConstituents: finalFund.targetConstituents,
            createdAt: new Date(),
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${fund.slug}: ${message}`);
    }
  }

  mark("pass3c-redemptions+snapshot");
  // Step 6: NPP fund investments (GDP-proportional budget allocation).
  // Throttled to every NPP_FUND_INVESTMENT_INTERVAL turns — the biggest
  // per-turn write-volume phase — investing that many turns' worth at once so
  // net investment is unchanged (see processNPPFundInvestments's budget-
  // multiplier). Turn <= 0 (ad-hoc callers/tests) always runs at multiplier 1.
  const { processNPPFundInvestments, NPP_FUND_INVESTMENT_INTERVAL } =
    await import("@/lib/indexFunds/nppInvesting");
  const runNppInvesting = currentTurn <= 0 || currentTurn % NPP_FUND_INVESTMENT_INTERVAL === 0;
  if (runNppInvesting) {
    try {
      const nppResult = await processNPPFundInvestments(db, {
        currentTurn,
        budgetMultiplier: currentTurn > 0 ? NPP_FUND_INVESTMENT_INTERVAL : 1,
      });
      result.nppsProcessed = nppResult.nppsProcessed;
      result.nppInvested = nppResult.totalInvested;
      if (nppResult.errors.length > 0) {
        result.errors.push(...nppResult.errors);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`NPP investing: ${message}`);
    }
  }
  mark("step6-nppInvesting");

  // Step 7 (A5): sponsored funds. Fees are charged AFTER NAV has been remarked
  // this pass, so AUM is the current value rather than last turn's. Wind-downs
  // run last because completing one deletes the fund from every earlier pass's
  // working set.
  try {
    const { chargeSponsorExpenseFees } = await import("@/lib/indexFunds/sponsorship/expenseFees");
    const activeFunds = await listActiveFunds(db);
    const fees = await chargeSponsorExpenseFees(db, activeFunds, currentTurn);
    result.expenseFeesCharged = fees.fundsCharged;
    result.expenseFeeAnchor = fees.totalFeeAnchor;
  } catch (err) {
    result.errors.push(`Expense fees: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { advanceWindDowns } = await import("@/lib/indexFunds/sponsorship/windUp");
    const windDown = await advanceWindDowns(db, currentTurn);
    result.windDownsAdvanced = windDown.fundsProcessed;
    result.windDownsCompleted = windDown.fundsCompleted;
    if (windDown.errors.length > 0) result.errors.push(...windDown.errors);
  } catch (err) {
    result.errors.push(`Wind-up: ${err instanceof Error ? err.message : String(err)}`);
  }
  mark("step7-sponsorship");

  // Step 8: refresh bounded executable equity quotes after every other fund
  // mutation has settled. Disabling the gate cancels and refunds prior bids in
  // the same pass, providing an immediate rollback path.
  try {
    const quoteFunds = (await listActiveFunds(db)).filter(
      (fund) => !queuedLiabilityByFundId.has(fund._id.toString())
    );
    const fxByCurrency = new Map<CurrencyCode, number>(
      Object.entries(exchangeRates)
        .filter(([, rate]) => typeof rate === "number" && rate > 0)
        .map(([code, rate]) => [code as CurrencyCode, rate as number])
    );
    const quoteListings = candidateCorps.flatMap((corp) => {
      const referencePriceLocal = resolveShareExecutionPrice(corp);
      if (!Number.isFinite(referencePriceLocal) || referencePriceLocal <= 0) return [];
      const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
      const referencePriceAnchor = corpLiquidCapitalToAnchor(referencePriceLocal, corp, fxRate);
      if (!Number.isFinite(referencePriceAnchor) || referencePriceAnchor <= 0) return [];
      return [
        {
          corporationId: corp._id,
          referencePriceLocal,
          referencePriceAnchor,
          totalShares: corp.totalShares,
          fxRate,
          type: corp.type,
          secondaryType: corp.secondaryType,
          corporation: corp,
        },
      ];
    });
    const liquidity = await refreshEquityLiquidityFacility({
      db,
      turn: currentTurn,
      enabled: equityLiquidityEnabled,
      funds: quoteFunds,
      listings: quoteListings,
      totalListings: candidateCorps.length,
    });
    result.equityLiquidityQuotePairs = liquidity.quotePairsPlaced;
    result.equityLiquidityDepthAnchor = liquidity.bidDepthAnchor + liquidity.askDepthAnchor;
  } catch (err) {
    result.errors.push(`Equity liquidity: ${err instanceof Error ? err.message : String(err)}`);
  }
  mark("step8-equityLiquidity");

  if (timingOn) {
    const total = passTimings.reduce((s, [, ms]) => s + ms, 0);
    console.log(`[indexfund-timing] total=${total}ms ${JSON.stringify(passTimings)}`);
  }

  return result;
}

export { INDEX_FUNDS_DISABLED_MESSAGE };
