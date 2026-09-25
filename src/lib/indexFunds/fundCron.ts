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
  IndexFundRedemptionQueueEntry,
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
 * Age past which a `processing` redemption row is owned by a dead worker.
 * A single payout claim-to-finalize is milliseconds of sequential writes, so
 * five minutes means the owner crashed mid-settlement, not that it is slow.
 */
export const STALE_REDEMPTION_PROCESSING_MS = 5 * 60 * 1000;

export interface RedemptionReapResult {
  reaped: number;
  restored: number;
  refunded: number;
  finalized: number;
  skippedLegacy: number;
}

/** Refund one queued-redemption fund debit (cash, plus supply for legacy-burn rows). */
async function refundRedemptionDebit(
  db: Db,
  fundId: IndexFund["_id"],
  paidAmount: number,
  burnUnits: number
): Promise<void> {
  const inc: Record<string, number> = { cashAnchor: paidAmount };
  if (burnUnits > 0) inc.unitSupply = burnUnits;
  const result = await db
    .collection<IndexFund>("indexFunds")
    .updateOne({ _id: fundId }, { $inc: inc, $set: { updatedAt: new Date() } });
  if (result.matchedCount !== 1) {
    throw new Error("Failed to refund queued-redemption debit: fund missing");
  }
}

/**
 * Reconcile this fund's stale `processing` redemption rows after a crash
 * (#2223). The payout journal on each row (`processingAttempt`) says exactly
 * how far the dead attempt got:
 * - no journal (legacy row) — left untouched for manual reconciliation. The
 *   old code could strand these either side of the holder credit, so replaying
 *   them blind risks a double payout.
 * - journaled, no fund debit — nothing moved; restore to the pre-claim status.
 * - journaled debit, no holder credit — the fund debit is outstanding; refund
 *   it, then restore to the pre-claim status so the entry is payable again.
 * - journaled holder credit — both money legs landed; finalize the queue
 *   bookkeeping (status, paid totals) without moving money again. Audit rows
 *   (fund transaction, ledger) are evidence only and are NOT re-emitted here:
 *   the crash may have landed them already, and a duplicate audit row is
 *   worse than a missing one. A post-finalize crash leaves money and queue
 *   state correct with at most a missing audit row.
 *
 * Reaper claims are atomic (exact `processingStartedAt` match), so concurrent
 * reapers resolve each row exactly once. Callers must still assume single
 * cron ownership per fund per turn: the lease only bites rows older than
 * `staleAfterMs`, and an owner stalled past the lease while its row is
 * reaped can still finish its own writes.
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
    if (!attempt || (attempt.from !== "queued" && attempt.from !== "partial")) {
      result.skippedLegacy++;
      skippedIds.push(row._id.toString());
      continue;
    }
    result.reaped++;
    if (attempt.creditApplied) {
      const remaining = Math.max(0, attempt.payoutRemainingUnits ?? 0);
      const nav = attempt.payoutNav ?? 0;
      await queue.updateOne(
        { _id: row._id, status: "processing" },
        {
          $set: {
            status: redemptionEntryStatusAfterPayout(remaining),
            paidAmountAnchor: (fresh.paidAmountAnchor ?? 0) + (attempt.debitAnchor ?? 0),
            units: remaining,
            requestedAmountAnchor: remaining * nav,
            updatedAt: new Date(),
          },
          $unset: { processingStartedAt: "", processingAttempt: "" },
        }
      );
      result.finalized++;
      continue;
    }
    if (attempt.debitAnchor !== undefined && attempt.debitAnchor > 0) {
      await refundRedemptionDebit(db, fundId, attempt.debitAnchor, attempt.debitUnits ?? 0);
      result.refunded++;
    }
    await queue.updateOne(
      { _id: row._id, status: "processing" },
      {
        $set: { status: attempt.from, updatedAt: new Date() },
        $unset: { processingStartedAt: "", processingAttempt: "" },
      }
    );
    result.restored++;
  }
  if (skippedIds.length > 0) {
    console.warn(
      `[indexfund-cron] ${skippedIds.length} stale processing redemption(s) left for manual reconciliation (no recovery journal): ${skippedIds.join(", ")}`
    );
  }
  return result;
}

/**
 * Credit one queued-redemption payout to its holder. Returns true when the
 * holder was credited, false when there is no holder to credit (unknown
 * holder shape, or the holder document is gone). Throws on write failure so
 * the caller can refund the fund debit.
 */
