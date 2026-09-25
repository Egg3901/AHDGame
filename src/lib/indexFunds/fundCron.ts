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
import type { ClientSession, Db, UpdateFilter } from "mongodb";
import type {
  Corporation,
  ExchangeRate,
  GameConfig,
  IndexFund,
  IndexFundHolding,
  IndexFundRedemptionDebitMarker,
  IndexFundRedemptionQueueEntry,
  IndexFundRedemptionReceipt,
  IndexFundRedemptionStatus,
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
  listPendingRedemptions,
  insertFundTransaction,
  insertFundSnapshot,
  setFundStatus,
  FUND_REDEMPTION_QUEUE_COLLECTION,
  insertFundTransactionsBulk,
} from "@/lib/indexFunds/fundQueries";
import {
  INDEX_FUND_INITIAL_NAV,
  calculateBackingRatio,
  quoteCashOnlyRedemption,
  proRataRedemptionCashShare,
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
import {
  applyFloatBuyCredit,
  type FloatBuyCreditReceipt,
} from "@/lib/corporations/shareEscrowSettlement";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import {
  sellFundHoldingsForRedemptionCash,
  sellFundHoldingShares,
} from "@/lib/indexFunds/fundRedemptionLiquidity";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { deployBondReserveFromCash } from "@/lib/indexFunds/fundBondReserve";
import {
  domesticCoverageEnabled,
  ensureDomesticSovereignBondFunds,
} from "@/lib/indexFunds/domesticSovereignCoverage/ensure";
import {
  sumFundBondHoldingsByFundId,
  sumFundBondHoldingsValueAnchor,
} from "@/lib/bonds/fundBondHoldings";
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
import { writeOffDeadConstituentHoldings } from "@/lib/indexFunds/fundHoldingWriteOff";
import {
  redemptionEntryStatusAfterPayout,
  remainingRedemptionUnits,
} from "@/lib/indexFunds/fundRedemptionQueue";
import { logIndexFundRedeem, resolveIndexFundHolder } from "@/lib/indexFunds/fundTxLog";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { TURNS_PER_DAY, MS_PER_TURN } from "@/lib/constants/turnTime";
import { placeFundShareBuyOrder, cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";
import {
  fundBidLimitPriceLocal,
  INDEX_FUND_BID_MAX_OPEN_TURNS,
} from "@/lib/indexFunds/fundBidPolicy";
import { fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { EquityMarketPool, IndexFundTransaction } from "@/lib/db/types";
import type { ShareOrder } from "@/lib/db/types";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionUnitsByFundId,
} from "@/lib/indexFunds/fundValuation";
import { refreshEquityLiquidityFacility } from "@/lib/indexFunds/equityLiquidityFacility";
import {
  equityPoolCurrency,
  loadEquityPoolsByCurrency,
  loadEquityQuote,
} from "@/lib/equities/marketPool";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
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
  const result = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId },
      { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: new Date() } },
      options?.session ? { session: options.session } : undefined
    );
  if (result.matchedCount !== 1) {
    throw new Error("Failed to restore fund cash after public-float buy failure");
  }
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
    /**
     * Units queued for redemption whose supply was already burned. They belong
     * in the DENOMINATOR: a queued holder is still a holder with a pro-rata
     * claim, not a creditor owed a fixed sum. Subtracting a cash liability
     * struck at the NAV locked when the redemption was requested is what
     * drained GLB50 - assets fell, the liability did not, and the entire
     * decline was pushed onto the holders who stayed until NAV hit zero.
     */
    queuedRedemptionUnits?: number;
  }
): number | null {
  const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
  const bondPrincipalAnchor = options?.bondPrincipalAnchor ?? 0;
  const openOrdersEscrowAnchor = options?.openOrdersEscrowAnchor ?? 0;
  const queuedRedemptionUnits = Math.max(0, options?.queuedRedemptionUnits ?? 0);
  const totalBacking =
    fund.cashAnchor + holdingsValueAnchor + bondPrincipalAnchor + openOrdersEscrowAnchor;
  const totalUnits = fund.unitSupply + queuedRedemptionUnits;
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
/**
 * Shared state for a pass that executes many buys: the pool table read once,
 * and completed audit rows collected for one post-loop insert. Without it a
 * buy is self-contained and inserts its own audit row.
 */
export interface FundShareBuyBatch {
  /** Mutable: each credited buy advances the snapshot's cash so later quotes see it. */
  pools?: Map<CurrencyCode, EquityMarketPool>;
  /** Post-loop evidence for completed buys. The caller inserts the batch once. */
  txSink?: Omit<IndexFundTransaction, "_id">[];
  /** Fund-subject ledger rows collected per buy and flushed after the pass. */
  ledgerSink?: Parameters<typeof emitTxBulk>[1];
}

async function reverseFloatBuyCredit(
  db: Db,
  corp: EligibleCorpRow,
  amountLocal: number,
  pools?: Map<CurrencyCode, EquityMarketPool>,
  receipt?: FloatBuyCreditReceipt
): Promise<void> {
  const currency = equityPoolCurrency(corp);
  const snapshot = pools?.get(currency);
  if (receipt && receipt.issuerShares > 0) {
    if (receipt.poolCreditLocal > 0) {
      const poolRollback = await db
        .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
        .updateOne(
          { _id: currency, cashLocal: { $gte: receipt.poolCreditLocal } },
          {
            $inc: {
              cashLocal: -receipt.poolCreditLocal,
              "lifetime.purchasesIn": -receipt.poolCreditLocal,
            },
            $set: { updatedAt: new Date() },
          }
        );
      if (poolRollback.matchedCount !== 1)
        throw new Error("Failed to reverse equity-pool buy credit");
      if (snapshot)
        snapshot.cashLocal = Math.max(0, (snapshot.cashLocal ?? 0) - receipt.poolCreditLocal);
    }
    const issuerRollback = await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $inc: {
          "pendingShareIssuance.remainingShares": receipt.issuerShares,
          liquidCapital: -receipt.issuerCreditLocal,
          shareIssuanceProceeds: -receipt.issuerCreditLocal,
        },
        $set: { updatedAt: new Date() },
      }
    );
    if (issuerRollback.matchedCount !== 1) throw new Error("Failed to reverse IPO buy credit");
    return;
  }
  const poolExists = pools
    ? snapshot !== undefined
    : Boolean(
        await db
          .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
          .findOne({ _id: currency }, { projection: { _id: 1 } })
      );

  if (poolExists) {
    const amount = Math.round(amountLocal * 100) / 100;
    const result = await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
      { _id: currency, cashLocal: { $gte: amount } },
      {
        $inc: { cashLocal: -amount, "lifetime.purchasesIn": -amount },
        $set: { updatedAt: new Date() },
      }
    );
    if (result.matchedCount !== 1) throw new Error("Failed to reverse equity-pool buy credit");
    if (snapshot) snapshot.cashLocal = Math.max(0, (snapshot.cashLocal ?? 0) - amount);
    return;
  }

  const increment =
    getShareBuybackMode(corp) === "escrow"
      ? { shareEscrowBalance: -amountLocal }
      : { liquidCapital: -amountLocal, shareIssuanceProceeds: -amountLocal };
  const result = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corp._id }, { $inc: increment, $set: { updatedAt: new Date() } });
  if (result.matchedCount !== 1) throw new Error("Failed to reverse issuer buy credit");
}

async function reverseFundShareCredit(
  db: Db,
  corp: EligibleCorpRow,
  fundId: IndexFund["_id"],
  shares: number,
  orderFlowBuyValue: number,
  previous: { shares: number; avgCostPerShare?: number } | undefined
): Promise<void> {
  const expectedShares = (previous?.shares ?? 0) + shares;
  const update = (previous
    ? {
        $inc: {
          "shareholders.$.shares": -shares,
          publicFloat: shares,
          ...(orderFlowBuyValue > 0 ? { orderFlowWindowBuyValue: -orderFlowBuyValue } : {}),
        },
        $set: {
          ...(previous.avgCostPerShare !== undefined
            ? { "shareholders.$.avgCostPerShare": previous.avgCostPerShare }
            : {}),
          updatedAt: new Date(),
        },
        ...(previous.avgCostPerShare === undefined
          ? { $unset: { "shareholders.$.avgCostPerShare": "" } }
          : {}),
      }
    : {
        $pull: { shareholders: { fundId, shares: expectedShares } },
        $inc: {
          publicFloat: shares,
          ...(orderFlowBuyValue > 0 ? { orderFlowWindowBuyValue: -orderFlowBuyValue } : {}),
        },
        $set: { updatedAt: new Date() },
      }) as unknown as UpdateFilter<Corporation>;
  const result = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corp._id,
      shareholders: { $elemMatch: { fundId, shares: expectedShares } },
    },
    update
  );
  if (result.matchedCount !== 1) throw new Error("Failed to reverse fund share credit");
}

