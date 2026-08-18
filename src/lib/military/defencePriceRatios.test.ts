import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { priceRatiosFrom, loadDefencePriceRatios } from "./defencePriceRatios";
import { lotProductionCost, lotPriceBand } from "./defenceLotEconomics";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

/** Only the two fields the ratio loader projects; the rest of the document is irrelevant here. */
const price = (commodity: string, globalPrice: number) =>
  ({
    commodity,
    globalPrice,
    basePrice: COMMODITY_BASE_PRICES[commodity as never],
  }) as unknown as CommodityPrice;

function stubDb(prices: CommodityPrice[]): Db {
  return {
    collection: () => ({ find: () => ({ toArray: async () => prices }) }),
  } as unknown as Db;
}

describe("priceRatiosFrom", () => {
  it("expresses each price as a multiple of its base", () => {
    const ratios = priceRatiosFrom([price("steel", COMMODITY_BASE_PRICES.steel * 2)]);
    expect(ratios.get("steel")).toBeCloseTo(2, 9);
  });

  // A missing entry falls back to ratio 1 inside `lotInputCost`, which is the recipe's nominal
  // share. A zero would cost the lot at nothing and put the price floor on the floor, which is
  // the single failure mode the band exists to prevent.
  it("skips an unusable price rather than defaulting it to zero", () => {
    const ratios = priceRatiosFrom([
      price("steel", 0),
      price("iron", Number.NaN),
      { commodity: "not_a_commodity", globalPrice: 5 } as unknown as CommodityPrice,
    ]);
    expect(ratios.size).toBe(0);
  });

  it("reads the live book through one projected query", async () => {
    const ratios = await loadDefencePriceRatios(
      stubDb([price("steel", COMMODITY_BASE_PRICES.steel * 1.5)])
    );
    expect(ratios.get("steel")).toBeCloseTo(1.5, 9);
  });
});

/**
 * The residual this closes: `lotProductionCost` always accepted a ratio map and was always
 * called without one, so a contract's cost floor and the minister's price band were pinned to
 * the recipe's nominal input share and did not move when the commodity market did. The floor
 * was a constant dressed up as a cost.
 */
describe("live commodity prices move the cost floor and the price band", () => {
  const nominal = lotProductionCost("heavy_armor")!;

  it("raises the build cost when a major input gets more expensive", () => {
    // Heavy armour is steel-intensive: 0.30 steel, 0.15 iron of nominal revenue.
    const dear = lotProductionCost(
      "heavy_armor",
      priceRatiosFrom([price("steel", COMMODITY_BASE_PRICES.steel * 4)])
    )!;
    expect(dear).toBeGreaterThan(nominal);
  });

  it("lowers it when the same input gets cheaper", () => {
    const cheap = lotProductionCost(
      "heavy_armor",
      priceRatiosFrom([price("steel", COMMODITY_BASE_PRICES.steel * 0.25)])
    )!;
    expect(cheap).toBeLessThan(nominal);
  });

  // Buy-sell symmetry: the bill prices through the same damped, clamped realization function
  // the revenue side uses, so a world shortage squeezes margins proportionally rather than
  // driving every defence contract underwater on the cost side alone.
  it("damps a price shock instead of passing it through linearly", () => {
    const shocked = lotProductionCost(
      "heavy_armor",
      priceRatiosFrom([price("steel", COMMODITY_BASE_PRICES.steel * 9)])
    )!;
    expect(shocked).toBeGreaterThan(nominal);
    expect(shocked).toBeLessThan(nominal * 9);
  });

  // THE point of wiring the ratios through: the band a minister negotiates inside has to track
  // the market, or a supplier can be held to a price struck in a market that no longer exists.
  it("lifts the price band's floor with the market", () => {
    const anchorPrice = 10_000_000;
    const calm = lotPriceBand({ anchorPrice, productionCost: nominal, grade: 2 })!;
    const dear = lotPriceBand({
      anchorPrice,
      productionCost: lotProductionCost(
        "heavy_armor",
        priceRatiosFrom([price("steel", COMMODITY_BASE_PRICES.steel * 4)])
      )!,
      grade: 2,
    })!;

    expect(dear.floor).toBeGreaterThan(calm.floor);
    // The ceiling is the GDP anchor and is deliberately NOT a function of input prices: a
    // commodity spike must not become licence to pay a supplier more than the economy says a
    // lot is worth. Costs squeeze the band from below; they do not widen it from above.
    expect(dear.ceiling).toBe(calm.ceiling);
  });

  // The band can close entirely. That is the honest outcome, not an error: it says this line
  // cannot build at a price the economy will bear, and the floor still wins so nothing is ever
  // written below cost.
  it("keeps the floor above the ceiling rather than writing a contract below cost", () => {
    const band = lotPriceBand({ anchorPrice: 1, productionCost: nominal, grade: 2 })!;
    expect(band.ceiling).toBe(band.floor);
    expect(band.suggested).toBe(band.floor);
    expect(band.floor).toBeGreaterThan(nominal);
  });

  it("falls back to the nominal share when the book is empty", () => {
    expect(lotProductionCost("heavy_armor", priceRatiosFrom([]))).toBe(nominal);
  });
});
