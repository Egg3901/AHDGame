import type { ProducedStock } from "./production";
import type { ProducerQuotePolicy } from "./rules";
import type { CommodityType } from "@/lib/constants/commodities";

/** Products left in inventory after the plant's final recipe stops making them. */
export function unknownRetainedCostPlusCommodities(input: {
  outputStock: readonly Pick<ProducedStock, "commodity" | "units" | "quoteUnitCost">[];
  finalOutputCommodities: Iterable<string>;
  quotes?: Readonly<Partial<Record<CommodityType, ProducerQuotePolicy>>>;
}): string[] {
  const finalOutputs = new Set(input.finalOutputCommodities);
  const blocked = new Set<string>();
  for (const stock of input.outputStock) {
    if (
      stock.units > 0 &&
      !finalOutputs.has(stock.commodity) &&
      stock.quoteUnitCost == null &&
      input.quotes?.[stock.commodity as CommodityType]?.kind === "costPlus"
    ) {
      blocked.add(stock.commodity);
    }
  }
  return [...blocked].sort();
}

export function retainedCostPlusBlockMessage(
  commodities: readonly string[],
  action: "pricing" | "strategy" = "strategy"
): string {
  const names = commodities.join(", ");
  const verb = action === "pricing" ? "save this pricing" : "make this strategy change";
  return `Cannot ${verb}: retained ${names} stock has no recorded unit cost for cost-plus pricing. Set those products to automatic or manual pricing, or sell the stock before changing the recipe.`;
}
