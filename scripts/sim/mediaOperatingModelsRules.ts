/** Run with `npx tsx scripts/sim/mediaOperatingModelsRules.ts`. */

import {
  MEDIA_OPERATING_MODELS,
  mediaOperatingModelOutputRates,
} from "@/lib/mediaOperatingModels/catalog";
import {
  getMediaOperatingModelStrategies,
  SECTOR_STRATEGIES,
} from "@/lib/constants/sectorStrategies";
import { addSettledPoliticalAttention } from "@/lib/mediaOperatingModels/reach";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { impliedOutputUnits } from "@/lib/market/capital";
import {
  capacityRescaleRatio,
  defaultSupplyRates,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";

const LANES = ["media", "entertainment"] as const;

function rateTotal(rates: Partial<Record<CommodityType, number>>): number {
  return Object.values(rates).reduce<number>((total, rate) => total + (rate ?? 0), 0);
}

function cleanRates(
  rates: Partial<Record<CommodityType, number>>
): Partial<Record<CommodityType, number>> {
  return Object.fromEntries(
    Object.entries(rates).map(([commodity, rate]) => [commodity, round(rate ?? 0)])
  );
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const models = LANES.flatMap((lane) => {
  const baseline = SECTOR_STRATEGIES[lane].find((strategy) => strategy.id === "standard")!;
  const baselineValueBudget = rateTotal(baseline.supply);
  return getMediaOperatingModelStrategies(lane).map((strategy) => {
    const catalog = MEDIA_OPERATING_MODELS.find((model) => model.id === strategy.id)!;
    const seedDefault = defaultSupplyRates(lane);
    const seedDefaultUsesStandard =
      rateTotal(seedDefault) === rateTotal(baseline.supply) &&
      Object.keys(seedDefault).every(
        (commodity) =>
          seedDefault[commodity as CommodityType] === baseline.supply[commodity as CommodityType]
      );
    const outputValue = rateTotal(strategy.supply);
    const baselineMixPrice =
      1_000_000 / impliedOutputUnits(1_000_000, baseline.supply, COMMODITY_BASE_PRICES, 1);
    const modelMixPrice =
      1_000_000 / impliedOutputUnits(1_000_000, strategy.supply, COMMODITY_BASE_PRICES, 1);
    const rescaleRatio = capacityRescaleRatio(lane, "standard", strategy.id);
    const queue = [{ unitsOrdered: 250, costPaidAnchor: 17_500, strategyId: "standard" }];
    const rescaledQueue = rescaleBuildQueueForStrategyChange(queue, rescaleRatio);
    const capacityValuePreserved =
      Math.abs(1_000 * rescaleRatio * modelMixPrice - 1_000 * baselineMixPrice) < 1e-6;
    const queueValuePreserved =
      Math.abs(
        rescaledQueue[0].unitsOrdered * modelMixPrice - queue[0].unitsOrdered * baselineMixPrice
      ) < 1e-6 && rescaledQueue[0].costPaidAnchor === queue[0].costPaidAnchor;
    const nominalRates = mediaOperatingModelOutputRates(baseline.supply, {
      advertising: strategy.supply.advertising ? strategy.supply.advertising / outputValue : 0,
      entertainment_services: strategy.supply.entertainment_services
        ? strategy.supply.entertainment_services / outputValue
        : 0,
    });
    return {
      lane,
      id: strategy.id,
      model: catalog.name,
      availableFromYear: catalog.availableFromYear,
      currentTech: catalog.technologies[lane],
      baselineOutputValueBudget: round(baselineValueBudget),
      modelOutputValueBudget: round(outputValue),
      outputRates: cleanRates(strategy.supply),
      inputRates: cleanRates(strategy.demand),
      capacityRescaleRatio: round(rescaleRatio),
      capacityValuePreserved,
      buildQueuePaidValuePreserved: queueValuePreserved,
      sharesRecomposeToBaselineBudget:
        Math.abs(rateTotal(nominalRates) - baselineValueBudget) < 1e-9,
      eligibleIn1991: catalog.availableFromYear <= 1991,
      seedDefaultUsesStandard,
      costsUseExistingInputBasket: true,
    };
  });
});

const reach = addSettledPoliticalAttention({
  commercialOutletsByState: new Map([
    [
      "US-CA",
      [
        {
          corporationId: "outlet",
          stance: { economic: 0, social: 0 },
          audienceShare: 1,
          attentionUnits: 100,
        },
      ],
    ],
  ]),
  settledOrders: [
    {
      orderId: "paid-order",
      status: "settled",
      identity: { targetStateId: "US-CA" },
      settlementPlan: {
        sellers: [{ allocationId: "seller-1", corporationId: "political-outlet", units: 40 }],
      },
    },
    {
      orderId: "unpaid-plan",
      status: "settling",
      identity: { targetStateId: "US-CA" },
      settlementPlan: {
        sellers: [{ allocationId: "seller-2", corporationId: "outlet", units: 60 }],
      },
    },
  ],
  stanceByCorporationId: new Map(),
});

const result = {
  title: "Media operating-model production rules",
  inputs:
    "Checked-in strategy/catalog constants only; no database, seed mutation, or world simulation.",
  year: 1991,
  nominalOutputRule:
    "Model output rates are value shares of the existing standard nominal output budget.",
  inputCostRule:
    "Each model keeps the demand rates of its named existing sector-strategy input basket.",
  selectionRule:
    "Existing tech unlock and paid retool command are required; models are not seed grants.",
  politicalReachRule:
    "Only completed seller allocations contribute political attention; an unsettled plan contributes zero.",
  models,
  reachExample: {
    commercialUnits: 100,
    settledPoliticalUnits: 40,
    unsettledPoliticalUnitsExcluded: 60,
    resultingAudienceShares: Object.fromEntries(
      (reach.get("US-CA") ?? []).map((outlet) => [
        outlet.corporationId,
        round(outlet.audienceShare),
      ])
    ),
  },
};

if (
  models.some(
    (model) =>
      !model.sharesRecomposeToBaselineBudget ||
      !model.capacityValuePreserved ||
      !model.buildQueuePaidValuePreserved ||
      !model.seedDefaultUsesStandard
  )
) {
  throw new Error("A model output mix failed nominal or capacity value conservation.");
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
