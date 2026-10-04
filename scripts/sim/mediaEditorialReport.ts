import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { advertisingDeliveredValueByCorp } from "@/lib/turn/corporation/advertisingDeliveredValue";
import { computeClearingFactors, type SectorClearingInput } from "@/lib/market/clearing";
import {
  editorialAudienceFavorabilityNudge,
  editorialFavorabilityNudge,
  mediaAudienceFit,
} from "@/lib/mediaEditorial/rules";

const basePrices = Object.fromEntries(COMMODITY_TYPES.map((commodity) => [commodity, 1])) as Record<
  (typeof COMMODITY_TYPES)[number],
  number
>;

function clearScenario(divergentAvailability: number) {
  const sectors: SectorClearingInput[] = [
    { sectorId: "neutral", revenue: 100, supplyRates: { advertising: 1 }, posture: 0 },
    {
      sectorId: "divergent",
      revenue: 100,
      supplyRates: { advertising: 1 },
      posture: 0,
      editorialAdvertisingAvailability: divergentAvailability,
    },
  ];
  const clearingBySectorId = computeClearingFactors({
    sectors,
    balances: new Map([["advertising", { supply: 200, demand: 100 }]]),
    priceRatioByCommodity: new Map([["advertising", 1]]),
    basePrices,
    plantsEnabled: false,
  });
  const deliveredByCorp = advertisingDeliveredValueByCorp({
    inputs: sectors.map(({ sectorId, revenue, supplyRates }) => ({
      sectorId,
      revenue,
      supplyRates,
    })),
    clearingBasePrices: basePrices,
    plantsEnabled: false,
    clearingBySectorId,
    globalCommodityBalances: new Map([["advertising", { supply: 200 }]]),
    priceRatioByCommodity: new Map([["advertising", 1]]),
    sectorCorpId: new Map([
      ["neutral", "neutral-corp"],
      ["divergent", "divergent-corp"],
    ]),
    commodityMixWeight: () => 1,
    qualityPremiumPricingEnabled: false,
  });
  return {
    sectors: Object.fromEntries(
      [...clearingBySectorId].map(([sectorId, clearing]) => [
        sectorId,
        {
          rawOutputUnits: 100,
          soldFraction: clearing.soldByCommodity?.advertising ?? 0,
          commercialRevenuePerTurn: (100 * (clearing.factor ?? 0)) / TURNS_PER_DAY,
          adSellerReceiptAnchorPerTurn: deliveredByCorp.get(`${sectorId}-corp`) ?? 0,
        },
      ])
    ),
  };
}

async function main() {
  const neutralAudienceLean = { economic: 0, social: 0 };
  const divergentStance = { economic: 5, social: 5 };
  const scenarios = {
    balancedEditorial: clearScenario(1),
    maximumDivergence: clearScenario(
      mediaAudienceFit(divergentStance, { economic: -5, social: -5 })
    ),
  };
  const report = {
    title: "Media editorial audience fill diagnostic",
    method:
      "Uses computeClearingFactors and advertisingDeliveredValueByCorp with identical offers, market balances and prices. The only changed input is pre-clearing advertising availability.",
    assumptions: {
      rawOutputUnitsPerOutlet: 100,
      laggedSupplyUnits: 200,
      laggedDemandUnits: 100,
      baseAndRealizedAdvertisingPrice: 1,
      turnsPerDay: TURNS_PER_DAY,
      maximumAudienceLoss: 0.25,
      audienceLeanForBalancedScenario: neutralAudienceLean,
      divergentStance,
    },
    derived: {
      maximumDivergenceAvailability: mediaAudienceFit(divergentStance, {
        economic: -5,
        social: -5,
      }),
      alignedPoliticianNudgeAtFullAudienceShare: editorialFavorabilityNudge(
        divergentStance,
        divergentStance,
        1
      ),
      alignedPoliticianNudgeAtHalfAudienceShare: editorialAudienceFavorabilityNudge(
        [
          { stance: divergentStance, audienceShare: 0.5 },
          { stance: { economic: -5, social: -5 }, audienceShare: 0.5 },
        ],
        divergentStance
      ),
    },
    scenarios,
    accounting: {
      buyerValueIsComputedFromTheSameFilledUnitsAsSellerReceipt: true,
      reducedAvailabilityRemainsUnsoldOutput: true,
      buyerDemandIsNotExpanded: true,
    },
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const destination = "scripts/sim/reports/issue-3129-media-editorial.json";
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output, "utf8");
  process.stdout.write(output);
}

void main();
