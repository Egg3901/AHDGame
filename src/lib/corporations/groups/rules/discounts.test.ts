import { describe, expect, it } from "vitest";
import { clampGroupDiscount, settleGroupDiscounts } from "./discounts";
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
import type { GroupMarketReceipt } from "./marketCoordination";
const receipt: GroupMarketReceipt = {
  supplierId: "s",
  supplierSectorId: "ss",
  buyerId: "b",
  buyerSectorId: "bb",
  commodity: "iron",
  units: 100,
  amountAnchor: 200,
  discount: 0.35,
};
const quantity = (id: string, n: number) => new Map([[id, new Map([["iron", n]])]]);
describe("Group Chain matched consumption discounts", () => {
  it("uses the agreement band and fails closed on non-finite settings", () => {
    expect(clampGroupDiscount(1)).toBe(SUPPLY_AGREEMENT_PRICE_BAND);
    for (const v of [undefined, NaN, Infinity, -1]) expect(clampGroupDiscount(v)).toBe(0);
  });
  it("subtracts contracted consumption and matches both legs exactly", () => {
    const costs = settleGroupDiscounts(
      [receipt],
      quantity("bb", 75),
      quantity("bb", 25),
      quantity("ss", 100)
    );
    expect(costs.get("ss")).toBe(35);
    expect(costs.get("bb")).toBe(-35);
    expect([...costs.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("caps by actual supplier output after contracts and never discounts missing output", () => {
    expect(settleGroupDiscounts([receipt], quantity("bb", 100))).toEqual(new Map());
    const costs = settleGroupDiscounts(
      [receipt],
      quantity("bb", 100),
      undefined,
      quantity("ss", 60),
      quantity("ss", 40)
    );
    expect(costs.get("ss")).toBe(14);
  });
  it("shares a buyer consumption ceiling across suppliers", () => {
    const receipts = [receipt, { ...receipt, supplierSectorId: "ss2" }];
    const production = new Map([...quantity("ss", 100), ...quantity("ss2", 100)]);
    const costs = settleGroupDiscounts(receipts, quantity("bb", 50), undefined, production);
    expect(costs.get("ss")).toBe(17.5);
    expect(costs.get("ss2")).toBe(17.5);
    expect(costs.get("bb")).toBe(-35);
  });
  it("never rebills base value or unused allocations", () => {
    for (const n of [0, NaN, Infinity])
      expect(
        settleGroupDiscounts([receipt], quantity("bb", n), undefined, quantity("ss", 100))
      ).toEqual(new Map());
    expect(
      settleGroupDiscounts(
        [{ ...receipt, discount: 0 }],
        quantity("bb", 100),
        undefined,
        quantity("ss", 100)
      )
    ).toEqual(new Map());
  });
});

it("rejects malformed zero or negative quantity receipts even when a value is present", () => {
  for (const units of [0, -1, NaN, Infinity])
    expect(
      settleGroupDiscounts(
        [{ ...receipt, units }],
        quantity("bb", 100),
        undefined,
        quantity("ss", 100)
      )
    ).toEqual(new Map());
});
