/** Run with `npx tsx scripts/sim/mediaProductRoi.ts`. */

import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { getMediaOperatingModel } from "@/lib/mediaOperatingModels/catalog";
import { clearCommodityMarket, qualityPremiumMultiplier } from "@/lib/market/clearing";
import { MEDIA_PRODUCT_KINDS } from "@/lib/products/mediaProductCatalog";
import {
  advanceMediaProduct,
  aggregateMediaProductSectorEffects,
  mediaDevelopmentThresholdAnchor,
  startMediaProduct,
} from "@/lib/products/rules/mediaProductRules";

const BOOK_BASIS_ANCHOR = 100_000;
const TITLE_ALLOCATION_SHARE = 0.5;
const DEVELOPMENT_ADVERTISING_ANCHOR_PER_TURN = BOOK_BASIS_ANCHOR * 0.02;
const STARTING_SECTOR_BRAND_LOYALTY = 20;
const DEMAND_UNITS = 1_000;
const SUPPLY_UNITS = 1_000;
const PREMIUM_POSTURE = 0.2;

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function run() {
  const models = MEDIA_PRODUCT_KINDS.map((kind) => {
    const model = getMediaOperatingModel(kind.modelId);
    if (!model) throw new Error(`Missing operating model ${kind.modelId}`);
    const threshold = mediaDevelopmentThresholdAnchor(BOOK_BASIS_ANCHOR);
    const developmentTurns = kind.durations.development ?? 1;
    const researchPerTurn = threshold / developmentTurns;
    const advertisingPerTurn = DEVELOPMENT_ADVERTISING_ANCHOR_PER_TURN;
    let product = startMediaProduct({
      enabled: true,
      activeDevelopment: null,
      kind,
      title: `ROI scenario ${kind.id}`,
      productId: kind.id,
      turn: 0,
      capacityBookAnchor: BOOK_BASIS_ANCHOR,
      allocationShare: TITLE_ALLOCATION_SHARE,
    });
    if (!product) throw new Error(`Could not start scenario for ${kind.id}`);
    for (let index = 1; index <= developmentTurns; index += 1) {
      const progress = advanceMediaProduct({
        product,
        kind,
        receipt: {
          projectId: product.id,
          turn: index,
          amountAnchor: researchPerTurn,
          deliveredAdvertisingAnchor: advertisingPerTurn,
        },
        sectorQuality: 60,
        relevantTechnologyUnlocked: false,
      });
      if (!progress) throw new Error(`Could not progress scenario for ${kind.id}`);
      product = progress.product;
    }
    if (product.stage !== "launch") throw new Error(`Scenario did not launch ${kind.id}`);
    const matureProduct = {
      ...product,
      stage: "mature" as const,
      productBrand: product.productBrand ?? 0,
    };
    const effect = aggregateMediaProductSectorEffects({
      projects: [{ project: { ...matureProduct, allocationShare: TITLE_ALLOCATION_SHARE }, kind }],
      baseQuality: 60,
    });
    const loyaltyBonus = effect.loyaltyBonus;
    const commodity = kind.outputCommodities[0] as CommodityType;
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    const baselineQuality = 60;
    const baselinePremiumPosture = PREMIUM_POSTURE * qualityPremiumMultiplier(baselineQuality);
    const titlePremiumPosture =
      PREMIUM_POSTURE * qualityPremiumMultiplier(effect.quality ?? baselineQuality);
    const sellersWithoutTitleBrand = [
      { id: "media-model", units: SUPPLY_UNITS, posture: baselinePremiumPosture },
      { id: "lower-priced-rival", units: SUPPLY_UNITS, posture: 0 },
    ];
    const withoutTitleBrand = clearCommodityMarket(
      DEMAND_UNITS,
      sellersWithoutTitleBrand,
      new Map([
        ["media-model", STARTING_SECTOR_BRAND_LOYALTY],
        ["lower-priced-rival", STARTING_SECTOR_BRAND_LOYALTY],
      ])
    );
    const sellersWithTitleBrand = [
      { id: "media-model", units: SUPPLY_UNITS, posture: titlePremiumPosture },
      { id: "lower-priced-rival", units: SUPPLY_UNITS, posture: 0 },
    ];
    const withTitleBrand = clearCommodityMarket(
      DEMAND_UNITS,
      sellersWithTitleBrand,
      new Map([
        ["media-model", STARTING_SECTOR_BRAND_LOYALTY + loyaltyBonus],
        ["lower-priced-rival", STARTING_SECTOR_BRAND_LOYALTY],
      ])
    );
    const premiumUnits =
      ((withTitleBrand.get("media-model") ?? 0) - (withoutTitleBrand.get("media-model") ?? 0)) *
      SUPPLY_UNITS;
    const paidResearchAnchor = threshold;
    const paidAdvertisingAnchor = advertisingPerTurn * developmentTurns;
    const totalPaidDevelopmentAnchor = paidResearchAnchor + paidAdvertisingAnchor;
    const baselinePremiumRevenue =
      (withoutTitleBrand.get("media-model") ?? 0) *
      SUPPLY_UNITS *
      basePrice *
      (1 + baselinePremiumPosture);
    const titlePremiumRevenue =
      (withTitleBrand.get("media-model") ?? 0) *
      SUPPLY_UNITS *
      basePrice *
      (1 + titlePremiumPosture);
    const marginalPremiumRevenuePerTurnAnchor = titlePremiumRevenue - baselinePremiumRevenue;
    return {
      id: kind.id,
      model: model.name,
      availableFromYear: model.availableFromYear,
      eligibleIn1991: model.availableFromYear <= 1991,
      outputCommodity: commodity,
      coverage: kind.coverage,
      tail: kind.tail,
      developmentTurns,
      bookBasisAnchor: BOOK_BASIS_ANCHOR,
      paidResearchThresholdAnchor: round(threshold),
      paidResearchPerTurnAnchor: round(researchPerTurn),
      assumedFundedCommercialAdvertisingPerTurnAnchor: round(advertisingPerTurn),
      totalDevelopmentAdvertisingAnchor: round(paidAdvertisingAnchor),
      paidDevelopmentAndAdvertisingAnchor: round(totalPaidDevelopmentAnchor),
      launchQualityWithoutTechnology: product.launchQuality,
      matureQuality: effect.quality,
      paidBrandPerDevelopmentTurnAnchor: round(product.productBrand ?? 0),
      boundedLoyaltyPointsAtMatureStage: round(loyaltyBonus),
      fixedMarketScenario: {
        demandUnits: DEMAND_UNITS,
        unitsPerSeller: SUPPLY_UNITS,
        premiumPosture: PREMIUM_POSTURE,
        baselineEffectiveQualityPremiumMultiplier: round(qualityPremiumMultiplier(baselineQuality)),
        titleEffectiveQualityPremiumMultiplier: round(
          qualityPremiumMultiplier(effect.quality ?? baselineQuality)
        ),
        baselineQuotedPremiumPosture: round(baselinePremiumPosture),
        titleQuotedPremiumPosture: round(titlePremiumPosture),
        titleBrandUnitsFilledWithoutBrand: round(
          (withoutTitleBrand.get("media-model") ?? 0) * SUPPLY_UNITS
        ),
        titleBrandUnitsFilledWithBrand: round(
          (withTitleBrand.get("media-model") ?? 0) * SUPPLY_UNITS
        ),
        incrementalPremiumUnits: round(premiumUnits),
        incrementalPremiumRevenuePerTurnAnchor: round(marginalPremiumRevenuePerTurnAnchor),
        simpleOneTurnRevenueToPaidCostRatio:
          totalPaidDevelopmentAnchor > 0
            ? round(marginalPremiumRevenuePerTurnAnchor / totalPaidDevelopmentAnchor)
            : 0,
        turnsAtSameScenarioToRecoverPaidCost:
          marginalPremiumRevenuePerTurnAnchor > 0
            ? round(totalPaidDevelopmentAnchor / marginalPremiumRevenuePerTurnAnchor)
            : null,
      },
      actualBaseQuality: 60,
      technologyUnlockedInScenario: false,
      physicalOutputOrDemandCreated: false,
    };
  });
  return {
    title: "Media product paid-development and advertising ROI sensitivity",
    inputs:
      "Deterministic production-rule scenario only. No database, seed mutation, or world simulation.",
    assumptions: {
      paidResearchThreshold:
        "Production rule: five percent of an existing sector monetary book basis.",
      bookBasisAnchor: BOOK_BASIS_ANCHOR,
      researchPayment:
        "The full threshold is paid evenly across each kind's authored development cadence.",
      commercialAdvertising:
        "Scenario input only: funded commercial advertising equal to two percent of the book basis each development turn; actual game receipts use settled paid orders.",
      startingSectorBrandLoyalty: STARTING_SECTOR_BRAND_LOYALTY,
      market:
        "Production clearCommodityMarket allocation with 1,000 units of demand and supply each, one rival at neutral price, and the model seller at a 20 percent premium.",
      revenue:
        "Marginal revenue counts only additional premium seller fills at the posted premium and commodity base price; it excludes base business revenue and operating/input costs.",
      brandAndPriceDefense:
        "Uses production brand and loyalty rules. Loyalty can reserve at most the existing finite market loyal pool; it moves fills between sellers without adding demand.",
      limits:
        "The ratio and payback turns are one-turn scenario sensitivities, not forecasts or a full project NPV. The scenario assumes the same clearing conditions persist and excludes production and operating costs.",
    },
    models,
  };
}

process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
