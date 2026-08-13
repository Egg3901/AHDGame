import { describe, expect, it } from "vitest";
import {
  blendedRedeemFxRate,
  calculateBackingRatio,
  creditFundUnits,
  debitFundUnits,
  INDEX_FUND_AUTO_PAUSE_BACKING_RATIO,
  INDEX_FUND_BACKING_WARN_RATIO,
  autoPauseDisabled,
  INDEX_FUND_DIVIDEND_PASS_THROUGH_RATIO,
  INDEX_FUND_DIVIDEND_REINVEST_RATIO,
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
  legacyAdjustedDisplayUnits,
  quoteCashOnlyRedemption,
  quoteIndexFundSubscription,
  splitIndexFundDividend,
} from "./unitAccounting";

describe("index fund unit accounting constants", () => {
  it("keeps the seed peg from the plan", () => {
    expect(INDEX_FUND_INITIAL_NAV).toBe(100);
    expect(INDEX_FUND_SEED_CASH_ANCHOR).toBe(50_000_000);
    expect(INDEX_FUND_SEED_RESERVE_UNITS).toBe(500_000);
    expect(INDEX_FUND_SEED_RESERVE_UNITS * INDEX_FUND_INITIAL_NAV).toBe(
      INDEX_FUND_SEED_CASH_ANCHOR
    );
  });

  it("keeps the dividend split from the plan", () => {
    expect(INDEX_FUND_DIVIDEND_REINVEST_RATIO).toBe(0.75);
    expect(INDEX_FUND_DIVIDEND_PASS_THROUGH_RATIO).toBe(0.25);
  });
});

describe("quoteIndexFundSubscription", () => {
  it("quotes whole units at locked NAV", () => {
    expect(quoteIndexFundSubscription(123.45, 3)).toEqual({
      units: 3,
      nav: 123.45,
      costAnchor: 370.35,
    });
  });

  it("rejects fractional or zero units", () => {
    expect(() => quoteIndexFundSubscription(100, 0)).toThrow(/whole unit/);
    expect(() => quoteIndexFundSubscription(100, 1.5)).toThrow(/whole unit/);
  });
});

describe("fund position unit updates", () => {
  it("blends average NAV when crediting units", () => {
    expect(creditFundUnits({ units: 10, avgNavAnchor: 90 }, 10, 110)).toEqual({
      units: 20,
      avgNavAnchor: 100,
    });
  });

  it("preserves average NAV while debiting and clears it at zero", () => {
    expect(debitFundUnits({ units: 10, avgNavAnchor: 90 }, 4)).toEqual({
      units: 6,
      avgNavAnchor: 90,
    });
    expect(debitFundUnits({ units: 10, avgNavAnchor: 90 }, 10)).toEqual({ units: 0 });
  });
});

describe("calculateBackingRatio", () => {
  it("compares actual backing against quoted unit liabilities", () => {
    expect(
      calculateBackingRatio({
        cashAnchor: 20_000,
        holdingsValueAnchor: 30_000,
        bondPrincipalAnchor: 5_000,
        quotedNav: 100,
        unitSupply: 1000,
      })
    ).toMatchObject({
      actualBackingValueAnchor: 55_000,
      quotedLiabilityAnchor: 100_000,
      backingRatio: 0.55,
      shouldAutoPause: false,
    });
  });

  it("counts open order escrow in actual backing value", () => {
    const result = calculateBackingRatio({
      cashAnchor: 20_000,
      holdingsValueAnchor: 30_000,
      bondPrincipalAnchor: 5_000,
      openOrdersEscrowAnchor: 10_000,
      quotedNav: 100,
      unitSupply: 1000,
    });
    expect(result.actualBackingValueAnchor).toBe(65_000);
    expect(result.backingRatio).toBeCloseTo(0.65, 5);
  });

  it("subtracts queued redemption payables whose units were already burned", () => {
    const result = calculateBackingRatio({
      cashAnchor: 20_000,
      holdingsValueAnchor: 30_000,
      bondPrincipalAnchor: 5_000,
      openOrdersEscrowAnchor: 10_000,
      queuedRedemptionLiabilityAnchor: 15_000,
      quotedNav: 100,
      unitSupply: 1000,
    });
    expect(result.actualBackingValueAnchor).toBe(50_000);
    expect(result.backingRatio).toBeCloseTo(0.5, 5);
  });

  it("does not auto-pause regardless of backing ratio (manual admin control)", () => {
    const result = calculateBackingRatio({
      cashAnchor: 19_999,
      holdingsValueAnchor: 30_000,
      quotedNav: 100,
      unitSupply: 1000,
    });

    expect(INDEX_FUND_AUTO_PAUSE_BACKING_RATIO).toBe(0);
    expect(result.backingRatio).toBeLessThan(0.5);
    expect(result.shouldAutoPause).toBe(false);
    expect(result.pauseReason).toBeUndefined();
  });
});

