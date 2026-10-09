import { describe, expect, it } from "vitest";
import { costliestInput } from "./costliestInput";
import type { CommodityFlow } from "../types";

const flow = (commodity: string, units: number, price: number): CommodityFlow =>
  ({ commodity, units, marketPrice: price, billedUnitPrice: price }) as CommodityFlow;

describe("costliestInput", () => {
  it("picks the input with the highest units times billed price", () => {
    expect(
      costliestInput([flow("iron", 10, 5), flow("energy", 100, 2), flow("coal", 1, 9)])
    ).toMatchObject({ commodity: "energy" });
  });
  it("falls back to market price when no billed price is recorded", () => {
    const f = { commodity: "iron", units: 4, marketPrice: 3 } as CommodityFlow;
    expect(costliestInput([f])).toBe(f);
  });
  it("returns null with no priced input", () => {
    expect(costliestInput([])).toBeNull();
    expect(costliestInput([flow("iron", 0, 5)])).toBeNull();
  });
});