export async function executeFundShareBuy(
  db: Db,
  fund: IndexFund,
  corp: EligibleCorpRow,
  shares: number,
  referencePriceAnchor: number,
  currentTurn: number,
  batch?: FundShareBuyBatch
): Promise<{ ok: boolean; sharesBought: number; anchorSpent: number }> {
  const quote = await loadEquityQuote(db, corp, { pools: batch?.pools });
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
  const applyPurchase = async (
    session?: ClientSession,
    compensateStandaloneFailure = false
  ): Promise<boolean> => {
    const sessionOpts = session ? { session } : undefined;
    let debitedFund: Pick<IndexFund, "_id" | "cashAnchor" | "holdings"> | null = null;
    let shareCreditApplied = false;
    let issuerCreditApplied = false;
    let floatBuyCreditReceipt: FloatBuyCreditReceipt | undefined;
    let holdingsUpdated = false;
    let purchasedHoldings: IndexFundHolding[] | undefined;
    const shareholderSnapshot = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: corp._id }, { projection: { shareholders: 1 }, ...sessionOpts });
    const previousShareholder = shareholderSnapshot?.shareholders?.find(
      (holder) => holder.fundId?.toString() === fund._id.toString()
    );

    try {
      debitedFund = await atomicallyDebitFundCashAnchor(db, fund._id, actualCost, sessionOpts);
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
          knownShareholders: shareholderSnapshot?.shareholders,
          ...(session ? { session } : {}),
        }
      );

      if (!creditOk) {
        await refundFundCashAnchor(db, fund._id, actualCost, sessionOpts);
        return false;
      }
      shareCreditApplied = true;

      floatBuyCreditReceipt = await applyFloatBuyCredit(db, corp, actualIssuerCreditLocal, {
        ...sessionOpts,
        pools: batch?.pools,
        sharesBought: shares,
      });
      issuerCreditApplied = true;

      purchasedHoldings = updateHoldingAfterPurchase(
        debitedFund.holdings ?? [],
        corp._id,
        shares,
        executionPriceAnchor
      );
      await updateFundHoldings(db, fund._id, purchasedHoldings, sessionOpts);
      holdingsUpdated = true;

      const now = new Date();
      const tx = {
        fundId: fund._id,
        kind: "public_float_buy" as const,
        corporationId: corp._id,
        shares,
        navAnchor: executionPriceAnchor,
        amountAnchor: actualCost,
        createdAt: now,
      };
      if (batch?.txSink) batch.txSink.push(tx);
      else await insertFundTransaction(db, tx, sessionOpts);

      const ledgerRow = {
        type: "stock_trade_buy" as const,
        turn: currentTurn,
        createdAt: now,
        subjectType: "fund" as const,
        subjectId: fund._id,
        subjectName: fund.name,
        amount: -actualCost,
        anchorAmount: -actualCost,
        currencyCode: fund.anchorCurrencyCode,
        counterpartyType: "system" as const,
        counterpartyName: "Public float",
        meta: {
          corporationId: corp._id.toString(),
          shares,
          pricePerShareAnchor: executionPriceAnchor,
          source: "fund-cron-float-buy",
        },
      };
      if (batch) (batch.ledgerSink ??= []).push(ledgerRow);
      else await emitTx(db, ledgerRow);

      return true;
    } catch (error) {
      if (!compensateStandaloneFailure || !debitedFund) throw error;
      const debitedSnapshot = debitedFund;
      const compensationErrors: unknown[] = [];
      const compensate = async (revert: () => Promise<void>) => {
        try {
          await revert();
        } catch (compensationError) {
          compensationErrors.push(compensationError);
        }
      };
      if (holdingsUpdated && purchasedHoldings) {
        await compensate(async () => {
          const holdingsRollback = await db
            .collection<IndexFund>("indexFunds")
            .updateOne(
              { _id: fund._id, holdings: purchasedHoldings },
              { $set: { holdings: debitedSnapshot.holdings ?? [], updatedAt: new Date() } }
            );
          if (holdingsRollback.matchedCount !== 1) {
            throw new Error("Failed to reverse fund holdings update");
          }
        });
      }
      if (issuerCreditApplied) {
        await compensate(async () => {
          await reverseFloatBuyCredit(
            db,
            corp,
            actualIssuerCreditLocal,
            batch?.pools,
            floatBuyCreditReceipt
          );
        });
      }
      if (shareCreditApplied) {
        await compensate(async () => {
          await reverseFundShareCredit(
            db,
            corp,
            fund._id,
            shares,
            orderFlowEligible ? actualIssuerCreditLocal : 0,
            previousShareholder
          );
        });
      }
      await compensate(async () => {
        await refundFundCashAnchor(db, fund._id, actualCost);
      });
      if (compensationErrors.length > 0) {
        throw new AggregateError(
          [error, ...compensationErrors],
          `Index fund public-float buy failed and ${compensationErrors.length} compensation step(s) were incomplete`
        );
      }
      throw error;
    }
  };

  const purchaseApplied = await runWithOptionalTransaction(
    (session) => applyPurchase(session),
    () => applyPurchase(undefined, true)
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
  const sellInputs =
    plan.sells.length > 0
      ? await Promise.all([loadFxRatesByCurrency(db), getCurrentTurn(db), loadTxThresholds(db)])
      : undefined;
  // Sells first so freed cash funds the buys.
  for (const leg of plan.sells) {
    const refreshed = (await getFundById(db, fund._id)) ?? fund;
    const res = await sellFundHoldingShares(db, refreshed, leg.corporationId, leg.shares, {
      note: "Rebalance: trim overweight",
      fxByCurrency: sellInputs?.[0],
      turn: sellInputs?.[1],
      thresholds: sellInputs?.[2],
    });
    if (res.sharesSold > 0) sells++;
  }

  let buys = 0;
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));
  // One pool read and one transaction insert for the whole buy pass. The
  // buy reads the fund's live cash and holdings from its own atomic debit, so
  // the per-buy fund re-read this loop used to do bought nothing: on the
  // rebalance day (every 24 turns) that was ~550 of ~5,000 round trips.
  const buyBatch: FundShareBuyBatch = {
    pools: plan.buys.length > 0 ? await loadEquityPoolsByCurrency(db) : undefined,
    txSink: [],
  };
  for (const leg of plan.buys) {
    const corp = corpMap.get(leg.corporationId.toString());
    if (!corp) continue;
    const res = await executeFundShareBuy(
      db,
      fund,
      corp,
      leg.shares,
      leg.sharePriceAnchor,
      currentTurn,
      buyBatch
    );
    if (res.ok) buys++;
  }
  await insertFundTransactionsBulk(db, buyBatch.txSink ?? []);
  if (buyBatch.ledgerSink && buyBatch.ledgerSink.length > 0) {
    await emitTxBulk(db, buyBatch.ledgerSink, await loadTxThresholds(db));
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
        await cancelFundShareOrder(db, order._id, currentTurn);
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

  await insertFundTransaction(db, {
    fundId: fund._id,
    kind: "rebalance",
    navAnchor: fund.quotedNav,
    amountAnchor: 0,
    note: `Rebalanced: ${targetConstituents.length} constituents`,
    createdAt: new Date(),
  });

  return {
    rebalanced: true,
    writtenOffCount: writeOff.writtenOffCount,
    writtenOffValueAnchor: writeOff.writtenOffValueAnchor,
    unsellableCount: writeOff.unsellableCount,
  };
}

// ── Pass 3c: Process queued redemptions ───────────────────────────────

/**
 * Age past which a `processing` redemption row is reconciled from durable
 * truth. A single payout claim-to-finalize is milliseconds of sequential
 * writes, so five minutes means the owner crashed or stalled mid-settlement,
 * not that it is slow. Staleness is NOT proof the owner died: on standalone
 * Mongo a lease expiry cannot distinguish a dead owner from a stalled one
 * that resumes at any moment, so the reaper below fails closed (keeps the
 * debit marker, quarantines the row) instead of refunding or restoring from
 * an ambiguous state.
 */
export const STALE_REDEMPTION_PROCESSING_MS = 5 * 60 * 1000;

export interface RedemptionReapResult {
  reaped: number;
  restored: number;
  /**
   * Always 0: the reaper never refunds. A stale marker plus an unproven
   * holder credit is ambiguous (the owner may still credit), so the reaper
   * keeps the debit marker and quarantines instead. Refunds happen only on
   * live-owner paths that prove their own credit never landed, and on the
   * explicit manual `reconcileQuarantinedRedemption`. Kept for shape
   * stability.
   */
  refunded: number;
  finalized: number;
  skippedLegacy: number;
  quarantined: number;
}

