import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFund } from "@/lib/db/types/indexFund";
import { INDEX_FUND_MAX_EQUITY_ALLOCATION } from "@/lib/indexFunds/unitAccounting";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { convertLocalPriceToAnchor } from "@/lib/indexFunds/fundHoldingsValuation";
import { calculateHourlyPublicFloatAbsorptionCap } from "@/lib/indexFunds/publicFloatAbsorption";

export type RebalanceCorpRow = {
  _id: ObjectId;
  sharePrice: number;
  fundamentalSharePrice?: number;
  totalShares: number;
  publicFloat?: number;
  liquidCurrencyCode?: CurrencyCode;
};

export type RebalanceLeg = {
  corporationId: ObjectId;
  shares: number;
  sharePriceAnchor: number;
  valueAnchor: number;
};

export type FundRebalancePlan = {
  buys: RebalanceLeg[];
  sells: RebalanceLeg[];
  bids: RebalanceLeg[];
};

export function planFundTargetRebalance(input: {
  fund: Pick<
    IndexFund,
    "_id" | "anchorCurrencyCode" | "cashAnchor" | "holdings" | "targetConstituents"
  >;
  corps: RebalanceCorpRow[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  bondPrincipalAnchor: number;
  capRemainingByCorpId?: Map<string, number>;
}): FundRebalancePlan {
  const { fund, corps, exchangeRates, bondPrincipalAnchor, capRemainingByCorpId } = input;

  // Step 1: compute holdings value
  const holdingsValueAnchor = fund.holdings.reduce((sum, h) => {
    return sum + (h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0));
  }, 0);

  // Step 2: total backing
  const totalBackingAnchor = fund.cashAnchor + holdingsValueAnchor + bondPrincipalAnchor;
  if (totalBackingAnchor <= 0) return { buys: [], sells: [], bids: [] };

  // Step 3: max equity value (used for budget guard; target sizing uses cashAnchor directly so
  // that targetWeight = fraction of deployable cash, independent of illiquid holdings value).
  const maxEquityValueAnchor = INDEX_FUND_MAX_EQUITY_ALLOCATION * totalBackingAnchor;

  // Step 4: current shares by corpId
  const sharesByCorp = new Map<string, number>();
  for (const h of fund.holdings) {
    sharesByCorp.set(h.corporationId.toString(), h.shares);
  }

  // Step 5: union of corp ids
  const allCorpIds = new Set<string>();
  for (const h of fund.holdings) allCorpIds.add(h.corporationId.toString());
  for (const tc of fund.targetConstituents) allCorpIds.add(tc.corporationId.toString());

  // Build corp map
  const corpMap = new Map<string, RebalanceCorpRow>();
  for (const c of corps) corpMap.set(c._id.toString(), c);

  // Build target constituent map
  const targetMap = new Map<string, number>();
  for (const tc of fund.targetConstituents) {
    targetMap.set(tc.corporationId.toString(), tc.targetWeight);
  }

  const pendingBuys: RebalanceLeg[] = [];
  const pendingBids: RebalanceLeg[] = [];
  const sells: RebalanceLeg[] = [];

  // Step 6: per-corp logic
  for (const idStr of allCorpIds) {
    const corp = corpMap.get(idStr);
    if (!corp) continue; // skip if no corp row

    const priceAnchor = convertLocalPriceToAnchor(
      resolveShareExecutionPrice(corp),
      corp.liquidCurrencyCode,
      exchangeRates
    );
    if (priceAnchor == null || priceAnchor <= 0) continue;

    const targetWeight = targetMap.get(idStr) ?? 0;
    // Target value is the fraction of the 75% equity bucket to allocate to this constituent.
    const targetValueAnchor = targetWeight * maxEquityValueAnchor;
    const targetShares = Math.floor(targetValueAnchor / priceAnchor);
    const currentShares = sharesByCorp.get(idStr) ?? 0;
    const driftShares = currentShares - targetShares;

    if (driftShares < 0) {
      // Underweight — buy from float now, bid for residual
      const float = corp.publicFloat ?? 0;
      const deficit = -driftShares;

      // Per-turn rate cap from cross-fund planner (or fallback to raw share rate).
      // capRemainingByCorpId may carry a float-clamped value; for bid sizing we use
      // the unclamped rate floor(totalShares/100) so residuals are non-zero when
      // float < rate limit.
      const rawRateCap = Math.max(1, Math.floor(corp.totalShares / 100));
      const cappedDeficit = Math.min(deficit, rawRateCap);

      // Float absorption cap (clamped to float) bounds what can be bought immediately.
      const floatAbsorptionCap =
        float > 0
          ? calculateHourlyPublicFloatAbsorptionCap({
              totalShares: corp.totalShares,
              publicFloat: float,
            })
          : 0;
      const floatBuyableShares = Math.min(cappedDeficit, floatAbsorptionCap, float);

      // Honour the shared cross-fund cap for the float buy side only.
      const crossFundCap = capRemainingByCorpId?.get(idStr);
      const effectiveFloatBuy =
        crossFundCap != null ? Math.min(floatBuyableShares, crossFundCap) : floatBuyableShares;
      if (effectiveFloatBuy > 0) {
        pendingBuys.push({
          corporationId: corp._id,
          shares: effectiveFloatBuy,
          sharePriceAnchor: priceAnchor,
          valueAnchor: effectiveFloatBuy * priceAnchor,
        });
      }

      // Residual deficit that float cannot supply this turn → standing limit bid.
      // Bids are not float-rate-capped (they rest on the book until filled/expired).
      const residualShares = cappedDeficit - effectiveFloatBuy;
      if (residualShares > 0) {
        pendingBids.push({
          corporationId: corp._id,
          shares: residualShares,
          sharePriceAnchor: priceAnchor,
          valueAnchor: residualShares * priceAnchor,
        });
      }
    } else if (driftShares > 0) {
      // Overweight — sell
      const sellCap = Math.max(1, Math.floor(corp.totalShares / 100));
      const sellShares = Math.min(driftShares, sellCap, currentShares);
      if (sellShares > 0) {
        sells.push({
          corporationId: corp._id,
          shares: sellShares,
          sharePriceAnchor: priceAnchor,
          valueAnchor: sellShares * priceAnchor,
        });
      }
    }
  }

  // Step 7: apply cash budget to buys (greedy, sorted descending by valueAnchor).
  // Budget = min(equity headroom, available cash) — the 25% reserve stays uninvested.
  const stockBudgetAnchor = Math.max(
    0,
    Math.min(maxEquityValueAnchor - holdingsValueAnchor, fund.cashAnchor)
  );
  pendingBuys.sort((a, b) => b.valueAnchor - a.valueAnchor);

  let remaining = stockBudgetAnchor;
  const buys: RebalanceLeg[] = [];
  for (const leg of pendingBuys) {
    if (remaining <= 0) break;
    if (leg.sharePriceAnchor > remaining) continue; // can't afford even 1 share
    const affordableShares = Math.floor(remaining / leg.sharePriceAnchor);
    const finalShares = Math.min(leg.shares, affordableShares);
    if (finalShares <= 0) continue;
    const finalValue = finalShares * leg.sharePriceAnchor;
    buys.push({ ...leg, shares: finalShares, valueAnchor: finalValue });
    remaining -= finalValue;

    // Step 8: decrement shared cap
    if (capRemainingByCorpId) {
      const idStr = leg.corporationId.toString();
      const prev = capRemainingByCorpId.get(idStr) ?? 0;
      capRemainingByCorpId.set(idStr, Math.max(0, prev - finalShares));
    }
  }

  // Step 9: bound bid legs by remaining cash budget after float buys.
  const bids: RebalanceLeg[] = [];
  for (const leg of pendingBids) {
    if (remaining <= 0) break;
    if (leg.sharePriceAnchor > remaining) continue;
    const affordableShares = Math.floor(remaining / leg.sharePriceAnchor);
    const finalShares = Math.min(leg.shares, affordableShares);
    if (finalShares <= 0) continue;
    const finalValue = finalShares * leg.sharePriceAnchor;
    bids.push({ ...leg, shares: finalShares, valueAnchor: finalValue });
    remaining -= finalValue;
  }

  return { buys, sells, bids };
}
