/** Physical coefficients share one output-unit basis in every sector and era. */
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

export function producerRecipe(input: {
  supply: Readonly<Partial<Record<CommodityType, number>>>;
  demand: Readonly<Partial<Record<CommodityType, number>>>;
  eraUnitScale: number;
  /** Base output-rate value, frozen before technology and resource yield effects. */
  outputRateValueBasis?: number;
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
  // Catalog supply rates describe the mix, not a second haircut to earned
  // revenue. Normalize its base-value basket to one nominal anchor; input rates
  // remain the method's material budget on that same basis. Owned units never
  // change here. The host freezes the basis before applying physical yield.
  const outputRateValueBasis =
    input.outputRateValueBasis ??
    Object.values(input.supply).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isFinite(outputRateValueBasis) || outputRateValueBasis <= 0)
    throw new Error("Recipe requires physical output value basis");
  const normalizedYield = yieldAtBasePrices / outputRateValueBasis;
  const unitsPerNominalAnchor = normalizedYield * input.eraUnitScale;
  if (!(unitsPerNominalAnchor > 0) || !Number.isFinite(unitsPerNominalAnchor))
    throw new Error("Recipe requires physical output");
  const coefficients = (rows: typeof outputs, divisor: number) =>
    rows.map(({ commodity, weight }) => {
      const unitsPerOutput = weight / divisor;
      if (!Number.isFinite(unitsPerOutput)) throw new Error("Physical recipe overflow");
      return { commodity, unitsPerOutput };
    });
  return {
    unitsPerNominalAnchor,
    nominalAnchorPerCapacityUnit: 1 / unitsPerNominalAnchor,
    inputs: coefficients(inputs, normalizedYield),
    outputs: coefficients(outputs, yieldAtBasePrices),
  };
}
