import { describe, expect, it } from "vitest";
import { chooseNppManufacturingProduct } from "./manufacturingNpp";

const candidate = (
  kindId: string,
  capacityWeightedMarginPct: number,
  scarcityPriceRatio: number
) => ({
  kindId,
  outputCommodity: "steel" as const,
  allocations: [{ sectorId: "plant-1", share: 1 }],
  capacityStock: 1000,
  capacityWeightedMarginPct,
  scarcityPriceRatio,
  supplyMixWeight: 0.5,
});

describe("chooseNppManufacturingProduct", () => {
  it("weights scarce outputs by the margin earned on compatible real plant capacity", () => {
    const highMargin = candidate("a", 40, 1.1);
    const scarce = candidate("b", 20, 1.3);
    expect(chooseNppManufacturingProduct([highMargin, scarce])).toBe(scarce);
  });

  it("does not open projects in loss-making or non-scarce markets", () => {
    expect(
      chooseNppManufacturingProduct([candidate("loss", -10, 1.5), candidate("balanced", 30, 1)])
    ).toBeNull();
  });

  it("uses a stable catalog-id tie break", () => {
    expect(
      chooseNppManufacturingProduct([candidate("z", 20, 1.2), candidate("a", 20, 1.2)])?.kindId
    ).toBe("a");
  });

  it("scores scarcity against the kind's actual legacy recipe share", () => {
    const highMix = { ...candidate("steel", 30, 1.5), supplyMixWeight: 0.8 };
    const lowMix = { ...candidate("electronics", 35, 1.8), supplyMixWeight: 0.1 };
    expect(chooseNppManufacturingProduct([lowMix, highMix])).toBe(highMix);
  });
});
