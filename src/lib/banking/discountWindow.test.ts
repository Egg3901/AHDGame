import { describe, it, expect } from "vitest";
import { CB_MARGIN_SPREAD_PP } from "./interbank";
import {
  DISCOUNT_WINDOW_CAP_FRACTION,
  DISCOUNT_WINDOW_SPREAD_PP,
  DISCOUNT_WINDOW_STIGMA,
  canDraw,
  discountWindowRatePercent,
  discountWindowStigma,
  quoteDiscountWindow,
} from "./discountWindow";

const charter = (over: Record<string, unknown> = {}) =>
  ({
    type: "retail" as const,
    status: "active" as const,
    totalDeposits: 1_000_000,
    discountWindowDebt: 0,
    ...over,
  }) as never;

describe("pricing", () => {
  it("is a penalty rate — dearer than the collateralized margin line", () => {
    // Emergency liquidity for a bank that cannot fund itself must not be
    // cheaper than a collateralized loan to fund a trading book.
    expect(DISCOUNT_WINDOW_SPREAD_PP).toBeGreaterThan(CB_MARGIN_SPREAD_PP);
    expect(discountWindowRatePercent(5)).toBe(5 + DISCOUNT_WINDOW_SPREAD_PP);
  });

  it("never quotes a negative rate at a negative prime", () => {
    expect(discountWindowRatePercent(-10)).toBe(0);
  });
});

describe("quoteDiscountWindow", () => {
  it("sizes the cap against the deposit base", () => {
    const quote = quoteDiscountWindow(charter(), 5);
    expect(quote.capAnchor).toBe(1_000_000 * DISCOUNT_WINDOW_CAP_FRACTION);
    expect(quote.headroomAnchor).toBe(quote.capAnchor);
  });

  it("reports headroom net of what is already drawn", () => {
    const quote = quoteDiscountWindow(charter({ discountWindowDebt: 100_000 }), 5);
    expect(quote.headroomAnchor).toBe(quote.capAnchor - 100_000);
  });

  it("never reports negative headroom for a bank whose deposits shrank", () => {
    const quote = quoteDiscountWindow(
      charter({ totalDeposits: 100_000, discountWindowDebt: 900_000 }),
      5
    );
    expect(quote.headroomAnchor).toBe(0);
  });
});

describe("canDraw", () => {
  it("allows a deposit-taker inside its cap", () => {
    expect(canDraw(charter(), 100_000, 5).ok).toBe(true);
  });

  it("refuses an investment charter — it has no depositors to protect", () => {
    const result = canDraw(charter({ type: "investment" }), 100_000, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_deposit_taking");
  });

  it("refuses an inactive charter", () => {
    const result = canDraw(charter({ status: "revoked" }), 100_000, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("charter_inactive");
  });

  it("refuses a draw past the cap", () => {
    const result = canDraw(charter(), 1_000_000, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cap_exhausted");
  });

  it("allows a draw of exactly the remaining headroom", () => {
    expect(canDraw(charter(), 1_000_000 * DISCOUNT_WINDOW_CAP_FRACTION, 5).ok).toBe(true);
  });

  it("refuses a bank with no deposit base to size against", () => {
    const result = canDraw(charter({ totalDeposits: 0 }), 1, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_deposits");
  });

  it("refuses a zero or malformed amount", () => {
    expect(canDraw(charter(), 0, 5).ok).toBe(false);
    expect(canDraw(charter(), Number.NaN, 5).ok).toBe(false);
  });
});

describe("discountWindowStigma", () => {
  it("is zero for a bank that has never drawn — pre-B8 scoring is unchanged", () => {
    expect(discountWindowStigma(charter())).toBe(0);
  });

  it("scales with how much of the CAP is used, not with the raw amount", () => {
    // A small bank at its limit is in more trouble than a large one drawing the
    // same ₳ against a much bigger book.
    const small = discountWindowStigma(
      charter({ totalDeposits: 400_000, discountWindowDebt: 100_000 })
    );
    const large = discountWindowStigma(
      charter({ totalDeposits: 40_000_000, discountWindowDebt: 100_000 })
    );
    expect(small).toBeGreaterThan(large);
    expect(small).toBe(DISCOUNT_WINDOW_STIGMA); // 100k of a 100k cap = full usage
  });

  it("caps at the full penalty even for a bank drawn past its cap", () => {
    expect(
      discountWindowStigma(charter({ totalDeposits: 100_000, discountWindowDebt: 900_000 }))
    ).toBe(DISCOUNT_WINDOW_STIGMA);
  });
});
