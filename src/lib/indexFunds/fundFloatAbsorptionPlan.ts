import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFund, IndexFundTargetConstituent } from "@/lib/db/types";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import {
  allocatePublicFloatAbsorption,
  calculateHourlyPublicFloatAbsorptionCap,
  type FloatAbsorptionAllocation,
} from "@/lib/indexFunds/publicFloatAbsorption";
import { convertLocalPriceToAnchor } from "@/lib/indexFunds/fundHoldingsValuation";

export type CorpFloatRow = {
  _id: ObjectId;
  publicFloat?: number;
  totalShares: number;
  sharePrice: number;
  fundamentalSharePrice?: number;
  liquidCurrencyCode?: CurrencyCode;
};

export type PlannedFloatPurchase = {
  fundId: ObjectId;
  corporationId: ObjectId;
  filledShares: number;
  sharePriceAnchor: number;
};

/**
 * Plan per-fund float purchases for one cron pass.
 * Splits each corporation's per-turn absorption cap fairly across funds by target weight.
 */
export function planFloatAbsorptionAcrossFunds(
  funds: IndexFund[],
  corps: CorpFloatRow[],
  exchangeRates: Partial<Record<CurrencyCode, number>>,
  absorptionRemainingByCorpId: Map<string, number>
): PlannedFloatPurchase[] {
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));
  const plans: PlannedFloatPurchase[] = [];

  for (const [corpKey, corp] of corpMap) {
    const publicFloat = corp.publicFloat ?? 0;
    if (publicFloat <= 0) continue;

    const remainingCap =
      absorptionRemainingByCorpId.get(corpKey) ??
      calculateHourlyPublicFloatAbsorptionCap({
        totalShares: corp.totalShares,
        publicFloat,
      });
    if (remainingCap <= 0) continue;

    const bids: FloatAbsorptionAllocation[] = [];

    for (const fund of funds) {
      if (fund.status !== "active" || fund.targetConstituents.length === 0) continue;

      const target = fund.targetConstituents.find((t) => t.corporationId.toString() === corpKey);
      if (!target || target.targetWeight <= 0) continue;

      const executionPrice = resolveShareExecutionPrice(corp);
      const sharePriceAnchor = convertLocalPriceToAnchor(
        executionPrice,
        corp.liquidCurrencyCode,
        exchangeRates
      );
      if (sharePriceAnchor === null || sharePriceAnchor <= 0) continue;

      const requestedShares = Math.min(
        publicFloat,
        Math.max(1, Math.floor(remainingCap * target.targetWeight))
      );
      if (requestedShares <= 0) continue;

      bids.push({
        id: `${fund._id.toString()}:${corpKey}`,
        requestedShares,
        weight: target.targetWeight,
      });
    }

    if (bids.length === 0) continue;

    bids.sort((a, b) => a.id.localeCompare(b.id));
    const fills = allocatePublicFloatAbsorption(remainingCap, bids);
    let totalFilled = 0;

    for (const fill of fills) {
      if (fill.filledShares <= 0) continue;
      const [fundIdStr] = fill.id.split(":");
      const fund = funds.find((f) => f._id.toString() === fundIdStr);
      if (!fund) continue;

      const executionPrice = resolveShareExecutionPrice(corp);
      const sharePriceAnchor = convertLocalPriceToAnchor(
        executionPrice,
        corp.liquidCurrencyCode,
        exchangeRates
      );
      if (sharePriceAnchor === null || sharePriceAnchor <= 0) continue;

      plans.push({
        fundId: fund._id,
        corporationId: corp._id,
        filledShares: fill.filledShares,
        sharePriceAnchor,
      });
      totalFilled += fill.filledShares;
    }

    if (totalFilled > 0) {
      absorptionRemainingByCorpId.set(corpKey, Math.max(0, remainingCap - totalFilled));
      corp.publicFloat = Math.max(0, publicFloat - totalFilled);
    }
  }

  return plans;
}

export type { IndexFundTargetConstituent };
