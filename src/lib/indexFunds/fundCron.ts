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
export { executeFundShareBuy, type FundShareBuyBatch } from "./fundFloatBuyExecution";
import { processQueuedRedemptions } from "./processQueuedRedemptions";
export { processQueuedRedemptions } from "./processQueuedRedemptions";
import { assertTransactionSupportAtBoot } from "@/lib/db/transactionSupport";
import { substepMarker } from "@/lib/observability/phaseSubsteps";
import type { Db } from "mongodb";
import type { GameConfig, IndexFund, IndexFundTransaction } from "@/lib/db/types";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import {
  getFundById,
  listFundsByIds,
  listActiveFunds,
  listServiceableFunds,
  updateFundNav,
  insertFundSnapshotsBulk,
  setFundStatus,
  insertFundTransactionsBulk,
} from "@/lib/indexFunds/fundQueries";
import { calculateBackingRatio } from "@/lib/indexFunds/unitAccounting";
import { loadActiveWaiverIds, resolveDueListingPetitions } from "./petitions/service";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
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
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { corpLiquidCapitalToAnchor, fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import { calculateHourlyPublicFloatAbsorptionCap } from "@/lib/indexFunds/publicFloatAbsorption";
import {
  executeFundCrossRebalancing,
  planFundCrossRebalancing,
  type CrossRebalanceResult,
} from "@/lib/indexFunds/fundCrossRebalancing";
import { loadTxThresholds } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { type CurrencyCode } from "@/lib/constants/currencies";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionUnitsByFundId,
} from "@/lib/indexFunds/fundValuation";
import { refreshEquityLiquidityFacility } from "@/lib/indexFunds/equityLiquidityFacility";
import { boundedParallelMap } from "@/lib/indexFunds/boundedParallelMap";
import {
  INDEX_FUND_NAV_CONCURRENCY,
  loadExchangeRates,
  loadIndexFundCandidateCorporations,
  applyMarkToMarketIfNeeded,
  shouldRebalanceIndexFundConstituents,
  shouldRunCrossFundRebalancing,
  rebalanceFundToTarget,
  rebalanceConstituents,
  type FundCronResult,
} from "./fundCronRebalance";
export {
  INDEX_FUND_NAV_CONCURRENCY,
  shouldRebalanceIndexFundConstituents,
  shouldRunCrossFundRebalancing,
  rebalanceFundToTarget,
  rebalanceConstituents,
} from "./fundCronRebalance";
export type { FundCronResult, RebalanceOutcome } from "./fundCronRebalance";

// ── Types ─────────────────────────────────────────────────────────────

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
