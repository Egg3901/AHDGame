import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { advertisingDeliveredValueByCorp } from "@/lib/turn/corporation/advertisingDeliveredValue";
import { computeClearingFactors, type SectorClearingInput } from "@/lib/market/clearing";

const basePrices = Object.fromEntries(COMMODITY_TYPES.map((commodity) => [commodity, 1])) as Record<
  (typeof COMMODITY_TYPES)[number],
  number
>;

function runOutletMarket(mismatched: boolean) {
  const sectors: SectorClearingInput[] = [
    {
      sectorId: "neutral",
      revenue: 100,
      supplyRates: { advertising: 1 },
      posture: 0,
      ...(!mismatched ? {} : { editorialAdvertisingAvailability: 1 }),
    },
    {
      sectorId: "divergent",
      revenue: 100,
      supplyRates: { advertising: 1 },
      posture: 0,
      ...(mismatched ? { editorialAdvertisingAvailability: 0.75 } : {}),
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
  return { clearingBySectorId, deliveredByCorp };
}

describe("editorial audience fit through commercial clearing", () => {
  it("leaves neutral fill unchanged and lowers divergent fill and seller receipts", () => {
    const legacy = runOutletMarket(false);
    const withEditorialAudienceCost = runOutletMarket(true);
    const legacyDivergent = legacy.clearingBySectorId.get("divergent")!;
    const editorialDivergent = withEditorialAudienceCost.clearingBySectorId.get("divergent")!;

    expect(legacy.clearingBySectorId.get("neutral")?.soldByCommodity?.advertising).toBeCloseTo(0.5);
    expect(
      withEditorialAudienceCost.clearingBySectorId.get("neutral")?.soldByCommodity?.advertising
    ).toBeCloseTo(0.5);
    expect(editorialDivergent.soldByCommodity?.advertising).toBeCloseTo(0.375);
    expect(editorialDivergent.factor).toBeCloseTo(0.375);
    expect(withEditorialAudienceCost.deliveredByCorp.get("divergent-corp")).toBeCloseTo(
      37.5 / TURNS_PER_DAY
    );
    expect(legacy.deliveredByCorp.get("divergent-corp")).toBeCloseTo(50 / TURNS_PER_DAY);
    expect(legacyDivergent.factor).toBeCloseTo(0.5);
  });
});
