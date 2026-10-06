/**
 * Public float purchases for index funds: one trade at a time, or a whole
 * rebalance's buys for one fund as a single recoverable settlement batch.
 *
 * Both paths price a purchase identically (`quoteFundShareBuy`) and judge it
 * with the same refusal rules, so the batch changes how many round trips the
 * commit costs, never which trades fill or what they cost.
 */
import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { EquityMarketPool, IndexFundHolding } from "@/lib/db/types";
import type { IndexFundCandidate } from "@/lib/indexFunds/constituents";
import { loadEquityPoolsByCurrency, loadEquityQuote } from "@/lib/equities/marketPool";
import {
  claimFundFloatPlan,
  settleFundFloatPlan,
  type SettlementFund,
} from "./fundFloatSettlement";
import {
  loadFloatAuditContext,
  openFundFloatBatch,
  prepareFundFloatTrade,
  type FloatAuditContext,
} from "./fundFloatTradePlan";

export type FundBuyCorp = IndexFundCandidate & {
  publicFloat?: number;
  fundamentalSharePrice?: number;
  shareBuybackMode?: string;
  liquidCapital?: number;
};

/** The frozen price and cost of buying `shares` of `corp` against the current pool snapshot. */
async function quoteFundShareBuy(
  db: Db,
  corp: FundBuyCorp,
  shares: number,
  referencePriceAnchor: number,
  pools: ReadonlyMap<CurrencyCode, EquityMarketPool>
) {
  const quote = await loadEquityQuote(db, corp, { pools });
  const executionPrice = quote.askPriceLocal;
  const executionPriceAnchor =
    quote.mid > 0 ? referencePriceAnchor * (executionPrice / quote.mid) : referencePriceAnchor;
  return { executionPrice, executionPriceAnchor, actualCost: shares * executionPriceAnchor };
}

export interface FundShareBuyBatch {
  audit?: FloatAuditContext;
  expectedGeneration?: number;
  /** Mutable: each credited buy advances the snapshot's cash so later quotes see it. */
  pools?: Map<CurrencyCode, EquityMarketPool>;
}

export async function executeFundShareBuy(
  db: Db,
  fund: SettlementFund,
  corp: FundBuyCorp,
  shares: number,
  referencePriceAnchor: number,
  currentTurn: number,
  batch?: FundShareBuyBatch
): Promise<{ ok: boolean; sharesBought: number; anchorSpent: number }> {
  const expectedGeneration = batch?.expectedGeneration ?? fund.floatSettlementGeneration ?? 0;
  const pools = batch?.pools ?? (await loadEquityPoolsByCurrency(db));
  const { executionPrice, executionPriceAnchor, actualCost } = await quoteFundShareBuy(
    db,
    corp,
    shares,
    referencePriceAnchor,
    pools
  );
  const audit = batch?.audit ?? (await loadFloatAuditContext(db));
  const prepared = await prepareFundFloatTrade(db, {
    fund,
    corp,
    direction: "buy",
    shares,
    priceLocal: executionPrice,
    priceAnchor: executionPriceAnchor,
    amountAnchor: actualCost,
    turn: currentTurn,
    pools,
    audit,
    expectedGeneration,
    holdingsAfter: (holdings) =>
      updateHoldingAfterPurchase(holdings, corp._id, shares, executionPriceAnchor),
  });
  if (!prepared || !(await claimFundFloatPlan(db, prepared.fund, prepared.plan)))
    return { ok: false, sharesBought: 0, anchorSpent: 0 };
  if (batch) batch.expectedGeneration = (prepared.fund.floatSettlementGeneration ?? 0) + 1;
  if (!(await settleFundFloatPlan(db, fund._id, prepared.plan)))
    return { ok: false, sharesBought: 0, anchorSpent: 0 };
  const pool = pools.get(prepared.currency);
  if (pool) pool.cashLocal += prepared.poolDelta;
  return { ok: true, sharesBought: shares, anchorSpent: actualCost };
}

