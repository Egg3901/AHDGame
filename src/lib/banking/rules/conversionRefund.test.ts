import { describe, it, expect } from "vitest";
import { quoteUnpublishedUnderwritingRefund } from "./conversionRefund";
describe("unpublished underwriting refunds", () => {
  it.each([0, 1, 2, 3])("restores the original balances after %i delivered cash legs", (count) => {
    const amounts = [-1000, 980, 20];
    const legs = amounts.map((amount, index) => ({
      kind: amount < 0 ? ("debit" as const) : ("credit" as const),
      amount: Math.abs(amount),
      applied: index < count,
    }));
    const refund = quoteUnpublishedUnderwritingRefund({ published: false, legs });
    expect(amounts.map((amount, index) => (index < count ? amount : 0) + refund[index])).toEqual([
      0, 0, 0,
    ]);
  });
  it("protects published investor property", () => {
    expect(() => quoteUnpublishedUnderwritingRefund({ published: true, legs: [] })).toThrow(
      "Published"
    );
  });
  it("rejects invalid cash amounts", () => {
    expect(() =>
      quoteUnpublishedUnderwritingRefund({
        published: false,
        legs: [{ kind: "debit", amount: NaN, applied: true }],
      })
    ).toThrow("Invalid");
  });
});
