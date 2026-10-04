import { describe, expect, it } from "vitest";
import { computePropEquityBase } from "./propLeverage";

describe("shared equity for prop limits", () => {
  const charter = {
    totalLoans: 80_000,
    propBookMarkValue: 90_000,
    npcDeposits: 100_000,
    playerDeposits: 80_000,
    interbankDebt: 20_000,
    cbMarginDebt: 10_000,
    discountWindowDebt: 40_000,
    discountWindowArrears: 3_000,
    cbMarginArrears: 2_000,
  };
  it("includes funded loans while netting all cash-backed debts", () => {
    expect(computePropEquityBase(150_000, charter)).toBe(145_000);
    expect(
      computePropEquityBase(150_000, charter, undefined, { playerDepositsAreLiabilities: true })
    ).toBe(65_000);
  });
  it("preserves equity when a flat-mark position is sold back into cash", () => {
    expect(computePropEquityBase(150_000, charter, 90_000)).toBe(
      computePropEquityBase(200_000, charter, 40_000)
    );
  });
  it("does not treat posted capital as a second cash asset", () => {
    const withMemo = { ...charter, postedCapital: 999_999 };
    expect(computePropEquityBase(150_000, withMemo)).toBe(computePropEquityBase(150_000, charter));
  });
});
