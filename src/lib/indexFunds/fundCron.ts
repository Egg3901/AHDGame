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

import { withBondPoolLedgerSnapshot } from "@/lib/bonds/marketPoolLedger";
import { recoverAllQueuedPayouts } from "./queuedPayoutSettlement";
import { recoverAllFundFloatSettlements } from "./fundFloatSettlement";
import { loadFloatAuditContext, type FloatAuditContext } from "./fundFloatTradePlan";
import { executeFundShareBuys, type FundShareBuyBatch } from "./fundFloatBuyExecution";
export { executeFundShareBuy, type FundShareBuyBatch } from "./fundFloatBuyExecution";
import { processQueuedRedemptions } from "./processQueuedRedemptions";
export { processQueuedRedemptions } from "./processQueuedRedemptions";
import { assertTransactionSupportAtBoot } from "@/lib/db/transactionSupport";
import { substepMarker } from "@/lib/observability/phaseSubsteps";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Corporation,
  ExchangeRate,
  GameConfig,
  IndexFund,
  IndexFundTargetConstituent,
} from "@/lib/db/types";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import {
  getFundById,
  listFundsByIds,
  listActiveFunds,
  listServiceableFunds,
  updateFundNav,
  updateFundConstituents,
  updateFundHoldings,
  insertFundSnapshotsBulk,
  setFundStatus,
  insertFundTransactionsBulk,
  insertFundTransaction,
} from "@/lib/indexFunds/fundQueries";
import { calculateBackingRatio } from "@/lib/indexFunds/unitAccounting";
import {
  buildIndexFundTargetConstituents,
  type IndexFundCandidate,
} from "@/lib/indexFunds/constituents";
import { describeFailure } from "./listingStandards";
import { loadActiveWaiverIds, resolveDueListingPetitions } from "./petitions/service";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import {
  sellFundHoldingsForRedemptionCash,
  sellFundHoldingShares,
} from "@/lib/indexFunds/fundRedemptionLiquidity";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { recomputeNav, refreshFundNavAfterBondDeployment, restoreFundCashBuffer } from "./fundNav";
export { recomputeNav, refreshFundNavAfterBondDeployment, restoreFundCashBuffer } from "./fundNav";
import { deployBondReserveFromCash } from "@/lib/indexFunds/fundBondReserve";
import {
  domesticCoverageEnabled,
  ensureDomesticSovereignBondFunds,
} from "@/lib/indexFunds/domesticSovereignCoverage/ensure";
import {
  sumFundBondHoldingsByFundId,
  sumFundBondHoldingsValueAnchor,
} from "@/lib/bonds/fundBondHoldings";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
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
import { writeOffDeadConstituentHoldings } from "@/lib/indexFunds/fundHoldingWriteOff";
import { loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { TURNS_PER_DAY, MS_PER_TURN } from "@/lib/constants/turnTime";
import { placeFundShareBuyOrder, cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";
import {
  fundBidLimitPriceLocal,
  INDEX_FUND_BID_MAX_OPEN_TURNS,
} from "@/lib/indexFunds/fundBidPolicy";
import { fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import { type CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundTransaction } from "@/lib/db/types";
import type { ShareOrder } from "@/lib/db/types";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionUnitsByFundId,
} from "@/lib/indexFunds/fundValuation";
import { refreshEquityLiquidityFacility } from "@/lib/indexFunds/equityLiquidityFacility";
import { loadEquityPoolsByCurrency } from "@/lib/equities/marketPool";
import { boundedParallelMap } from "@/lib/indexFunds/boundedParallelMap";

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
  /** #1001: domestic sovereign-bond funds ensured this pass (gated, else 0). */
  domesticCoverageFundsEnsured: number;
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
  /** Holdings in dissolved corporations removed at zero this pass. */
  deadHoldingsWrittenOff: number;
  deadHoldingsWrittenOffAnchor: number;
  /** Flagged holdings still unsold whose corporation is alive (illiquid, not dead). */
  unsellableHoldings: number;
  errors: string[];
};

/** What one fund's constituent rebalance did, for turn telemetry. */
export type RebalanceOutcome = {
  rebalanced: boolean;
  writtenOffCount: number;
  writtenOffValueAnchor: number;
  unsellableCount: number;
};

/**
 * NAV preparation only touches the current fund document. Eight concurrent
 * workers hide independent Mongo latency without racing the later bond and
 * equity allocation passes, whose ordering is economically significant.
 */
export const INDEX_FUND_NAV_CONCURRENCY = 8;

const NO_REBALANCE: RebalanceOutcome = {
  rebalanced: false,
  writtenOffCount: 0,
  writtenOffValueAnchor: 0,
  unsellableCount: 0,
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
  mediaDiscriminator: 1,
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

// ── Pass 3 helper: Absorb public float ────────────────────────────────

/**
 * Execute a single index-fund share purchase from the public float.
 *
 * Debits `shares × sharePriceAnchor` from the fund's `cashAnchor`, credits the
 * shares to the fund, applies the issuer-side float credit, updates holdings,
 * freezes the original cash, custody and receipts before settlement. Protected
 * target receipts allow interrupted standalone and replica-set calls to resume.
 * Guarded refusal returns ok=false only after its proven effects are reversed.
 */
/** Shared pool and audit inputs for a pass that executes many buys. */
// ── Pass 3: Two-sided drift rebalance ─────────────────────────────────────────

export async function rebalanceFundToTarget(
  db: Db,
  fund: IndexFund,
  corps: EligibleCorpRow[],
  exchangeRates: Partial<Record<string, number>>,
  capRemainingByCorpId: Map<string, number>,
  currentTurn: number,
  /** Pass-level reads shared by every fund, loaded once instead of once per fund. */
  shared?: { bondPrincipalAnchor?: number; audit?: FloatAuditContext }
): Promise<{ buys: number; sells: number; bidsPlaced: number; bidsCancelled: number }> {
  const bondPrincipalAnchor =
    shared?.bondPrincipalAnchor ?? (await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates));
  const plan = planFundTargetRebalance({
    fund,
    corps,
    exchangeRates,
    bondPrincipalAnchor,
    capRemainingByCorpId,
  });

  let sells = 0;
  const audit =
    plan.sells.length + plan.buys.length > 0
      ? (shared?.audit ?? (await loadFloatAuditContext(db)))
      : undefined;
  const pools =
    plan.sells.length + plan.buys.length > 0 ? await loadEquityPoolsByCurrency(db) : undefined;
  const sellInputs =
    plan.sells.length > 0
      ? await Promise.all([loadFxRatesByCurrency(db), getCurrentTurn(db)])
      : undefined;
  for (const leg of plan.sells) {
    const refreshed = (await getFundById(db, fund._id)) ?? fund;
    const res = await sellFundHoldingShares(db, refreshed, leg.corporationId, leg.shares, {
      note: "Rebalance: trim overweight",
      fxByCurrency: sellInputs?.[0],
      turn: sellInputs?.[1],
      audit,
      pools,
    });
    if (res.sharesSold > 0) sells++;
  }

  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));
  // Quotes share pool and audit inputs. The fund's buys settle as one recoverable
  // batch (see executeFundShareBuys); each trade keeps its own durable receipts.
  const buyFund = sells > 0 ? ((await getFundById(db, fund._id)) ?? fund) : fund;
  const buyBatch: FundShareBuyBatch = { pools, audit };
  const buyLegs = plan.buys.flatMap((leg) => {
    const corp = corpMap.get(leg.corporationId.toString());
    return corp ? [{ corp, shares: leg.shares, referencePriceAnchor: leg.sharePriceAnchor }] : [];
  });
  const { buys } = await executeFundShareBuys(db, buyFund, buyLegs, currentTurn, buyBatch);
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
  const cancelledBidIds = new Set<string>();
  for (const order of allOpenFundBids) {
    const ageInTurns = Math.floor((now - order.createdAt.getTime()) / MS_PER_TURN);
    const corpIdStr = order.corporationId.toString();
    const isOffBasket = !inBasketIds.has(corpIdStr);
    const isStale = ageInTurns >= INDEX_FUND_BID_MAX_OPEN_TURNS;

    if (isOffBasket || isStale) {
      try {
        await cancelFundShareOrder(db, order._id, currentTurn);
        cancelledBidIds.add(order._id.toString());
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

  // Corps that still have an open bid after the cancellations above (to avoid
  // stacking). Nothing else touches this fund's own bids inside the pass, so
  // the first read minus what was cancelled is the second read.
  const openBidCorpIds = new Set(
    allOpenFundBids
      .filter((order) => !cancelledBidIds.has(order._id.toString()))
      .map((order) => order.corporationId.toString())
  );

  const bidTxSink: Omit<IndexFundTransaction, "_id">[] = [];
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

      // The order debits cashAnchor atomically against the live document, so
      // the fund re-read this loop used to do per bid was never consulted.
      const result = await placeFundShareBuyOrder(db, {
        fund,
        corp,
        shares: leg.shares,
        limitPriceLocal,
        fxRate,
        turn: currentTurn,
        txSink: bidTxSink,
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
  await insertFundTransactionsBulk(db, bidTxSink);

  return { buys, sells, bidsPlaced, bidsCancelled };
}

// ── Pass 2: Rebalance constituents (financial-day boundaries) ──────────

export async function rebalanceConstituents(
  db: Db,
  fund: IndexFund,
  corps: IndexFundCandidate[],
  exchangeRates: Partial<Record<string, number>>,
  _currentTurn: number,
  /** A7 part 2: corporations holding a committee waiver this turn. */
  waivedIds?: Set<string>,
  /** When given, the rebalance record is appended here for one bulk insert by the caller. */
  txSink?: Omit<IndexFundTransaction, "_id">[]
): Promise<RebalanceOutcome> {
  const removed = findRemovedConstituentHoldings(fund, corps);
  let writeOff = { writtenOffCount: 0, writtenOffValueAnchor: 0, unsellableCount: 0 };
  if (removed.length > 0) {
    const removalValue = computeHoldingsValueAnchor({ holdings: removed });
    if (removalValue > 0) {
      await sellFundHoldingsForRedemptionCash(db, fund, removalValue, {
        note: "Constituent removal",
        corporationIds: removed.map((h) => h.corporationId),
      });
    }

    fund = (await getFundById(db, fund._id)) ?? fund;

    // The sale cannot touch a holding whose corporation is gone: there is no
    // document to price and no counterparty to sell to, so it returns quietly
    // and the position stays in the book at its last mark. Left alone it is
    // re-flagged and re-refused every rebalance forever, inflating NAV by
    // exactly the value of every corp that has ever died under this fund.
    const wo = await writeOffDeadConstituentHoldings(db, fund, removed);
    writeOff = wo;
    if (wo.writtenOffCount > 0) fund = (await getFundById(db, fund._id)) ?? fund;
  }

  const definition = getAllFundDefinitions().find((d) => d.slug === fund.slug);
  if (!definition) return { ...NO_REBALANCE, ...writeOff };

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

  const rebalanceRecord: Omit<IndexFundTransaction, "_id"> = {
    fundId: fund._id,
    kind: "rebalance",
    navAnchor: fund.quotedNav,
    amountAnchor: 0,
    note: `Rebalanced: ${targetConstituents.length} constituents`,
    createdAt: new Date(),
  };
  if (txSink) txSink.push(rebalanceRecord);
  else await insertFundTransaction(db, rebalanceRecord);

  return {
    rebalanced: true,
    writtenOffCount: writeOff.writtenOffCount,
    writtenOffValueAnchor: writeOff.writtenOffValueAnchor,
    unsellableCount: writeOff.unsellableCount,
  };
}

// ── Pass 3c: Process queued redemptions ───────────────────────────────

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
  return withBondPoolLedgerSnapshot(db, options?.currentTurn, () => runFundCron(db, options));
}

async function runFundCron(db: Db, options?: { currentTurn?: number }): Promise<FundCronResult> {
  const result: FundCronResult = {
    fundsProcessed: 0,
    navUpdates: 0,
    floatPurchases: 0,
    rebalances: 0,
    crossFundTransfers: 0,
    redemptionsPaid: 0,
    redemptionsQueued: 0,
    bondDeployments: 0,
    domesticCoverageFundsEnsured: 0,
    nppsProcessed: 0,
    nppInvested: 0,
    expenseFeesCharged: 0,
    expenseFeeAnchor: 0,
    windDownsAdvanced: 0,
    windDownsCompleted: 0,
    equityLiquidityQuotePairs: 0,
    equityLiquidityDepthAnchor: 0,
    deadHoldingsWrittenOff: 0,
    deadHoldingsWrittenOffAnchor: 0,
    unsellableHoldings: 0,
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

  try {
    await recoverAllFundFloatSettlements(db);
    result.redemptionsPaid += (await recoverAllQueuedPayouts(db, currentTurn)).recovered;
  } catch (error) {
    result.errors.push(
      `Fund settlement recovery: ${error instanceof Error ? error.message : String(error)}`
    );
    // Do not reprice or trade against a fund whose original payout is incomplete.
    return result;
  }

  // Env-gated pass-level timing (SIM_CORP_TIMING=1), same mechanism as the
  // corporation/NPP turn phases — zero-cost when off.
  const timingOn = process.env.SIM_CORP_TIMING === "1";
  const passTimings: Array<[string, number]> = [];
  let _tPrev = timingOn ? Date.now() : 0;
  // Always feeds the persisted phase sub-steps (#2689).
  const steps = substepMarker();
  const mark = (label: string): void => {
    steps.mark(label);
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
        domesticSovereignBondCoverageEnabled: 1,
        equityLiquidityFacilityEnabled: 1,
      },
    }
  );
  const bondLiquidityEnabled = liquidityConfig?.indexFundBondLiquidityEnabled === true;
  // #1001 domestic coverage: off (or unset) skips the ensure entirely, so the
  // pass is unchanged. On, missing home-sovereign funds are seeded before the
  // serviceable-fund read so they deploy real cash into home paper this turn.
  if (domesticCoverageEnabled(liquidityConfig)) {
    try {
      const coverage = await ensureDomesticSovereignBondFunds(db, { enabled: true });
      result.domesticCoverageFundsEnsured += coverage.ensured.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Domestic coverage ensure: ${message}`);
    }
  }
  const equityLiquidityEnabled = liquidityConfig?.equityLiquidityFacilityEnabled === true;
  const forexEnabled = await isForexEnabled();
  const exchangeRates = await loadExchangeRates(db);
  const candidateCorps = await loadIndexFundCandidateCorporations(db);
  const floatCorps = candidateCorps.filter((corp) => (corp.publicFloat ?? 0) > 0);
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
  // bid escrow and counts queued redemption units as the claims they are.
  const fundIds = funds.map((fund) => fund._id);
  const openOrdersEscrowByFundId = await loadOpenOrdersEscrowByFundId(db, fundIds);
  const queuedUnitsByFundId = await loadQueuedRedemptionUnitsByFundId(db, fundIds);
  const initialBondPrincipalByFundId = await sumFundBondHoldingsByFundId(db, funds, exchangeRates);
  // #992 tranche 6: one thresholds read for every bond-reserve purchase row
  // this turn; threaded through each deploy so N funds share it.
  const [bondDeployThresholds, bondDeployTurnLengthMinutes, bondSettleInTransaction] =
    await Promise.all([
      loadTxThresholds(db),
      loadTurnLengthMinutes(db),
      // A replica set settles each fund's bond pass in one transaction; a
      // standalone server (singleplayer, sandboxes) keeps per-purchase writes.
      assertTransactionSupportAtBoot().catch(() => false),
    ]);

  // Pass 1a: mark holdings and recompute NAV. Each task only writes its own
  // fund document, so bounded concurrency is safe and removes the serial
  // network wait across dozens of funds. Keep bond deployment in Pass 1b:
  // funds compete for shared public float there, so its ordering is part of
  // the economic result and must remain deterministic.
  const navReadyFundIds: IndexFund["_id"][] = [];
  type NavPreparation =
    | {
        kind: "ready";
        fund: IndexFund;
        bondPrincipalAnchor: number;
        queuedUnits: number;
        warning?: string;
      }
    | { kind: "collapsed"; error: string }
    | { kind: "error"; error: string };
  const navPreparations = await boundedParallelMap(
    funds,
    INDEX_FUND_NAV_CONCURRENCY,
    async (fund): Promise<NavPreparation> => {
      try {
        const workingFund = await applyMarkToMarketIfNeeded(
          db,
          fund,
          candidateCorps,
          exchangeRates
        );

        const bondPrincipalAnchor =
          initialBondPrincipalByFundId.get(workingFund._id.toString()) ?? 0;
        const openOrdersEscrowAnchor =
          openOrdersEscrowByFundId.get(workingFund._id.toString()) ?? 0;
        const queuedRedemptionUnits = queuedUnitsByFundId.get(workingFund._id.toString()) ?? 0;

        const newNav = recomputeNav(workingFund, {
          bondPrincipalAnchor,
          openOrdersEscrowAnchor,
          queuedRedemptionUnits,
        });

        if (newNav === null || !Number.isFinite(newNav) || newNav <= 0) {
          // Genuinely no assets left. Freeze so no new subscriptions deepen the
          // hole. With queued units in the denominator this can only fire when
          // the fund really is empty, not merely when a large redemption is
          // outstanding against a falling book.
          const holdingsValue = computeHoldingsValueAnchor(workingFund);
          const actualBacking = Math.max(
            0,
            workingFund.cashAnchor + holdingsValue + bondPrincipalAnchor + openOrdersEscrowAnchor
          );
          const quotedLiability =
            workingFund.quotedNav * (workingFund.unitSupply + queuedRedemptionUnits);
          await updateFundNav(db, workingFund._id, {
            quotedNav: workingFund.quotedNav,
            backingRatio: quotedLiability > 0 ? actualBacking / quotedLiability : 0,
          });
          await setFundStatus(db, workingFund._id, "paused", "backing_ratio");
          return {
            kind: "collapsed",
            error: `Fund ${workingFund.slug} auto-paused: backing collapsed (assets=${actualBacking.toFixed(0)}, liability=${quotedLiability.toFixed(0)})`,
          };
        }

        const holdingsValue = computeHoldingsValueAnchor(workingFund);
        const backing = calculateBackingRatio({
          cashAnchor: workingFund.cashAnchor,
          holdingsValueAnchor: holdingsValue,
          bondPrincipalAnchor,
          openOrdersEscrowAnchor,
          queuedRedemptionUnits,
          quotedNav: newNav,
          unitSupply: workingFund.unitSupply,
        });

        await updateFundNav(db, workingFund._id, {
          quotedNav: newNav,
          backingRatio: backing.backingRatio,
        });

        if (backing.shouldAutoPause) {
          await setFundStatus(db, workingFund._id, "paused", backing.pauseReason);
        } else if (workingFund.status === "paused" && workingFund.pauseReason === "backing_ratio") {
          await setFundStatus(db, workingFund._id, "active");
        }

        // NAV persistence only changes fields already known in this pass. Keep
        // the in-memory fund in sync instead of reading the full document back,
        // and reuse the bond-principal snapshot loaded for every fund above.
        const refreshedFund: IndexFund = {
          ...workingFund,
          quotedNav: newNav,
          backingRatio: backing.backingRatio,
        };
        return {
          kind: "ready",
          fund: refreshedFund,
          bondPrincipalAnchor,
          queuedUnits: queuedRedemptionUnits,
          ...(backing.shouldAutoPause
            ? {
                warning: `Fund ${workingFund.slug} auto-paused: backing ratio ${backing.backingRatio.toFixed(4)}`,
              }
            : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "error", error: `Fund ${fund.slug}: ${message}` };
      }
    }
  );
  mark("pass1a-nav");

  // Pass 1b: deploy bond reserves in the original stable fund order.
  for (const preparation of navPreparations) {
    if (preparation.kind === "error") {
      result.errors.push(preparation.error);
      continue;
    }
    result.fundsProcessed++;
    if (preparation.kind === "collapsed") {
      result.errors.push(preparation.error);
      continue;
    }
    result.navUpdates++;
    if (preparation.warning) result.errors.push(preparation.warning);
    try {
      if (preparation.queuedUnits <= 0) {
        const bondDeploy = await deployBondReserveFromCash(
          db,
          preparation.fund,
          preparation.bondPrincipalAnchor,
          {
            liquidityTargetEnabled: bondLiquidityEnabled,
            turn: currentTurn,
            thresholds: bondDeployThresholds,
            turnLengthMinutes: bondDeployTurnLengthMinutes,
            settleInTransaction: bondSettleInTransaction,
          }
        );
        if (bondDeploy.deployedAnchor > 0) {
          result.bondDeployments++;
          await refreshFundNavAfterBondDeployment(
            db,
            preparation.fund._id,
            preparation.bondPrincipalAnchor + bondDeploy.markedValueAnchor,
            openOrdersEscrowByFundId.get(preparation.fund._id.toString()) ?? 0
          );
        }
      }
      navReadyFundIds.push(preparation.fund._id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${preparation.fund.slug}: ${message}`);
      // Earlier purchases can settle before a later issue or receipt fails.
      // Re-read the book and cash so the pre-deployment quote is not left live.
      try {
        const settledBondValue = await sumFundBondHoldingsValueAnchor(
          db,
          preparation.fund,
          exchangeRates
        );
        await refreshFundNavAfterBondDeployment(
          db,
          preparation.fund._id,
          settledBondValue,
          openOrdersEscrowByFundId.get(preparation.fund._id.toString()) ?? 0
        );
      } catch (refreshError) {
        result.errors.push(
          `Fund ${preparation.fund.slug} post-bond NAV: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`
        );
      }
    }
  }

  mark("pass1b-bonds");
  // Pass 2: recompute target weights before float absorption so buys use the
  // current basket. Runs every financial day (24 turns) or on first init.
  funds = (await listActiveFunds(db)).filter(
    (fund) =>
      navReadyFundIds.some((id) => id.toString() === fund._id.toString()) &&
      !queuedUnitsByFundId.has(fund._id.toString())
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

  // One bulk insert for every fund's rebalance record instead of one per fund.
  const rebalanceRecords: Omit<IndexFundTransaction, "_id">[] = [];
  for (const fund of funds) {
    // Bond funds hold no equities: nothing to select or rebalance here.
    if (fund.kind === "bond") continue;
    if (!shouldRebalanceIndexFundConstituents(currentTurn, fund.targetConstituents.length)) {
      continue;
    }

    try {
      const outcome = await rebalanceConstituents(
        db,
        fund,
        candidateCorps,
        exchangeRates,
        currentTurn,
        waivedIds,
        rebalanceRecords
      );
      if (outcome.rebalanced) {
        result.rebalances++;
        rebalancedFundIds.add(fund._id.toString());
      }
      result.deadHoldingsWrittenOff += outcome.writtenOffCount;
      result.deadHoldingsWrittenOffAnchor += outcome.writtenOffValueAnchor;
      result.unsellableHoldings += outcome.unsellableCount;
      if (outcome.writtenOffCount > 0) {
        // Loud on purpose. A write-off is backing leaving the fund, and holders
        // see it as a NAV drop with no sale behind it.
        result.errors.push(
          `Fund ${fund.slug}: wrote off ${outcome.writtenOffCount} holding(s) in ` +
            `dissolved corporations, ${Math.round(outcome.writtenOffValueAnchor)} anchor removed`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${fund.slug} rebalance: ${message}`);
    }
  }

  try {
    await insertFundTransactionsBulk(db, rebalanceRecords);
  } catch (err) {
    result.errors.push(`Rebalance records: ${err instanceof Error ? err.message : String(err)}`);
  }

  mark("pass2-targetWeights+absorb");
  // Pass 3: two-sided rebalance toward target weights (sell overweight, buy underweight).
  // This only runs after target weights are recomputed; otherwise funds can churn
  // the same holdings every turn and repeatedly hit short-window order flow.
  funds = (await listActiveFunds(db)).filter(
    (fund) =>
      navReadyFundIds.some((id) => id.toString() === fund._id.toString()) &&
      !queuedUnitsByFundId.has(fund._id.toString())
  );
  const capRemainingByCorpId = new Map(absorptionRemainingByCorpId); // fresh per-pass copy
  if (rebalancedFundIds.size > 0) {
    const rebalancing = funds.filter((fund) => rebalancedFundIds.has(fund._id.toString()));
    // One bond scan and one audit-context load for the whole pass. Float trades
    // settle equities only and the audit inputs are fixed for the turn, so
    // neither can change between funds.
    let bondPrincipalByFundId: Map<string, number> | undefined;
    let sharedAudit: FloatAuditContext | undefined;
    try {
      [bondPrincipalByFundId, sharedAudit] = await Promise.all([
        sumFundBondHoldingsByFundId(db, rebalancing, exchangeRates),
        loadFloatAuditContext(db),
      ]);
    } catch (err) {
      // Each fund falls back to its own reads, so a failure here changes nothing but cost.
      result.errors.push(
        `Rebalance shared reads: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    for (const fund of rebalancing) {
      try {
        const r = await rebalanceFundToTarget(
          db,
          fund,
          candidateCorps,
          exchangeRates,
          capRemainingByCorpId,
          currentTurn,
          {
            audit: sharedAudit,
            bondPrincipalAnchor: bondPrincipalByFundId?.get(fund._id.toString()),
          }
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
          !queuedUnitsByFundId.has(fund._id.toString())
      );
      const bondPrincipalByFundId = await sumFundBondHoldingsByFundId(
        db,
        rebalFunds,
        exchangeRates
      );

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
  funds = await listFundsByIds(db, redemptionServiceFundIds);
  // Snapshots are upserts keyed by (fund, turn); one bulk write replaces one per fund.
  const fundSnapshots: Parameters<typeof insertFundSnapshotsBulk>[1] = [];
  for (const fund of funds) {
    try {
      // `funds` was just re-read above and nothing writes between; the old
      // per-fund re-read here was a duplicate round trip.
      const refreshedFund = fund;

      const hasQueuedRedemptions = queuedUnitsByFundId.has(fund._id.toString());
      const paidRedemptions = hasQueuedRedemptions
        ? await processQueuedRedemptions(db, refreshedFund, forexEnabled, currentTurn, true)
        : 0;
      result.redemptionsPaid += paidRedemptions;

      if (currentTurn > 0) {
        // A fund with no queued units cannot have been mutated by the
        // redemption processor, which is skipped above. Snapshot the fresh
        // batch-loaded document directly; only redemption-bearing funds need
        // a post-settlement reread.
        const finalFund = hasQueuedRedemptions ? await getFundById(db, fund._id) : refreshedFund;
        if (finalFund) {
          const holdingValue = computeHoldingsValueAnchor(finalFund);
          fundSnapshots.push({
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

  try {
    await insertFundSnapshotsBulk(db, fundSnapshots);
  } catch (err) {
    result.errors.push(`Fund snapshots: ${err instanceof Error ? err.message : String(err)}`);
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
    const activeQuoteFunds = await listActiveFunds(db);
    const quoteBondValueByFundId = await sumFundBondHoldingsByFundId(
      db,
      activeQuoteFunds,
      exchangeRates
    );
    const quoteFunds: IndexFund[] = [];
    const currentQueuedUnits = await loadQueuedRedemptionUnitsByFundId(
      db,
      activeQuoteFunds.map((fund) => fund._id)
    );
    for (const fund of activeQuoteFunds) {
      const restored = await restoreFundCashBuffer(
        db,
        fund,
        quoteBondValueByFundId.get(String(fund._id)) ?? 0,
        exchangeRates,
        currentTurn
      );
      quoteBondValueByFundId.set(String(fund._id), restored.bondPrincipalAnchor);
      if (!currentQueuedUnits.has(String(fund._id))) quoteFunds.push(restored.fund);
    }
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
      bondValueByFundId: quoteBondValueByFundId,
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