/** Update the holdings array after buying shares of a constituent. */
export function updateHoldingAfterPurchase(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
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

export interface FundShareBuyLeg {
  corp: FundBuyCorp;
  shares: number;
  referencePriceAnchor: number;
}

/**
 * Buy a fund's whole list of float legs in the given order.
 *
 * Legs are committed as batches (one claim, one journal key). A batch that is
 * refused or loses its claim to a concurrent change of the fund's cash,
 * holdings or settlement generation is fully reversed by the settlement
 * machinery and its legs are then replayed one at a time through
 * `executeFundShareBuy`, which is exactly the sequential behaviour. The pool
 * snapshot is restored before the replay so quotes match what a sequential run
 * would have seen.
 */
export async function executeFundShareBuys(
  db: Db,
  fund: SettlementFund,
  legs: FundShareBuyLeg[],
  currentTurn: number,
  batch: FundShareBuyBatch
): Promise<{ buys: number }> {
  let buys = 0;
  let index = 0;
  const sequential = async (slice: FundShareBuyLeg[]) => {
    for (const leg of slice) {
      const res = await executeFundShareBuy(
        db,
        fund,
        leg.corp,
        leg.shares,
        leg.referencePriceAnchor,
        currentTurn,
        batch
      );
      if (res.ok) buys++;
    }
  };
  const distinct = new Set(legs.map((leg) => leg.corp._id.toString())).size === legs.length;
  if (!distinct || legs.length < 2) {
    await sequential(legs);
    return { buys };
  }
  const pools = batch.pools ?? (await loadEquityPoolsByCurrency(db));
  batch.pools = pools;
  const audit = batch.audit ?? (await loadFloatAuditContext(db));
  batch.audit = audit;
  while (index < legs.length) {
    const remaining = legs.slice(index);
    const open = await openFundFloatBatch(db, {
      fund,
      corps: remaining.map((leg) => leg.corp),
      turn: currentTurn,
      pools,
      audit,
      expectedGeneration: batch.expectedGeneration ?? fund.floatSettlementGeneration ?? 0,
    });
    if (!open) {
      await sequential(remaining);
      return { buys };
    }
    const poolCashBefore = new Map([...pools].map(([code, pool]) => [code, pool.cashLocal]));
    let consumed = 0;
    for (const leg of remaining) {
      const { executionPrice, executionPriceAnchor, actualCost } = await quoteFundShareBuy(
        db,
        leg.corp,
        leg.shares,
        leg.referencePriceAnchor,
        pools
      );
      const added = open.add({
        corp: leg.corp,
        shares: leg.shares,
        priceLocal: executionPrice,
        priceAnchor: executionPriceAnchor,
        amountAnchor: actualCost,
        holdingsAfter: (holdings) =>
          updateHoldingAfterPurchase(holdings, leg.corp._id, leg.shares, executionPriceAnchor),
      });
      if (added.status === "full") break;
      consumed++;
      if (added.status === "accepted") {
        const pool = pools.get(added.currency);
        if (pool) pool.cashLocal += added.poolDelta;
      }
    }
    const handled = remaining.slice(0, consumed);
    const sealed = open.seal();
    index += consumed;
    if (!sealed) continue;
    const restorePools = () => {
      for (const [code, cash] of poolCashBefore) {
        const pool = pools.get(code);
        if (pool) pool.cashLocal = cash;
      }
    };
    const claimed = await claimFundFloatPlan(db, sealed.fund, sealed.plan);
    if (!claimed) {
      restorePools();
      await sequential(handled);
      continue;
    }
    batch.expectedGeneration = (sealed.fund.floatSettlementGeneration ?? 0) + 1;
    if (!(await settleFundFloatPlan(db, fund._id, sealed.plan))) {
      restorePools();
      await sequential(handled);
      continue;
    }
    buys += open.count();
  }
  return { buys };
}
