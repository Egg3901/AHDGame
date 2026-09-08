/** Targeted ad quotes show the same regional audience response used by counting. */
import type { CountryId } from "@/lib/constants/countries";
import type { Db } from "mongodb";
import { badRequest } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { campaignLocalRate, loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { loadCampaignAudience } from "./audience";
import {
  AD_ACTION_COST,
  AD_MAX_ACTIONS,
  AD_BONUS_CAP,
  AD_BOOST_PER_ACTION,
  currentAdBonus,
  adPurchaseCost,
  adExposure,
  planAdPurchase,
  targetAudience,
  targetedAdBonuses,
  type CampaignTarget,
  type TargetedAd,
} from "./rules";

export async function quoteAdAudience(
  db: Db,
  countryId: CountryId,
  stateId: string,
  policies: { economic: number; social: number },
  ads: TargetedAd[],
  revision: number,
  currentTurn: number,
  count = 1
) {
  const audience = await loadCampaignAudience(db, countryId, stateId);
  if (!audience) throw badRequest("This region has no targetable electorate");
  const position = { economicLean: policies.economic, socialLean: policies.social };
  const forex = await isForexEnabled();
  const rate = forex ? campaignLocalRate(countryId, await loadCampaignCurrencyRates(db)) : 1;
  const unique = new Map<string, CampaignTarget>();
  for (const cell of audience.cells)
    for (const [dimension, bucket] of Object.entries(cell.buckets))
      unique.set(`${dimension}:${bucket}`, { dimension, bucket });
  const current = targetedAdBonuses(audience.cells, position, ads, stateId, currentTurn);
  const targets = [...unique.values()].map((target) => {
    const info = targetAudience(audience.cells, target)!;
    const maxCount = Math.min(
      AD_MAX_ACTIONS,
      Math.ceil(
        Math.max(
          0,
          AD_BONUS_CAP - currentAdBonus(ads, { ...target, stateId }, currentTurn) - 1e-10
        ) / AD_BOOST_PER_ACTION
      )
    );
    const planned = planAdPurchase(ads, { ...target, stateId }, currentTurn, count);
    const after = targetedAdBonuses(audience.cells, position, planned ?? ads, stateId, currentTurn);
    const mean = (bonuses: Record<string, number>) =>
      audience.cells.reduce(
        (sum, cell) =>
          sum +
          (cell.buckets[target.dimension] === target.bucket
            ? (cell.share * (bonuses[cell.id] ?? 0)) / info.share
            : 0),
        0
      );
    const active = ads.find(
      (ad) =>
        ad.stateId === stateId && ad.dimension === target.dimension && ad.bucket === target.bucket
    );
    return {
      ...target,
      audienceShare: info.share,
      eligibleAudience: Math.round(audience.context.statePopulation * info.share),
      cohesion: info.cohesion,
      cost: adPurchaseCost(1) * rate,
      currentBonus: mean(current),
      afterBonus: mean(after),
      exposure: active ? adExposure(active, currentTurn) : 0,
      maxCount,
      available: planned !== null && count <= maxCount,
    };
  });
  return {
    enabled: true as const,
    targets,
    actionCost: AD_ACTION_COST,
    currentTurn: currentTurn,
    revision,
    maxCount: AD_MAX_ACTIONS,
    count,
    stateId,
    forex,
    rate,
  };
}