describe("splitIndexFundDividend", () => {
  it("routes 75% to reinvestment and 25% to pass-through", () => {
    expect(splitIndexFundDividend(1000)).toEqual({
      grossAnchor: 1000,
      reinvestAnchor: 750,
      passThroughAnchor: 250,
    });
  });
});

describe("quoteCashOnlyRedemption", () => {
  it("pays entirely from cash when the fund is liquid", () => {
    expect(quoteCashOnlyRedemption({ quotedNav: 100, requestedUnits: 3, cashAnchor: 500 })).toEqual(
      {
        requestedUnits: 3,
        redeemableUnits: 3,
        queuedUnits: 0,
        nav: 100,
        requestedAmountAnchor: 300,
        paidAmountAnchor: 300,
        queuedAmountAnchor: 0,
        remainingCashAnchor: 200,
        status: "paid",
      }
    );
  });

  it("queues the unpaid portion instead of minting cash", () => {
    expect(quoteCashOnlyRedemption({ quotedNav: 100, requestedUnits: 3, cashAnchor: 250 })).toEqual(
      {
        requestedUnits: 3,
        redeemableUnits: 2,
        queuedUnits: 1,
        nav: 100,
        requestedAmountAnchor: 300,
        paidAmountAnchor: 200,
        queuedAmountAnchor: 100,
        remainingCashAnchor: 50,
        status: "partial",
      }
    );
  });

  it("queues everything when cash cannot cover one whole unit", () => {
    expect(
      quoteCashOnlyRedemption({ quotedNav: 100, requestedUnits: 3, cashAnchor: 99 })
    ).toMatchObject({
      redeemableUnits: 0,
      queuedUnits: 3,
      paidAmountAnchor: 0,
      queuedAmountAnchor: 300,
      status: "queued",
    });
  });
});

describe("blendedRedeemFxRate (#857 grandfather)", () => {
  const rate = 109.51; // JPY per ₳

  it("pays all-legacy units rate-free (× 1) — the JPY whale gets no windfall", () => {
    // 16M legacy units of a fund at NAV 116.6 ₳ redeem at × 1, so native payout
    // = 16M × 116.6 ≈ ¥1.87B (what they paid), NOT ¥204B (16M × 116.6 × 109.51).
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 16_000_000,
        totalUnits: 16_000_000,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBe(1);
  });

  it("pays fully post-fix units at the true fund rate", () => {
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 0,
        totalUnits: 1_000,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBe(rate);
  });

  it("blends a mixed legacy / post-fix redemption per unit", () => {
    // 40 legacy + 60 post-fix of 100 → (40×1 + 60×109.51) / 100.
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 40,
        totalUnits: 100,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBeCloseTo((40 + 60 * rate) / 100, 10);
  });

  it("clamps legacy units above the redeemed total to all-legacy", () => {
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 999,
        totalUnits: 10,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBe(1);
  });

  it("returns 1 when forex is disabled or nothing is redeemed", () => {
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 0,
        totalUnits: 100,
        fundFxRate: rate,
        forexEnabled: false,
      })
    ).toBe(1);
    expect(
      blendedRedeemFxRate({
        legacyUnitsRedeemed: 0,
        totalUnits: 0,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBe(1);
  });
});