/**
 * Per-attempt settlement id, unique across restarts. Ties the queue journal
 * (`processingAttempt.attemptKey`) to the fund-side debit marker and the
 * holder-side credit receipt. Never reused: a replay after a restore mints a
 * fresh key, so a stale marker or receipt can never alias a new attempt. The
 * random suffix closes the same-millisecond reclaim alias (claim, restore,
 * and reclaim inside one ms would otherwise re-mint the identical key and a
 * new attempt's receipt guard could match the old attempt's receipt).
 */
export function redemptionAttemptKey(entryId: ObjectId, claimedAt: Date): string {
  return `rx-${entryId.toString()}-${claimedAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}

const debitMarkerPath = (attemptKey: string): string => `redemptionDebitMarkers.${attemptKey}`;

/**
 * Refund a marked fund debit exactly once (cash, plus supply for legacy-burn
 * rows). The marker is removed atomically with the refund, so a retry, a
 * second reaper, or an owner resolving the same attempt finds no marker and
 * moves no money: concurrent refund attempts converge to a single refund.
 * Returns true when this call performed the refund.
 */
async function refundMarkedDebit(
  db: Db,
  fundId: IndexFund["_id"],
  attemptKey: string,
  marker: Pick<IndexFundRedemptionDebitMarker, "amountAnchor" | "units">
): Promise<boolean> {
  const path = debitMarkerPath(attemptKey);
  const result = await db.collection<IndexFund>("indexFunds").updateOne(
    { _id: fundId, [path]: { $exists: true } },
    {
      $inc: {
        cashAnchor: marker.amountAnchor,
        ...(marker.units > 0 ? { unitSupply: marker.units } : {}),
      },
      $unset: { [path]: "" },
      $set: { updatedAt: new Date() },
    }
  );
  return result.matchedCount === 1;
}

type DebitMarkerRead =
  | { status: "present"; marker: IndexFundRedemptionDebitMarker }
  | { status: "absent" }
  | { status: "unknown" };

/** Read this attempt's fund-side debit marker: durable proof the debit landed. */
async function readDebitMarker(
  db: Db,
  fundId: IndexFund["_id"],
  attemptKey: string
): Promise<DebitMarkerRead> {
  let fund: IndexFund | null;
  try {
    fund = await getFundById(db, fundId);
  } catch {
    return { status: "unknown" };
  }
  if (!fund) return { status: "unknown" };
  const marker = fund.redemptionDebitMarkers?.[attemptKey];
  return marker ? { status: "present", marker } : { status: "absent" };
}

type HolderReceiptRead =
  | { status: "credited"; receipt: IndexFundRedemptionReceipt }
  | { status: "absent" }
  | { status: "holder-missing" }
  | { status: "unknown" };

function asReceiptArray(value: unknown): IndexFundRedemptionReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is IndexFundRedemptionReceipt =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { key?: unknown }).key === "string"
  );
}

/**
 * Read this attempt's holder-side credit receipt: durable proof the holder
 * credit landed. Reads are projected to the receipts array only (NPP
 * documents are 31 KB; only the receipts are needed here) and run solely on
 * failure/recovery paths, never on the payout hot path.
 */
async function readHolderReceipt(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  attemptKey: string
): Promise<HolderReceiptRead> {
  const pick = (doc: { redemptionReceipts?: unknown } | null): HolderReceiptRead => {
    if (!doc) return { status: "holder-missing" };
    const receipt = asReceiptArray(doc.redemptionReceipts).find((r) => r.key === attemptKey);
    return receipt ? { status: "credited", receipt } : { status: "absent" };
  };
  try {
    if (entry.characterId) {
      const rows = await db
        .collection("characters")
        .find({ _id: entry.characterId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
    if (entry.imperialCharacterId) {
      const rows = await db
        .collection("imperialCharacters")
        .find({ _id: entry.imperialCharacterId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
    if (entry.nppId) {
      // Projected: NPP docs are 31 KB, only the receipts array is needed here.
      const rows = await db
        .collection("npps")
        .find({ _id: entry.nppId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
  } catch {
    return { status: "unknown" };
  }
  return { status: "holder-missing" };
}

/**
 * Complete a payout's queue bookkeeping without moving money: for a payout
 * whose fund debit and holder credit both landed. Conditional on the row
 * still carrying this attempt's journal, so a concurrent resolver (owner or
 * reaper) that already finalized or restored the row wins and this call is a
 * safe no-op. Returns true when this call finalized the row.
 */
async function finalizePayoutBookkeeping(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  attemptKey: string,
  figures: Pick<IndexFundRedemptionReceipt, "amountAnchor" | "remainingUnits" | "nav">,
  paidBefore: number
): Promise<boolean> {
  const remaining = Math.max(0, figures.remainingUnits);
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      { _id: rowId, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: {
          status: redemptionEntryStatusAfterPayout(remaining),
          paidAmountAnchor: paidBefore + figures.amountAnchor,
          units: remaining,
          requestedAmountAnchor: remaining * figures.nav,
          updatedAt: new Date(),
        },
        $unset: { processingStartedAt: "", processingAttempt: "" },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Restore a processing claim to its pre-claim status and clear the journal.
 * Conditional on the row still carrying this attempt's journal, so it can
 * never clobber a newer attempt's claim or a concurrent resolver's outcome.
 * Returns true when this call restored the row.
 */
async function restorePayoutClaim(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  from: IndexFundRedemptionStatus,
  attemptKey: string
): Promise<boolean> {
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      { _id: rowId, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: { status: from, updatedAt: new Date() },
        $unset: { processingStartedAt: "", processingAttempt: "" },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Reconcile this fund's stale `processing` redemption rows after a crash
 * (#2223). The queue journal (`processingAttempt`) is only a pointer: every
 * decision is read off the two durable markers written atomically with their
 * money legs, the fund-side debit marker and the holder-side credit receipt:
 * - no journal (legacy row) — left untouched for manual reconciliation. The
 *   old code could strand these either side of the holder credit, so replaying
 *   them blind risks a double payout.
 * - journaled, no debit marker — the debit never landed (or was already
 *   refunded); restore to the pre-claim status with no money movement.
 * - journaled debit marker, receipt present — both money legs landed; finalize
 *   the queue bookkeeping from the receipt's figures without moving money
 *   again. Audit rows (fund transaction, ledger) are evidence only and are
 *   NOT re-emitted here: the crash may have landed them already, and a
 *   duplicate audit row is worse than a missing one.
 * - journaled debit marker, receipt absent / holder gone / receipt
 *   unreadable — AMBIGUOUS, even when the receipt reads cleanly absent: on
 *   standalone Mongo a lease expiry is not proof the owner died, and a
 *   stalled owner may credit at any moment, including between the receipt
 *   read below and the write after it. Fail closed: keep the fund debit
 *   marker (never refund) and quarantine the row conditionally on still
 *   owning this attempt, stamping the outstanding debit as the
 *   reconciliation obligation. Refunding would mint money if the credit
 *   landed or lands; restoring would replay a paid entry. A truly dead
 *   owner is resolved later through the explicit manual
 *   `reconcileQuarantinedRedemption`, never by an automatic refund.
 *
 * Reaper claims are atomic (exact `processingStartedAt` match), so
 * concurrent reapers resolve each row exactly once. The quarantine write is
 * conditional on the row still carrying this attempt (`processing` + same
 * attempt key), so a reaper delayed after reading no receipt cannot clobber
 * an owner that finalized in the meantime: the write matches nothing and
 * the reaper stands down.
 *
 * Lease race (owner stalled past the lease, reaper quarantines, owner
 * resumes and credits): the pre-credit fence closes it when the stall is
 * before the fence. A stall between fence and credit (or credit and
 * finalize) lands a STILL-BACKED credit, because the marker was kept: the
 * owner's conditional finalize still matches (the quarantine kept the same
 * attempt key) and the payout completes exactly once, clearing the marker
 * on the owner's pass. An unbacked holder credit now arises only when a
 * concurrent resolver refunds the debit out from under a live owner — which
 * the reaper no longer does, leaving only an operator's manual
 * refund-and-restore racing the owner — and the owner's conditional
 * finalize then loses and resolveLostFinalizeRace reverses the credit
 * receipt-guarded (exactly once, verified by re-read) instead of auditing
 * or replaying. An unverifiable reversal quarantines the restored row
 * durably with the exact reversal figures (never a warn-log-only
 * obligation, never silently conserved), and
 * retryQuarantinedHolderReversal replays nothing until the receipt is
 * proven gone. Only a transaction (replica set) removes the check-to-act
 * windows entirely.
 */
export async function reapStaleRedemptionProcessing(
  db: Db,
  fundId: IndexFund["_id"],
  options?: { staleAfterMs?: number; now?: Date }
): Promise<RedemptionReapResult> {
  const result: RedemptionReapResult = {
    reaped: 0,
    restored: 0,
    refunded: 0,
    finalized: 0,
    skippedLegacy: 0,
    quarantined: 0,
  };
  const staleAfterMs = options?.staleAfterMs ?? STALE_REDEMPTION_PROCESSING_MS;
  const now = options?.now ?? new Date();
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const stale = await queue
    .find({
      fundId,
      status: "processing",
      processingStartedAt: { $lt: new Date(now.getTime() - staleAfterMs) },
    })
    .toArray();
  const skippedIds: string[] = [];
  const quarantinedIds: string[] = [];
  // Outstanding debits parked on quarantined rows: the explicit
  // reconciliation obligation (never silently conserved).
  let quarantinedAnchor = 0;
  // Fund debit markers, loaded lazily on the first journaled row: the common
  // case (no stale rows, or only legacy rows) costs no extra round trip.
  let fundMarkers: Record<string, IndexFundRedemptionDebitMarker> | undefined;
  // Finalized rows' markers are cleared in one batched write below.
  const markersToClear = new Set<string>();
  for (const row of stale) {
    // Atomic claim: only one reaper wins per lease period.
    const claim = await queue.updateOne(
      { _id: row._id, status: "processing", processingStartedAt: row.processingStartedAt },
      { $set: { processingStartedAt: now, updatedAt: now } }
    );
    if (claim.matchedCount !== 1) continue;
    const fresh = await queue.findOne({ _id: row._id });
    if (!fresh || fresh.status !== "processing") continue;
    const attempt = fresh.processingAttempt;
    if (
      !attempt ||
      typeof attempt.attemptKey !== "string" ||
      (attempt.from !== "queued" && attempt.from !== "partial")
    ) {
      result.skippedLegacy++;
      skippedIds.push(row._id.toString());
      continue;
    }
    if (attempt.quarantined) {
      // Terminal fail-closed state: counted, never retried, never warned twice.
      result.quarantined++;
      continue;
    }
    result.reaped++;
    const attemptKey = attempt.attemptKey;
    if (fundMarkers === undefined) {
      try {
        fundMarkers = (await getFundById(db, fundId))?.redemptionDebitMarkers ?? {};
      } catch {
        // The fund read failed: leave this row for the next pass rather than
        // deciding refund-vs-restore blind.
        result.reaped--;
        console.warn(
          `[indexfund-cron] could not read fund ${fundId.toString()} to reconcile stale redemption ${row._id.toString()}; leaving it for the next pass`
        );
        continue;
      }
    }
    const marker = fundMarkers[attemptKey];
    if (!marker) {
      // No outstanding debit: the owner died before the debit, or a previous
      // reaper already refunded (its marker-atomic refund is exactly-once, so
      // there is nothing left to refund). Restore with no money movement.
      await restorePayoutClaim(db, row._id, attempt.from, attemptKey);
      result.restored++;
      continue;
    }
    let receipt: HolderReceiptRead;
    try {
      receipt = await readHolderReceipt(db, fresh, attemptKey);
    } catch {
      receipt = { status: "unknown" };
    }
    if (receipt.status === "credited") {
      // Both legs landed: finalize bookkeeping from the receipt's durable
      // figures. No money moves, no audit rows are re-emitted.
      await finalizePayoutBookkeeping(
        db,
        row._id,
        attemptKey,
        {
          amountAnchor: receipt.receipt.amountAnchor,
          remainingUnits: receipt.receipt.remainingUnits,
          nav: receipt.receipt.nav,
        },
        fresh.paidAmountAnchor ?? 0
      );
      markersToClear.add(attemptKey);
      // Retain the receipt after finalization. An owner paused before its
      // credit may resume after this reaper; removing the key would reopen
      // the idempotency guard and permit a second holder credit.
      result.finalized++;
      continue;
    }
    // Marker present, receipt not provably credited (absent, holder gone,
    // or unreadable): ambiguous. A clean "absent" read is NOT proof the
    // owner will never credit — the owner may be stalled and resume between
    // this read and the write below, and on standalone Mongo the lease
    // expiry above proves nothing about the owner's liveness. Fail closed:
    // keep the debit marker and quarantine the row conditionally on still
    // owning this attempt, stamping the outstanding debit as the
    // reconciliation obligation. Never refund (would mint money if the
    // credit landed or lands) and never restore (would replay a paid
    // entry). A still-active owner that credits while this attempt remains
    // `processing` finalizes through the quarantine (same attempt key); a
    // truly dead owner is resolved later via the explicit manual
    // `reconcileQuarantinedRedemption`.
    const quarantined = await queue.updateOne(
      { _id: row._id, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: {
          processingStartedAt: now,
          "processingAttempt.quarantined": true,
          "processingAttempt.outstandingAnchor": marker.amountAnchor,
          "processingAttempt.outstandingUnits": marker.units,
          updatedAt: now,
        },
      }
    );
    if (quarantined.matchedCount !== 1) {
      // The row moved on while this reaper was reading truth: the owner
      // finalized (or restored) it concurrently, or the marker/refund path
      // of a live owner resolved it. The conditional write above matched
      // nothing, so nothing was clobbered: stand down without counting,
      // warning, or touching money.
      continue;
    }
    result.quarantined++;
    quarantinedIds.push(row._id.toString());
    quarantinedAnchor += marker.amountAnchor;
  }
  if (markersToClear.size > 0) {
    const unset: Record<string, ""> = {};
    for (const key of markersToClear) unset[debitMarkerPath(key)] = "";
    await db.collection<IndexFund>("indexFunds").updateOne({ _id: fundId }, { $unset: unset });
  }
  if (skippedIds.length > 0) {
    console.warn(
      `[indexfund-cron] ${skippedIds.length} stale processing redemption(s) left for manual reconciliation (no recovery journal): ${skippedIds.join(", ")}`
    );
  }
  if (quarantinedIds.length > 0) {
    console.warn(
      `[indexfund-cron] ${quarantinedIds.length} stale processing redemption(s) quarantined for manual reconciliation (debit marker kept, holder credit unproven, ${quarantinedAnchor} anchor debit outstanding; resolve via reconcileQuarantinedRedemption): ${quarantinedIds.join(", ")}`
    );
  }
  return result;
}

/** Holder collection + id for receipt reads and explicit reversal. */
function holderReceiptCollection(
  entry: IndexFundRedemptionQueueEntry
): { collection: "characters" | "imperialCharacters" | "npps"; id: ObjectId } | null {
  if (entry.characterId) return { collection: "characters", id: entry.characterId };
  if (entry.imperialCharacterId)
    return { collection: "imperialCharacters", id: entry.imperialCharacterId };
  if (entry.nppId) return { collection: "npps", id: entry.nppId };
  return null;
}

/**
 * Credit one queued-redemption payout to its holder, writing the durable
 * receipt atomically with the credit. The receipt guard (`receipts.key $ne
 * attemptKey`) makes the credit idempotent: a replay of the same attempt can
 * never credit twice, and the owner/reaper can tell "credit landed" from
 * "credit never attempted" by reading the receipt instead of guessing.
 * Returns true when the holder was credited, false when there is no holder
 * to credit (unknown holder shape, or the holder document is gone). Throws
 * on write failure so the caller can resolve the attempt from durable truth.
 */
async function creditRedemptionHolder(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  receipt: IndexFundRedemptionReceipt,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean
): Promise<boolean> {
  const now = new Date();
  const receiptGuard = { "redemptionReceipts.key": { $ne: receipt.key } };
  if (entry.characterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db.collection("characters").updateOne(
      { _id: entry.characterId, ...receiptGuard },
      {
        $inc: inc,
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  if (entry.imperialCharacterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db.collection("imperialCharacters").updateOne(
      { _id: entry.imperialCharacterId, ...receiptGuard },
      {
        $inc: inc,
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  if (entry.nppId) {
    // NPP investment cash stays in anchor (₳): the redeemFxRate wallet
    // multiplier applies to character/imperial credits only.
    const creditResult = await db.collection("npps").updateOne(
      { _id: entry.nppId, ...receiptGuard },
      {
        $inc: { nppInvestmentCashAnchor: paidAmountAnchor },
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  return false;
}

/**
 * Reverse this attempt's holder credit, conditionally on our receipt still
 * being present: the guard makes the reversal idempotent (a retry or a
 * concurrent resolver converges to one reversal) and lets a holder state we
 * no longer recognize (deleted, recreated, re-credited) win instead of being
 * debited blind. Returns true when this call removed the credit.
 */
async function reverseHolderCredit(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  receiptKey: string,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean
): Promise<boolean> {
  const target = holderReceiptCollection(entry);
  if (!target) return false;
  let inc: Record<string, number> | null = null;
  if (entry.characterId || entry.imperialCharacterId) {
    const credit = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    inc = Object.fromEntries(Object.entries(credit).map(([k, v]) => [k, -v]));
  } else if (entry.nppId) {
    inc = { nppInvestmentCashAnchor: -paidAmountAnchor };
  }
  if (!inc) return false;
  try {
    const result = await db
      .collection<{ redemptionReceipts?: IndexFundRedemptionReceipt[] }>(target.collection)
      .updateOne(
        { _id: target.id, "redemptionReceipts.key": receiptKey },
        {
          $inc: inc,
          $pull: { redemptionReceipts: { key: receiptKey } },
          $set: { updatedAt: new Date() },
        }
      );
    return result.matchedCount === 1;
  } catch {
    return false;
  }
}

/**
 * Quarantine a restored queue row that carries an unbacked (or unverifiable)
 * holder credit (#2223, owner side). The reaper already returned this row to
 * its payable status, so without this write the next pass would replay it
 * and pay the holder a second time. The write is conditional on the row
 * still sitting in that restored state (same status and unpaid figures), so
 * it can never clobber a newer attempt's claim or a concurrent resolver's
 * outcome: a newer claim runs under `processing` with a fresh key, and a
 * replay that already paid changed the figures. The stamped
 * `unreversed*` figures are the explicit reconciliation obligation and the
 * exact inputs `retryQuarantinedHolderReversal` needs; the row stays
 * non-replayable (`processing`, invisible to `listPendingRedemptions`) until
 * that retry proves the receipt gone. Returns true when the quarantine
 * landed. A false return means the row already moved on (re-claimed or
 * paid): the caller must escalate loudly, because a double-pay may already
 * be in flight.
 */
async function quarantineUnbackedHolderCredit(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  from: IndexFundRedemptionStatus,
  attemptKey: string,
  paidAnchorBefore: number,
  unitsBefore: number,
  reversal: { amountAnchor: number; paidNative: number; units: number }
): Promise<boolean> {
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      {
        _id: rowId,
        status: from,
        paidAmountAnchor: paidAnchorBefore,
        units: unitsBefore,
      },
      {
        $set: {
          status: "processing",
          processingStartedAt: new Date(),
          "processingAttempt.from": from,
          "processingAttempt.attemptKey": attemptKey,
          "processingAttempt.quarantined": true,
          "processingAttempt.outstandingAnchor": 0,
          "processingAttempt.outstandingUnits": 0,
          "processingAttempt.unreversedReceiptKey": attemptKey,
          "processingAttempt.unreversedAmountAnchor": reversal.amountAnchor,
          "processingAttempt.unreversedNative": reversal.paidNative,
          "processingAttempt.unreversedUnits": reversal.units,
          updatedAt: new Date(),
        },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Resolve a lost finalize race after this attempt's holder credit landed
 * (#2223 lease race). The finalize is conditional on still owning the row, so
 * losing it means a concurrent resolver (reaper) already finalized or
 * restored the row. Every outcome is read off durable truth, never assumed:
 * - receipt credited, debit marker absent: a concurrent resolver refunded
 *   the debit and restored the row while we were stalled between fence and
 *   credit (or credit and finalize) — the reaper itself never refunds, so
 *   this is an operator's manual refund-and-restore racing a live owner —
 *   and our credit then landed UNBACKED. Reverse it (receipt-guarded, so
 *   exactly once) and verify the reversal by re-read. On a verified
 *   reversal the restored row is payable again and replays exactly once.
 * - reversal failed or unverifiable, or either truth unreadable: quarantine
 *   the restored row durably (`quarantineUnbackedHolderCredit`) with the
 *   exact reversal figures, so the queue is NEVER replayable while the
 *   unbacked receipt remains. A warn log alone is not safety: in standalone
 *   Mongo a lease expiry cannot prove the old owner died, so the obligation
 *   must live on the row until `retryQuarantinedHolderReversal` proves the
 *   receipt gone. Never silently conserved.
 * - receipt credited, marker present: the reaper finalized from our receipt
 *   (both legs landed, books correct); stand down without auditing twice.
 * - receipt absent, marker absent: both legs were resolved externally (or a
 *   delete/recreate shed the receipt after a correct finalize); stand down.
 * - receipt absent, marker present: a holder recreate may have shed the
 *   receipt; refunding here could double-refund a paid holder. Stand down.
 */
async function resolveLostFinalizeRace(
  db: Db,
  fundId: IndexFund["_id"],
  entry: IndexFundRedemptionQueueEntry,
  attemptKey: string,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean,
  paidUnits?: number
): Promise<void> {
  const rowId = entry._id.toString();
  let seen: HolderReceiptRead;
  try {
    seen = await readHolderReceipt(db, entry, attemptKey);
  } catch {
    seen = { status: "unknown" };
  }
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fundId, attemptKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (seen.status === "credited" && marker.status === "absent") {
    const reversed = await reverseHolderCredit(
      db,
      entry,
      attemptKey,
      paidNative,
      paidAmountAnchor,
      anchorCurrencyCode,
      forexEnabled
    );
    if (reversed) {
      let verify: HolderReceiptRead;
      try {
        verify = await readHolderReceipt(db, entry, attemptKey);
      } catch {
        verify = { status: "unknown" };
      }
      if (verify.status === "absent") {
        console.warn(
          `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund; reversed the unbacked holder credit of ${paidAmountAnchor} anchor (receipt ${attemptKey})`
        );
        return;
      }
    }
    // Fail closed: the unbacked credit may still be out AND the row is
    // replayable. Quarantine it with the exact reversal figures instead of
    // warn-logging an obligation no future pass would honor.
    const quarantined = await quarantineUnbackedHolderCredit(
      db,
      entry._id,
      entry.status,
      attemptKey,
      entry.paidAmountAnchor ?? 0,
      entry.units,
      { amountAnchor: paidAmountAnchor, paidNative, units: paidUnits ?? 0 }
    );
    if (quarantined) {
      console.warn(
        `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund and the unbacked holder credit of ${paidAmountAnchor} anchor could not be verifiably reversed (receipt ${attemptKey}); row quarantined, manual reconciliation required via retryQuarantinedHolderReversal`
      );
      return;
    }
    console.warn(
      `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund, the unbacked holder credit of ${paidAmountAnchor} anchor could not be verifiably reversed (receipt ${attemptKey}), AND the row could not be quarantined (already re-claimed or paid); manual reconciliation required immediately, a double-pay may be in flight`
    );
    return;
  }
  if (seen.status === "unknown" || marker.status === "unknown") {
    // Same fail-closed quarantine: the credit may have landed unbacked and
    // the row may be replayable. Stamp what this attempt knows (its own
    // credit figures); the retry resolves from truth reads.
    const quarantined = await quarantineUnbackedHolderCredit(
      db,
      entry._id,
      entry.status,
      attemptKey,
      entry.paidAmountAnchor ?? 0,
      entry.units,
      { amountAnchor: paidAmountAnchor, paidNative, units: paidUnits ?? 0 }
    );
    if (quarantined) {
      console.warn(
        `[indexfund-cron] redemption payout for ${rowId} lost its finalize race and settlement truth is unreadable (receipt ${attemptKey}); row quarantined with ${paidAmountAnchor} anchor possibly unbacked, manual reconciliation required via retryQuarantinedHolderReversal`
      );
      return;
    }
    console.warn(
      `[indexfund-cron] redemption payout for ${rowId} lost its finalize race, settlement truth is unreadable (receipt ${attemptKey}), AND the row could not be quarantined (already re-claimed or paid); manual reconciliation required immediately`
    );
    return;
  }
  // All remaining combinations (credited+present, absent+absent,
  // absent+present, holder-missing with no marker) were reconciled
  // externally: both legs accounted for, or nothing outstanding. Stand down
  // without moving money or touching the row.
}

/**
 * Retry the receipt-guarded reversal for a quarantined unbacked holder
 * credit, then restore the row to payable ONLY on verified clean truth
 * (#2223 reconciliation obligation). Fail-closed at every step:
 * - row not quarantined `processing`, or carrying no unreversed receipt and
 *   no outstanding debit: nothing to do.
 * - receipt still credited and the reversal fails or is unverified: the
 *   quarantine stands (returns `still-quarantined`).
 * - receipt credited but the journal carries no reversal figures (a
 *   reaper-quarantined row whose credit state was never provable): the
 *   retry cannot know what to debit, so the quarantine stands for a human.
 * - receipt verifiably absent but a fund debit marker is outstanding (or
 *   unreadable): the quarantine stands. Refunding a quarantined row
 *   automatically is exactly what quarantine forbids.
 * - holder gone: the quarantine stands (a recreated holder must not be
 *   debited blind, and restoring could replay against it).
 * - receipt verifiably absent AND no marker outstanding: restore to the
 *   pre-claim status (conditional, so a concurrent resolver wins) and return
 *   `restored`. The next pass then pays the entry exactly once.
 *
 * Supported configurations: the payout legs are plain conditional writes
 * with no session, so this retry runs identically on a replica set and on
 * standalone Mongo. Only a transaction (replica set) would remove the
 * underlying check-to-act windows; the queue payout path does not use one
 * on either configuration, which is why this protocol exists.
 */
export type QuarantinedReversalOutcome = "restored" | "still-quarantined" | "not-quarantined";

export async function retryQuarantinedHolderReversal(
  db: Db,
  fund: IndexFund,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  forexEnabled: boolean
): Promise<QuarantinedReversalOutcome> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const row = await queue.findOne({ _id: rowId });
  const attempt = row?.processingAttempt;
  if (!row || row.status !== "processing" || !attempt || attempt.quarantined !== true) {
    return "not-quarantined";
  }
  const receiptKey = attempt.unreversedReceiptKey ?? attempt.attemptKey;
  let seen: HolderReceiptRead;
  try {
    seen = await readHolderReceipt(db, row, receiptKey);
  } catch {
    seen = { status: "unknown" };
  }
  if (seen.status === "credited") {
    // Reverse exactly what the stale owner credited. Without journaled
    // figures there is nothing safe to debit: stand the quarantine for a
    // human instead of guessing amounts.
    const amountAnchor = attempt.unreversedAmountAnchor;
    const paidNative = attempt.unreversedNative;
    if (typeof amountAnchor !== "number" || typeof paidNative !== "number") {
      console.warn(
        `[indexfund-cron] quarantined redemption ${rowId.toString()} still carries holder receipt ${receiptKey} with no journaled reversal figures; manual reconciliation required`
      );
      return "still-quarantined";
    }
    const reversed = await reverseHolderCredit(
      db,
      row,
      receiptKey,
      paidNative,
      amountAnchor,
      fund.anchorCurrencyCode,
      forexEnabled
    );
    if (!reversed) return "still-quarantined";
    let verify: HolderReceiptRead;
    try {
      verify = await readHolderReceipt(db, row, receiptKey);
    } catch {
      verify = { status: "unknown" };
    }
    if (verify.status !== "absent") {
      console.warn(
        `[indexfund-cron] quarantined redemption ${rowId.toString()} reversal of ${amountAnchor} anchor (receipt ${receiptKey}) could not be verified; quarantine stands, manual reconciliation required`
      );
      return "still-quarantined";
    }
  } else if (seen.status !== "absent") {
    // Unknown read or holder gone: fail closed, the quarantine stands.
    return "still-quarantined";
  }
  // Receipt verifiably absent. Restore only when no fund debit is
  // outstanding for this receipt: refunding or replaying past an outstanding
  // marker would mint money or double-pay.
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fund._id, receiptKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (marker.status !== "absent") return "still-quarantined";
  const restored = await restorePayoutClaim(db, rowId, attempt.from, attempt.attemptKey);
  if (restored) {
    console.warn(
      `[indexfund-cron] quarantined redemption ${rowId.toString()} reversal verified (receipt ${receiptKey} gone, no debit outstanding); row restored to ${attempt.from} for replay`
    );
    return "restored";
  }
  const reread = await queue.findOne({ _id: rowId });
  return reread?.status === "processing" && reread?.processingAttempt?.quarantined === true
    ? "still-quarantined"
    : "not-quarantined";
}

/**
 * Explicit manual reconciliation for a quarantined redemption row (#2223).
 * This is the ONLY path that refunds a fund debit the reaper refused to
 * touch: the reaper quarantines ambiguous stale rows with the debit marker
 * kept, so a truly dead owner (debit outstanding, credit unproven, owner
 * never coming back) strands here until a human resolves it.
 *
 * Precondition the code cannot check: the caller must have proven the owner
 * stopped (owner process dead, lease long expired, no overlapping cron that
 * could still credit under this attempt key). If that proof is wrong and a
 * live owner credits between the receipt read and the refund below, the
 * credit lands unbacked — but NOT silently: the owner's conditional finalize
 * then loses and `resolveLostFinalizeRace` reverses the credit
 * receipt-guarded, quarantining on failure. The window degrades to the
 * handled unbacked-credit path; it never double-pays quietly.
 *
 * Decisions are explicit so a wrong guess cannot mint money:
 * - "refund-and-restore" requires a verifiably absent receipt AND (for the
 *   refund leg) a present marker; a present receipt refuses
 *   (`still-quarantined`) instead of refunding a paid holder. The restore is
 *   conditional on the row still carrying this quarantine, so a concurrent
 *   resolver wins and this call is a safe no-op (`not-quarantined`).
 * - "finalize-from-receipt" requires a credited receipt and completes the
 *   bookkeeping from its figures without moving money; a non-credited
 *   receipt refuses instead of finalizing thin air. The marker for this
 *   attempt is cleared (key-unique, so it cannot touch another attempt).
 * - Unreadable truth, a gone holder, or a non-`processing`/non-quarantined
 *   row all fail closed (`still-quarantined` / `not-quarantined`).
 *
 * A pending debit parked here is an explicit reconciliation obligation: it
 * is never called conserved, and this function never restores a row past an
 * outstanding or unreadable marker.
 */
export type QuarantinedReconcileDecision = "refund-and-restore" | "finalize-from-receipt";
export type QuarantinedReconcileOutcome =
  "restored" | "finalized" | "still-quarantined" | "not-quarantined";

export async function reconcileQuarantinedRedemption(
  db: Db,
  fundId: IndexFund["_id"],
  rowId: IndexFundRedemptionQueueEntry["_id"],
  decision: QuarantinedReconcileDecision
): Promise<QuarantinedReconcileOutcome> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const row = await queue.findOne({ _id: rowId });
  const attempt = row?.processingAttempt;
  if (
    !row ||
    row.status !== "processing" ||
    !attempt ||
    attempt.quarantined !== true ||
    typeof attempt.attemptKey !== "string" ||
    (attempt.from !== "queued" && attempt.from !== "partial")
  ) {
    return "not-quarantined";
  }
  const journalKey = attempt.attemptKey;
  const receiptKey = attempt.unreversedReceiptKey ?? attempt.attemptKey;
  let receipt: HolderReceiptRead;
  try {
    receipt = await readHolderReceipt(db, row, receiptKey);
  } catch {
    receipt = { status: "unknown" };
  }
  if (decision === "finalize-from-receipt") {
    // Wrong-decision guard: finalizing without a proven credit would book a
    // payout nobody received. Refuse instead of guessing.
    if (receipt.status !== "credited") return "still-quarantined";
    const finalized = await finalizePayoutBookkeeping(
      db,
      rowId,
      journalKey,
      {
        amountAnchor: receipt.receipt.amountAnchor,
        remainingUnits: receipt.receipt.remainingUnits,
        nav: receipt.receipt.nav,
      },
      row.paidAmountAnchor ?? 0
    );
    if (!finalized) return "not-quarantined";
    await db
      .collection<IndexFund>("indexFunds")
      .updateOne({ _id: fundId }, { $unset: { [debitMarkerPath(journalKey)]: "" } });
    console.warn(
      `[indexfund-cron] quarantined redemption ${rowId.toString()} manually finalized from receipt ${receiptKey} (${receipt.receipt.amountAnchor} anchor, no money moved)`
    );
    return "finalized";
  }
  // "refund-and-restore": the operator asserts the owner is dead and the
  // holder was never paid. Enforce both from truth reads.
  if (receipt.status !== "absent") return "still-quarantined";
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fundId, journalKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (marker.status === "unknown") return "still-quarantined";
  if (marker.status === "present") {
    await refundMarkedDebit(db, fundId, journalKey, {
      amountAnchor: marker.marker.amountAnchor,
      units: marker.marker.units,
    });
  }
  const restored = await restorePayoutClaim(db, rowId, attempt.from, journalKey);
  if (!restored) return "not-quarantined";
  console.warn(
    `[indexfund-cron] quarantined redemption ${rowId.toString()} manually refunded and restored (receipt ${receiptKey} verifiably absent); entry is payable again`
  );
  return "restored";
}

/**
 * Pre-credit ownership fence: confirm this attempt still owns the row before
 * moving holder money. A reaper that claimed this row past the lease (owner
 * stalled, overlapping cron, slow turn) already accounted for the debit by
 * refunding or finalizing; crediting now would mint money the books do not
 * expect. Costs one projected read per payout on the hot path; the remaining
 * check-to-act race is milliseconds wide and documented on the reaper.
 */
async function attemptStillOwnsRow(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  attemptKey: string,
  claimedAt: Date
): Promise<boolean> {
  const rows = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .find({ _id: rowId })
    .project({ status: 1, processingStartedAt: 1, processingAttempt: 1 })
    .toArray();
  const row = rows[0];
  return (
    !!row &&
    row.status === "processing" &&
    row.processingAttempt?.attemptKey === attemptKey &&
    row.processingStartedAt instanceof Date &&
    row.processingStartedAt.getTime() === claimedAt.getTime()
  );
}

export async function processQueuedRedemptions(
  db: Db,
  fund: IndexFund,
  forexEnabled: boolean,
  currentTurn: number,
  recovery?: { staleAfterMs?: number }
): Promise<number> {
  // Reconcile the previous pass's interrupted payouts before paying new ones,
  // so a crashed turn's stranded rows resolve from durable truth (restored
  // when nothing is outstanding, finalized when both legs landed,
  // quarantined with the debit marker kept when ambiguous) instead of
  // stranding in `processing` forever.
  await reapStaleRedemptionProcessing(db, fund._id, { staleAfterMs: recovery?.staleAfterMs });
  const pending = await listPendingRedemptions(db, fund._id);
  if (pending.length === 0) return 0;

  // #992 tranche 6: one batched NPP lookup for the pass so each NPP
  // redemption below can be denominated in the NPP home currency (the
  // npp:<id>:<homeCurrency> snapshot key) without a per-entry read.
  const nppCurrencyById = new Map<string, CurrencyCode>();
  const queuedNppObjectIds = pending.flatMap((e) => (e.nppId ? [e.nppId] : []));
  if (queuedNppObjectIds.length > 0) {
    const nppDocs = await db
      .collection<{ _id: ObjectId; countryId?: string }>("npps")
      .find({ _id: { $in: queuedNppObjectIds } })
      .project({ countryId: 1 })
      .toArray();
    for (const doc of nppDocs) {
      const cur = COUNTRY_CURRENCY_MAP[doc.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      nppCurrencyById.set(doc._id.toString(), cur);
    }
  }

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
  // #992 tranche 6: thresholds for the bond-sale ledger rows below, loaded
  // at most once per redemption pass and only when a bond sale actually runs.
  let bondSaleThresholds: Awaited<ReturnType<typeof loadTxThresholds>> | undefined;

  // Units still unserved in this pass. Decremented as each entry is handled so
  // the share is measured against who is still waiting, not the original queue.
  let unservedUnits = pending.reduce((sum, e) => sum + Math.max(0, e.units ?? 0), 0);

  // Markers of finalized attempts are cleared in one batched write after the
  // loop, so the steady state costs one fund write per pass, not per payout.
  const markersToClear = new Set<string>();

  for (const pendingEntry of pending) {
    // Claim before any fund debit or holder credit. The claim journals the
    // pre-claim status plus a fresh attempt key (#2223); the key ties the
    // fund-side debit marker and the holder-side credit receipt to this
    // attempt, and both markers are written atomically with their money legs.
    // A crash later in this payout is reconciled from those markers, never
    // from the journal alone — which is why journal-less legacy rows stay
    // quarantined for manual reconciliation instead of being replayed blind.
    const claimedAt = new Date();
    const attemptKey = redemptionAttemptKey(pendingEntry._id, claimedAt);
    const entry = await db
      .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
      .findOneAndUpdate(
        {
          _id: pendingEntry._id,
          status: pendingEntry.status,
          units: pendingEntry.units,
          paidAmountAnchor: pendingEntry.paidAmountAnchor,
        },
        {
          $set: {
            status: "processing",
            processingStartedAt: claimedAt,
            processingAttempt: { from: pendingEntry.status, attemptKey },
            updatedAt: new Date(),
          },
        },
        { returnDocument: "before" }
      );
    if (!entry) continue;
    const restoreQueueClaim = async () => {
      await restorePayoutClaim(db, entry._id, entry.status, attemptKey);
    };

    const unitsRemaining = remainingRedemptionUnits(entry);
    if (unitsRemaining <= 0) {
      // No money to move; keyed so a concurrent resolver's outcome wins.
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing", "processingAttempt.attemptKey": attemptKey },
          {
            $set: { status: "paid", updatedAt: new Date() },
            $unset: { processingStartedAt: "", processingAttempt: "" },
          }
        );
      continue;
    }

    // Forward pricing. The payout is struck at the fund's CURRENT NAV, never at
    // `requestedNavAnchor` (kept only as the record of what was quoted at
    // request). Honouring a locked price across many turns is what let one
    // GLB50 holder draw 2.46B out of a fund whose assets were falling under
    // them, because their claim stayed fixed in cash terms while everyone
    // else's shrank. A real open-end fund forward-prices for exactly this
    // reason: a redemption spanning several valuation points gets each point's
    // NAV, so the redeemer carries the market like every other holder.
    const redemptionNav = fundState.quotedNav;
    if (!Number.isFinite(redemptionNav) || redemptionNav <= 0) {
      await restoreQueueClaim();
      break;
    }

    const entryObligation = unitsRemaining * redemptionNav;
    if (availableCash < entryObligation && fundState.holdings.length > 0) {
      const liquidity = await sellFundHoldingsForRedemptionCash(
        db,
        fundState,
        entryObligation - availableCash,
        {
          note: "Queued redemption liquidity",
        }
      );
      if (liquidity.liquidityQuarantined) {
        // Fail-closed (#2223): a previous sale may have died mid-leg, so no
        // new sale is raised for this fund until a human clears the journal.
        // The queue below still pays from available cash.
        console.warn(
          `[indexfund-cron] fund ${fund.slug}: liquidity raising quarantined (unreconciled interrupted sale); paying redemptions from cash only`
        );
      }
      fundState = (await getFundById(db, fund._id)) ?? fundState;
      availableCash = fundState.cashAnchor;
    }
    // Bonds are the next line of liquidity: sold to the market pool at its
    // bid, as far as the pool can pay. The only line for a bond fund.
    if (availableCash < entryObligation) {
      bondSaleThresholds ??= await loadTxThresholds(db);
      const bondSale = await sellFundBondHoldingsForCash(
        db,
        fundState,
        entryObligation - availableCash,
        new Date(),
        { turn: currentTurn, thresholds: bondSaleThresholds }
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

    // Pro-rata gate: never let one entry consume the book while others wait.
    // Measured against cash available now, after any liquidation above.
    const cashForThisEntry = proRataRedemptionCashShare({
      entryUnits: unitsRemaining,
      unservedUnits,
      availableCashAnchor: availableCash,
    });
    unservedUnits = Math.max(0, unservedUnits - unitsRemaining);

    const quote = quoteCashOnlyRedemption({
      quotedNav: redemptionNav,
      requestedUnits: unitsRemaining,
      cashAnchor: cashForThisEntry,
    });

    if (quote.redeemableUnits <= 0) {
      // This entry's pro-rata slice will not buy a whole unit. That says
      // nothing about the next entry, and the genuinely-out-of-cash case
      // already broke out above, so move on rather than starving the queue.
      await restoreQueueClaim();
      continue;
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
    // The debit writes its marker atomically (#2223): the marker's presence
    // on the fund document is durable proof the debit landed, and the refund
    // removes it atomically, so every interrupted attempt below resolves from
    // marker/receipt truth and can neither strand fund cash nor double-pay on
    // retry. Each entry is isolated (continue, not break) so one entry's
    // transient failure does not starve the rest of the queue.
    const burnUnits = shouldBurnUnitsNow ? quote.redeemableUnits : 0;
    const remainingAfterPay = quote.queuedUnits;
    const receipt: IndexFundRedemptionReceipt = {
      key: attemptKey,
      amountAnchor: paidAmount,
      units: quote.redeemableUnits,
      remainingUnits: remainingAfterPay,
      nav: redemptionNav,
    };
    const markerPath = debitMarkerPath(attemptKey);

    // Evidence rows (fund transaction, ledger) for a committed payout. Runs
    // only after this attempt's finalize won the conditional write, so a
    // retry or a concurrent resolver can never double-book them; a crash
    // after finalize leaves money and queue state correct with at most a
    // missing audit row.
    const emitPayoutEvidence = async () => {
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

      // #992 tranche 6: the NPP credit above moved nppInvestmentCashAnchor, and
      // unlike the character/imperial legs (which logIndexFundRedeem evidences)
      // it had no ledger row, so every queue-paid NPP redemption read as an
      // unexplained NPP inflow. One npp-subject index_fund_redeem row per paid
      // NPP entry, denominated in the NPP home currency from the batched lookup
      // with the ₳ value stated outright. The shadow ledger mirrors the fund
      // cash side off meta when the currencies match (same convention as the
      // NPP subscribe rows); a cross-currency pair stays single-sided under
      // fund_redemption, never guessed. Emitted here, after the queue row and
      // the fund transaction both landed, so a retry can never double-book it.
      if (entry.nppId) {
        const nppCurrency = nppCurrencyById.get(entry.nppId.toString()) ?? "USD";
        await emitTx(db, {
          type: "index_fund_redeem",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "npp",
          subjectId: entry.nppId,
          subjectName: `NPP ${entry.nppId.toString()}`,
          amount: paidAmount,
          anchorAmount: paidAmount,
          currencyCode: nppCurrency,
          counterpartyType: "system",
          counterpartyName: fund.name,
          meta: {
            fundId: fund._id.toString(),
            fundCurrency: fund.anchorCurrencyCode,
            units: quote.redeemableUnits,
            source: "cron_queue",
          },
        });
      }

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
    };

    let fundDebited = false;
    try {
      const debitResult = await db.collection<IndexFund>("indexFunds").updateOne(
        {
          ...debitFilter,
          [markerPath]: { $exists: false },
        },
        {
          $inc: debitInc,
          $set: {
            [markerPath]: {
              amountAnchor: paidAmount,
              units: burnUnits,
              queueEntryId: entry._id,
              markedAt: new Date(),
            },
            updatedAt: new Date(),
          },
        }
      );
      if (debitResult.matchedCount === 0) {
        await restoreQueueClaim();
        break;
      }
      fundDebited = true;
      availableCash -= paidAmount;

      // Ownership fence before holder money moves: a reaper that claimed this
      // row past the lease already accounted for the debit. Crediting now
      // would mint money, so refund the debit and stand down instead — the
      // reaper owns the row from here.
      if (!(await attemptStillOwnsRow(db, entry._id, attemptKey, claimedAt))) {
        await refundMarkedDebit(db, fund._id, attemptKey, {
          amountAnchor: paidAmount,
          units: burnUnits,
        });
        availableCash += paidAmount;
        continue;
      }

      const holderCredited = await creditRedemptionHolder(
        db,
        entry,
        receipt,
        paidNative,
        paidAmount,
        fundState.anchorCurrencyCode,
        forexEnabled
      );
      if (!holderCredited) {
        // Acknowledged matched-0 under this attempt key (holder gone, or the
        // row carries no holder): the receipt read distinguishes "already
        // paid under this key" (finalize, moving no money) from "never
        // credited" (refund once, then restore). The key is unique per
        // attempt (redemptionAttemptKey carries a random suffix), so a
        // matched-0 proves THIS attempt credited nothing: a receipt under
        // this key cannot predate us. Delete/recreate stays safe too: the
        // recreated doc carries no receipt (reads "absent"), the destroyed
        // credit died with the old doc, and refund-plus-restore replays
        // exactly once. Only an unreadable receipt fails closed (left for
        // the reaper with the debit outstanding as an explicit obligation).
        let seen: HolderReceiptRead;
        try {
          seen = await readHolderReceipt(db, entry, attemptKey);
        } catch {
          seen = { status: "unknown" };
        }
        if (seen.status === "credited") {
          if (
            await finalizePayoutBookkeeping(
              db,
              entry._id,
              attemptKey,
              receipt,
              entry.paidAmountAnchor ?? 0
            )
          ) {
            markersToClear.add(attemptKey);
            await emitPayoutEvidence();
            paid++;
          }
          continue;
        }
        if (seen.status === "unknown") {
          console.warn(
            `[indexfund-cron] redemption payout for ${entry._id.toString()} failed (holder credit unproven with ${paidAmount} anchor debit outstanding; leaving it for the reaper)`
          );
          continue;
        }
        await refundMarkedDebit(db, fund._id, attemptKey, {
          amountAnchor: paidAmount,
          units: burnUnits,
        });
        availableCash += paidAmount;
        await restoreQueueClaim();
        continue;
      }
      // Conditional finalize: a concurrent resolver that already finalized or
      // restored this row wins, and this attempt must not audit twice. A
      // lost race after our credit landed is resolved from durable truth
      // (resolveLostFinalizeRace): the reaper may have refunded the debit
      // while we were stalled, leaving our credit unbacked.
      if (
        !(await finalizePayoutBookkeeping(
          db,
          entry._id,
          attemptKey,
          receipt,
          entry.paidAmountAnchor ?? 0
        ))
      ) {
        await resolveLostFinalizeRace(
          db,
          fund._id,
          entry,
          attemptKey,
          paidNative,
          paidAmount,
          fundState.anchorCurrencyCode,
          forexEnabled,
          quote.redeemableUnits
        );
        continue;
      }
      markersToClear.add(attemptKey);
      await emitPayoutEvidence();
    } catch (payoutError) {
      // Resolve from durable truth; never assume which leg landed. The fund
      // marker says whether the debit is outstanding, the holder receipt says
      // whether the credit landed. Both are written atomically with their
      // money legs, so every branch below converges: refund at most once,
      // credit never twice, restore only when nothing is outstanding.
      const fail = (message: string) =>
        console.warn(
          `[indexfund-cron] redemption payout for ${entry._id.toString()} failed (${message}):`,
          payoutError instanceof Error ? payoutError.message : payoutError
        );
      let marker: DebitMarkerRead;
      try {
        marker = await readDebitMarker(db, fund._id, attemptKey);
      } catch {
        marker = { status: "unknown" };
      }
      if (marker.status === "unknown") {
        // Cannot tell whether the debit landed: leave the journaled row for
        // the reaper, which retries the same truth reads. Do not restore (a
        // replay could double-pay) and do not refund blind (could double-
        // refund against a concurrent resolver).
        fail("fund marker unreadable; leaving it for the reaper");
        continue;
      }
      if (marker.status === "absent" && !fundDebited) {
        // The debit never landed (or a concurrent resolver already refunded
        // it): nothing moved, so the claim is safe to restore.
        try {
          await restoreQueueClaim();
        } catch {
          // Claim restore failed: the row stays journaled `processing` for
          // the reaper rather than being paid twice.
        }
        fail("rolled back before any money moved");
        continue;
      }
      let seen: HolderReceiptRead;
      try {
        seen = await readHolderReceipt(db, entry, attemptKey);
      } catch {
        seen = { status: "unknown" };
      }
      if (seen.status === "credited") {
        // The holder was paid: complete the bookkeeping without moving money.
        // A lost finalize race just skips the evidence rows (at most a
        // missing audit row, never a double-book).
        try {
          if (
            await finalizePayoutBookkeeping(
              db,
              entry._id,
              attemptKey,
              {
                amountAnchor: seen.receipt.amountAnchor,
                remainingUnits: seen.receipt.remainingUnits,
                nav: seen.receipt.nav,
              },
              entry.paidAmountAnchor ?? 0
            )
          ) {
            markersToClear.add(attemptKey);
            await emitPayoutEvidence();
            paid++;
          }
        } catch {
          // Finalize failed: the journaled row stays for the reaper, which
          // finalizes from the same receipt without moving money.
        }
        fail("holder was already paid; finalized without moving money");
        continue;
      }
      if (seen.status === "unknown" || seen.status === "holder-missing") {
        // Ambiguous: with a debit outstanding (or possibly outstanding) the
        // credit may have landed. Fail closed — leave the journaled row for
        // the reaper, which quarantines it for a human. Refunding here could
        // mint money; restoring here could replay a paid entry.
        fail("holder credit ambiguous; leaving it for the reaper");
        continue;
      }
      // Definitive non-credit with the debit outstanding, proven by THIS
      // attempt's own synchronous writes (unique attempt key, so a receipt
      // under this key cannot predate us; the row is fresh, so no reaper
      // could have interleaved past the lease): refund exactly once
      // (marker-atomic: a concurrent refund converges to one) and restore.
      // If the marker is already gone a concurrent resolver refunded, and the
      // refund below is a no-op.
      const refunded =
        marker.status === "present"
          ? await refundMarkedDebit(db, fund._id, attemptKey, {
              amountAnchor: marker.marker.amountAnchor,
              units: marker.marker.units,
            })
          : false;
      if (refunded && marker.status === "present") availableCash += marker.marker.amountAnchor;
      try {
        await restoreQueueClaim();
      } catch {
        // Claim restore failed: the row stays journaled `processing` for the
        // reaper. The debit is already refunded exactly once, so the reaper
        // restores with no money movement.
      }
      fail("refunded and restored");
      continue;
    }

    paid++;
  }

  if (markersToClear.size > 0) {
    const unset: Record<string, ""> = {};
    for (const key of markersToClear) unset[debitMarkerPath(key)] = "";
    await db.collection<IndexFund>("indexFunds").updateOne({ _id: fund._id }, { $unset: unset });
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
  const [bondDeployThresholds, bondDeployTurnLengthMinutes] = await Promise.all([
    loadTxThresholds(db),
    loadTurnLengthMinutes(db),
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
          }
        );
        if (bondDeploy.deployedAnchor > 0) {
          result.bondDeployments++;
        }
      }
      navReadyFundIds.push(preparation.fund._id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fund ${preparation.fund.slug}: ${message}`);
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
        waivedIds
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
  for (const fund of funds) {
    try {
      // `funds` was just re-read above and nothing writes between; the old
      // per-fund re-read here was a duplicate round trip.
      const refreshedFund = fund;

      const hasQueuedRedemptions = queuedUnitsByFundId.has(fund._id.toString());
      const paidRedemptions = hasQueuedRedemptions
        ? await processQueuedRedemptions(db, refreshedFund, forexEnabled, currentTurn)
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
      (fund) => !queuedUnitsByFundId.has(fund._id.toString())
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
