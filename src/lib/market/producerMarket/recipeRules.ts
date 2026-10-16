/** Physical coefficients share one output-unit basis in every sector and era. */
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

export function producerRecipe(input: {
  supply: Readonly<Partial<Record<CommodityType, number>>>;
  demand: Readonly<Partial<Record<CommodityType, number>>>;
  eraUnitScale: number;
}) {
  if (!Number.isFinite(input.eraUnitScale) || input.eraUnitScale <= 0)
    throw new Error("Invalid recipe unit scale");
  const weights = (rates: typeof input.supply) =>
    Object.entries(rates).flatMap(([key, rate]) => {
      const commodity = key as CommodityType;
      const base = COMMODITY_BASE_PRICES[commodity];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || !(base > 0))
        throw new Error("Invalid physical commodity recipe");
      return rate === 0 ? [] : [{ commodity, weight: rate / base }];
    });
  const outputs = weights(input.supply);
  const inputs = weights(input.demand);
  const yieldAtBasePrices = outputs.reduce((sum, output) => sum + output.weight, 0);
  const unitsPerNominalAnchor = yieldAtBasePrices * input.eraUnitScale;
  if (!(unitsPerNominalAnchor > 0) || !Number.isFinite(unitsPerNominalAnchor))
    throw new Error("Recipe requires physical output");
  const coefficients = (rows: typeof outputs) =>
    rows.map(({ commodity, weight }) => {
      const unitsPerOutput = weight / yieldAtBasePrices;
      if (!Number.isFinite(unitsPerOutput)) throw new Error("Physical recipe overflow");
      return { commodity, unitsPerOutput };
    });
  return {
    unitsPerNominalAnchor,
    nominalAnchorPerCapacityUnit: 1 / unitsPerNominalAnchor,
    inputs: coefficients(inputs),
    outputs: coefficients(outputs),
  };
}