describe("legacyAdjustedDisplayUnits (#857 grandfather display)", () => {
  const rate = 109.51; // JPY per ₳
  const nav = 116.6; // ₳

  it("discounts all-legacy units to 1/rate so the display × rate step is a no-op", () => {
    // The JPY whale: 16M all-legacy units. Feeding displayUnits × nav to the
    // currency layer (which multiplies by `rate`) must reproduce the true
    // rate-free redemption value 16M × nav, not 16M × nav × rate (≈100× more).
    const displayUnits = legacyAdjustedDisplayUnits({
      units: 16_000_000,
      legacyUnits: 16_000_000,
      fundFxRate: rate,
      forexEnabled: true,
    });
    expect(displayUnits).toBeCloseTo(16_000_000 / rate, 6);
    expect(displayUnits * nav * rate).toBeCloseTo(16_000_000 * nav, 2);
  });

  it("leaves fully post-fix positions unchanged", () => {
    expect(
      legacyAdjustedDisplayUnits({
        units: 1_000,
        legacyUnits: 0,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBe(1_000);
  });

  it("matches blendedRedeemFxRate for the whole position (value ties to redeem quote)", () => {
    // Displayed value must equal what a full redemption would credit:
    // displayUnits × nav × rate === units × nav × blendedRate.
    const units = 100;
    const legacyUnits = 40;
    const displayUnits = legacyAdjustedDisplayUnits({
      units,
      legacyUnits,
      fundFxRate: rate,
      forexEnabled: true,
    });
    const blended = blendedRedeemFxRate({
      legacyUnitsRedeemed: legacyUnits,
      totalUnits: units,
      fundFxRate: rate,
      forexEnabled: true,
    });
    expect(displayUnits * nav * rate).toBeCloseTo(units * nav * blended, 6);
  });

  it("clamps legacy units above the holding to all-legacy", () => {
    expect(
      legacyAdjustedDisplayUnits({
        units: 10,
        legacyUnits: 999,
        fundFxRate: rate,
        forexEnabled: true,
      })
    ).toBeCloseTo(10 / rate, 6);
  });

  it("ticket #1072: non-legacy redeem ₳ payout equals subscribe cost (shared display basis)", () => {
    // Subscribe quotes `units * nav` in ₳ then formatFull converts through the
    // wallet preference. Redeem must start from the same ₳ figure — not native
    // face × fund symbol — so a DD viewer does not see M376 to buy and $79 to
    // sell the same unit.
    const nav = 79;
    const units = 1;
    const subscribe = quoteIndexFundSubscription(nav, units);
    const displayUnits = legacyAdjustedDisplayUnits({
      units,
      legacyUnits: 0,
      fundFxRate: 1,
      forexEnabled: true,
    });
    expect(displayUnits * nav).toBe(subscribe.costAnchor);
  });

  it("returns raw units when forex is off, position is empty, or rate is invalid", () => {
    expect(
      legacyAdjustedDisplayUnits({
        units: 100,
        legacyUnits: 100,
        fundFxRate: rate,
        forexEnabled: false,
      })
    ).toBe(100);
    expect(
      legacyAdjustedDisplayUnits({ units: 0, legacyUnits: 0, fundFxRate: rate, forexEnabled: true })
    ).toBe(0);
    expect(
      legacyAdjustedDisplayUnits({
        units: 100,
        legacyUnits: 100,
        fundFxRate: 0,
        forexEnabled: true,
      })
    ).toBe(100);
  });
});

describe("auto-pause disarming is explicit", () => {
  it("never asks for a pause while the threshold is zero", () => {
    // The disabled case used to depend on `ratio < 0` being false, which made
    // the pause branch and the gauge's error tone silently unreachable.
    expect(autoPauseDisabled()).toBe(true);
    const backing = calculateBackingRatio({
      cashAnchor: 1,
      holdingsValueAnchor: 0,
      quotedNav: 100,
      unitSupply: 1000,
    });
    expect(backing.backingRatio).toBeLessThan(0.5);
    expect(backing.shouldAutoPause).toBe(false);
    expect(backing.pauseReason).toBeUndefined();
  });

  it("keeps the warning band separate from the pause threshold", () => {
    expect(INDEX_FUND_BACKING_WARN_RATIO).toBeGreaterThan(INDEX_FUND_AUTO_PAUSE_BACKING_RATIO);
  });
});
