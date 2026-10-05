import { loadFloatAuditContext, type FloatAuditContext } from "./fundFloatTradePlan";
import { executeFundShareBuys, type FundShareBuyBatch } from "./fundFloatBuyExecution";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Corporation,
  ExchangeRate,
  IndexFund,
  IndexFundTargetConstituent,
  IndexFundTransaction,
  ShareOrder,
} from "@/lib/db/types";
import {
  getFundById,
  updateFundConstituents,
  updateFundHoldings,
  insertFundTransactionsBulk,
  insertFundTransaction,
} from "@/lib/indexFunds/fundQueries";
import {
  buildIndexFundTargetConstituents,
  type IndexFundCandidate,
} from "@/lib/indexFunds/constituents";
import { describeFailure } from "./listingStandards";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import {
  sellFundHoldingsForRedemptionCash,
  sellFundHoldingShares,
} from "@/lib/indexFunds/fundRedemptionLiquidity";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import {
  holdingsNeedMarkToMarketRefresh,
  refreshFundHoldingsMarkToMarket,
} from "@/lib/indexFunds/fundHoldingsValuation";
import { planFundTargetRebalance } from "@/lib/indexFunds/fundTargetRebalance";
import { findRemovedConstituentHoldings } from "@/lib/indexFunds/fundConstituentLifecycle";
import { writeOffDeadConstituentHoldings } from "@/lib/indexFunds/fundHoldingWriteOff";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadFxRatesByCurrency, fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import { TURNS_PER_DAY, MS_PER_TURN } from "@/lib/constants/turnTime";
import { placeFundShareBuyOrder, cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";
import {
  fundBidLimitPriceLocal,
  INDEX_FUND_BID_MAX_OPEN_TURNS,
} from "@/lib/indexFunds/fundBidPolicy";
import { type CurrencyCode } from "@/lib/constants/currencies";
import { loadEquityPoolsByCurrency } from "@/lib/equities/marketPool";

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

export async function loadExchangeRates(db: Db): Promise<Partial<Record<string, number>>> {
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
export async function loadIndexFundCandidateCorporations(db: Db): Promise<EligibleCorpRow[]> {
  const corps = await db
    .collection<CorpRow>("corporations")
    .find(INDEX_FUND_CORP_QUERY)
    .project(INDEX_FUND_CORP_PROJECTION)
    .toArray();

  return corps.filter(
    (c) => Number.isFinite(c.sharePrice) && c.sharePrice > 0
  ) as EligibleCorpRow[];
}

export async function applyMarkToMarketIfNeeded(
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