async function creditRedemptionHolder(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean
): Promise<boolean> {
  const now = new Date();
  if (entry.characterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db
      .collection("characters")
      .updateOne({ _id: entry.characterId }, { $inc: inc, $set: { updatedAt: now } });
    return creditResult.matchedCount !== 0;
  }
  if (entry.imperialCharacterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db
      .collection("imperialCharacters")
      .updateOne({ _id: entry.imperialCharacterId }, { $inc: inc, $set: { updatedAt: now } });
    return creditResult.matchedCount !== 0;
  }
  if (entry.nppId) {
    // NPP investment cash stays in anchor (₳): the redeemFxRate wallet
    // multiplier applies to character/imperial credits only.
    const creditResult = await db.collection("npps").updateOne(
      { _id: entry.nppId },
      {
        $inc: { nppInvestmentCashAnchor: paidAmountAnchor },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  return false;
}

export async function processQueuedRedemptions(
  db: Db,
  fund: IndexFund,
  forexEnabled: boolean,
  currentTurn: number,
  recovery?: { staleAfterMs?: number }
): Promise<number> {
  // Reconcile the previous pass's interrupted payouts before paying new ones,
  // so a crashed turn's stranded rows are refunded or finalized exactly once
  // instead of quarantined in `processing` forever.
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

  for (const pendingEntry of pending) {
    // Claim before any fund debit or holder credit. The claim journals the
    // pre-claim status on the row (#2223) so a crash later in this payout can
    // be reconciled: restored when nothing moved, refunded when only the fund
    // debit landed, finalized when the holder credit landed. Replay stays
    // unsafe without that journal, which is why the reaper replays journaled
    // rows but leaves marker-less legacy rows for manual reconciliation.
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
            processingStartedAt: new Date(),
            processingAttempt: { from: pendingEntry.status },
            updatedAt: new Date(),
          },
        },
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
            $unset: { processingStartedAt: "", processingAttempt: "" },
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
      await sellFundHoldingsForRedemptionCash(db, fundState, entryObligation - availableCash, {
        note: "Queued redemption liquidity",
      });
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
    // The debit-to-credit window below is the interruption boundary (#2223):
    // any throw between the debit landing and the holder credit landing
    // refunds the debit and restores the claim, so a partial failure can
    // neither strand fund cash nor double-pay on retry. Each entry is isolated
    // (continue, not break) so one entry's transient failure does not starve
    // the rest of the queue.
    const burnUnits = shouldBurnUnitsNow ? quote.redeemableUnits : 0;
    const remainingAfterPay = quote.queuedUnits;
    let fundDebited = false;
    try {
      const debitResult = await db.collection<IndexFund>("indexFunds").updateOne(debitFilter, {
        $inc: debitInc,
        $set: { updatedAt: new Date() },
      });
      if (debitResult.matchedCount === 0) {
        await restoreQueueClaim();
        break;
      }
      fundDebited = true;
      availableCash -= paidAmount;
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing" },
          {
            $set: {
              "processingAttempt.debitAnchor": paidAmount,
              "processingAttempt.debitUnits": burnUnits,
              updatedAt: new Date(),
            },
          }
        );

      const holderCredited = await creditRedemptionHolder(
        db,
        entry,
        paidNative,
        paidAmount,
        fundState.anchorCurrencyCode,
        forexEnabled
      );
      if (!holderCredited) {
        // Holder gone (or no holder on the row) — refund the fund debit and
        // skip this entry without paying it.
        await refundRedemptionDebit(db, fund._id, paidAmount, burnUnits);
        availableCash += paidAmount;
        await restoreQueueClaim();
        continue;
      }
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing" },
          {
            $set: {
              "processingAttempt.creditApplied": true,
              "processingAttempt.payoutUnits": quote.redeemableUnits,
              "processingAttempt.payoutRemainingUnits": remainingAfterPay,
              "processingAttempt.payoutNav": redemptionNav,
              updatedAt: new Date(),
            },
          }
        );
    } catch (payoutError) {
      if (fundDebited) {
        try {
          await refundRedemptionDebit(db, fund._id, paidAmount, burnUnits);
          availableCash += paidAmount;
        } catch {
          // Refund failed: the journaled debit marker stays on the row, so
          // the reaper (or manual reconciliation) refunds it exactly once
          // instead of losing the cash.
        }
      }
      try {
        await restoreQueueClaim();
      } catch {
        // Claim restore failed: the row stays journaled `processing` for the
        // reaper rather than being paid twice.
      }
      console.warn(
        `[indexfund-cron] redemption payout for ${entry._id.toString()} failed and was rolled back:`,
        payoutError instanceof Error ? payoutError.message : payoutError
      );
      continue;
    }

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
        $unset: { processingStartedAt: "", processingAttempt: "" },
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
