import { describe, expect, it } from "vitest";
import { SECTOR_DEMAND } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "./priceRealization";
import { sectorInputCostIndex } from "./costPassThrough";

describe("producer cost pressure matches realized input prices", () => {
  it("does not pass a raw price spike through after the billed input price stops rising", () => {
    const recipe = SECTOR_DEMAND.agriculture!;
    const prices = new Map(recipe.map(({ commodity }) => [commodity, 9]));
    expect(sectorInputCostIndex("agriculture", prices)).toBeCloseTo(priceRealizationFactor(9));
  });
});
