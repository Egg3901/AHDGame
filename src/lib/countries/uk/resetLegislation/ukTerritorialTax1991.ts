/**
 * Legal identity of 1991 UK local taxes. Game macroregions aggregate local
 * authorities; they are not themselves the historical charging authorities.
 *
 * The source seed's property/corporate lines are only a combined fiscal proxy.
 * No percentage of GDP is represented as a historical community-charge rate.
 */
export type UkTerritorialTaxKind = "community_charge" | "domestic_rates" | "non_domestic_rates";

export interface UkTerritorialTaxOpening {
  regionId: string;
  domestic: UkTerritorialTaxKind;
  business: "non_domestic_rates";
  /** Existing game-currency annual own-revenue proxy, not a historical tax receipt. */
  sourceOwnRevenueProxy: number;
  domesticRateKnown: false;
  businessRateKnown: false;
  estimateKind: "game-calibrated-unallocated-own-revenue";
}

const GB_REGIONS = new Set([
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
]);

export function ukTerritorialTaxOpening1991(input: {
  regionId: string;
  propertyTaxProxy: number;
  domesticCorporateTaxProxy: number;
  foreignCorporateTaxProxy: number;
}): UkTerritorialTaxOpening {
  const { regionId, propertyTaxProxy, domesticCorporateTaxProxy, foreignCorporateTaxProxy } = input;
  if (regionId !== "NIR" && !GB_REGIONS.has(regionId)) {
    throw new Error(`Unknown 1991 UK macroregion ${regionId}`);
  }
  const components = [propertyTaxProxy, domesticCorporateTaxProxy, foreignCorporateTaxProxy];
  if (components.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new Error(`Invalid 1991 UK own-revenue proxy for ${regionId}`);
  }
  return {
    regionId,
    domestic: regionId === "NIR" ? "domestic_rates" : "community_charge",
    business: "non_domestic_rates",
    sourceOwnRevenueProxy: components.reduce((sum, amount) => sum + amount, 0),
    domesticRateKnown: false,
    businessRateKnown: false,
    estimateKind: "game-calibrated-unallocated-own-revenue",
  };
}
