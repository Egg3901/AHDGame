export const INDEX_FUND_INITIAL_NAV = 100;
export const INDEX_FUND_SEED_CASH_ANCHOR = 50_000_000;
export const INDEX_FUND_SEED_RESERVE_UNITS = 500_000;
/**
 * Auto-pause threshold for fund backing ratio. **Zero disables auto-pause**;
 * admins manage fund solvency by hand via the inject-capital tool.
 *
 * The disabled case used to be implicit: `backingRatio < 0` is false for every
 * non-negative ratio, so the pause branch in fundCron and the "error" tone in
 * the gauge were both permanently unreachable while still reading as live
 * safety. `backingRatioDisablesAutoPause` now says so out loud, and raising
 * this constant above 0 is all it takes to arm the mechanism again.
 */
export const INDEX_FUND_AUTO_PAUSE_BACKING_RATIO = 0;

/**
 * Backing level below which a fund is displayed as under-backed. Purely a
 * display band: it never pauses anything. Kept separate from the auto-pause
 * constant so the gauge can warn while the mechanism stays disarmed.
 */
export const INDEX_FUND_BACKING_WARN_RATIO = 0.5;

/** True when auto-pause on low backing is switched off entirely. */
export function autoPauseDisabled(): boolean {
  return !(INDEX_FUND_AUTO_PAUSE_BACKING_RATIO > 0);
}
export const INDEX_FUND_DIVIDEND_REINVEST_RATIO = 0.75;
export const INDEX_FUND_DIVIDEND_PASS_THROUGH_RATIO = 0.25;
/** Max share of fund backing that may be invested in equities. */
export const INDEX_FUND_MAX_EQUITY_ALLOCATION = 0.75;
/** Min share of fund backing held in the bond/cash reserve bucket. */
export const INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION = 0.25;

export type FundPauseReason = "backing_ratio" | "constituent_delisted" | "manual";

export type SubscriptionQuote = {
  units: number;
  nav: number;
  costAnchor: number;
};

export type WeightedUnitPosition = {
  units: number;
  avgNavAnchor?: number;
};

export type BackingRatioInput = {
  cashAnchor: number;
  holdingsValueAnchor: number;
  /** Sovereign bond principal held in the fund reserve bucket. */
  bondPrincipalAnchor?: number;
  /** Sum of escrowAnchor on open fund-owned limit buy orders (cash committed but not yet shares). */
  openOrdersEscrowAnchor?: number;
  /**
   * Units queued for redemption whose supply was already burned. Counted as
   * outstanding units, not as a fixed cash debt: a queued holder holds a
   * pro-rata claim like everyone else.
   */
  queuedRedemptionUnits?: number;
  quotedNav: number;
  unitSupply: number;
};

export type BackingRatioResult = {
  actualBackingValueAnchor: number;
  quotedLiabilityAnchor: number;
  backingRatio: number;
  shouldAutoPause: boolean;
  pauseReason?: FundPauseReason;
};

export type FundDividendSplit = {
  grossAnchor: number;
  reinvestAnchor: number;
  passThroughAnchor: number;
};

export type CashOnlyRedemptionQuote = {
  requestedUnits: number;
  redeemableUnits: number;
  queuedUnits: number;
  nav: number;
  requestedAmountAnchor: number;
  paidAmountAnchor: number;
  queuedAmountAnchor: number;
  remainingCashAnchor: number;
  status: "paid" | "partial" | "queued";
};

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

export function assertWholeFundUnits(units: number): number {
  if (!Number.isInteger(units) || units < 1) {
    throw new Error("Index fund orders must be for at least 1 whole unit");
  }
  return units;
}

export function quoteIndexFundSubscription(
  quotedNav: number,
  requestedUnits: number
): SubscriptionQuote {
  assertFinitePositive(quotedNav, "quotedNav");
  const units = assertWholeFundUnits(requestedUnits);
  return {
    units,
    nav: quotedNav,
    costAnchor: units * quotedNav,
  };
}

// KEPT INTENTIONALLY (issue #2824): creditFundUnits/debitFundUnits form the
// double-entry, NAV-weighted fund unit ledger. They are tested but not yet
// wired into production fund flows — they await integration with the shadow
// ledger arc (financialTxLog conservation checks). Do not delete as dead code.
export function creditFundUnits(
  position: WeightedUnitPosition,
  units: number,
  nav: number
): WeightedUnitPosition {
  assertFinitePositive(nav, "nav");
  const addedUnits = assertWholeFundUnits(units);
  const existingUnits = Math.max(0, Math.floor(position.units));
  const existingAvg = position.avgNavAnchor ?? nav;
  const nextUnits = existingUnits + addedUnits;
  const avgNavAnchor =
    existingUnits > 0 ? (existingUnits * existingAvg + addedUnits * nav) / nextUnits : nav;

  return { units: nextUnits, avgNavAnchor };
}

export function debitFundUnits(
  position: WeightedUnitPosition,
  units: number
): WeightedUnitPosition {
  const debitedUnits = assertWholeFundUnits(units);
  const existingUnits = Math.max(0, Math.floor(position.units));
  if (existingUnits < debitedUnits) {
    throw new Error("Insufficient index fund units");
  }
  const nextUnits = existingUnits - debitedUnits;
  return nextUnits > 0 ? { units: nextUnits, avgNavAnchor: position.avgNavAnchor } : { units: 0 };
}

export function calculateBackingRatio(input: BackingRatioInput): BackingRatioResult {
  const cashAnchor = Number.isFinite(input.cashAnchor) ? Math.max(0, input.cashAnchor) : 0;
  const holdingsValueAnchor = Number.isFinite(input.holdingsValueAnchor)
    ? Math.max(0, input.holdingsValueAnchor)
    : 0;
  const quotedNav = Number.isFinite(input.quotedNav) ? Math.max(0, input.quotedNav) : 0;
  const unitSupply = Number.isFinite(input.unitSupply)
    ? Math.max(0, Math.floor(input.unitSupply))
    : 0;
  const bondPrincipalRaw = input.bondPrincipalAnchor ?? 0;
  const bondPrincipalAnchor = Number.isFinite(bondPrincipalRaw) ? Math.max(0, bondPrincipalRaw) : 0;
  const openEscrowRaw = input.openOrdersEscrowAnchor ?? 0;
  const openOrdersEscrowAnchor = Number.isFinite(openEscrowRaw) ? Math.max(0, openEscrowRaw) : 0;
  const queuedUnitsRaw = input.queuedRedemptionUnits ?? 0;
  const queuedRedemptionUnits = Number.isFinite(queuedUnitsRaw)
    ? Math.max(0, Math.floor(queuedUnitsRaw))
    : 0;
  const actualBackingValueAnchor = Math.max(
    0,
    cashAnchor + holdingsValueAnchor + bondPrincipalAnchor + openOrdersEscrowAnchor
  );
  // Queued units are still claims on this backing, so they belong on the
  // quoted-liability side. Netting them out of assets instead made the ratio
  // fall faster than the assets did and tripped a spurious backing collapse.
  const quotedLiabilityAnchor = quotedNav * (unitSupply + queuedRedemptionUnits);
  const backingRatio =
    quotedLiabilityAnchor > 0 ? actualBackingValueAnchor / quotedLiabilityAnchor : 1;
  const shouldAutoPause =
    !autoPauseDisabled() && backingRatio < INDEX_FUND_AUTO_PAUSE_BACKING_RATIO;

  return {
    actualBackingValueAnchor,
    quotedLiabilityAnchor,
    backingRatio,
    shouldAutoPause,
    ...(shouldAutoPause ? { pauseReason: "backing_ratio" } : {}),
  };
}

export function splitIndexFundDividend(grossAnchor: number): FundDividendSplit {
  if (!Number.isFinite(grossAnchor) || grossAnchor <= 0) {
    return { grossAnchor: 0, reinvestAnchor: 0, passThroughAnchor: 0 };
  }

  const passThroughAnchor = grossAnchor * INDEX_FUND_DIVIDEND_PASS_THROUGH_RATIO;
  return {
    grossAnchor,
    reinvestAnchor: grossAnchor - passThroughAnchor,
    passThroughAnchor,
  };
}

/**
 * One queued entry's share of the cash a fund can currently pay out.
 *
 * Water-filling by units: each entry may draw its proportion of what is
 * available, measured against the units still unserved in this pass. The last
 * entry is uncapped, so rounding can never strand cash in the fund forever.
 *
 * This exists because the queue used to be served first-come-first-served to
 * exhaustion. One GLB50 holder redeemed over half the fund and was paid out
 * turn after turn while 2,700 other positions received nothing, which is a run
 * in every sense. Real funds gate redemptions pro-rata precisely to stop the
 * first mover taking the whole book.
 */
export function proRataRedemptionCashShare(input: {
  entryUnits: number;
  /** Units still unserved in this pass, including this entry's. */
  unservedUnits: number;
  availableCashAnchor: number;
}): number {
  const entryUnits = Number.isFinite(input.entryUnits) ? Math.max(0, input.entryUnits) : 0;
  const unservedUnits = Number.isFinite(input.unservedUnits) ? Math.max(0, input.unservedUnits) : 0;
  const availableCashAnchor = Number.isFinite(input.availableCashAnchor)
    ? Math.max(0, input.availableCashAnchor)
    : 0;
  if (entryUnits <= 0 || availableCashAnchor <= 0) return 0;
  // Nothing else waiting: this entry may take everything the fund can pay.
  if (unservedUnits <= entryUnits) return availableCashAnchor;
  return availableCashAnchor * (entryUnits / unservedUnits);
}

export function quoteCashOnlyRedemption(input: {
  quotedNav: number;
  requestedUnits: number;
  cashAnchor: number;
}): CashOnlyRedemptionQuote {
  assertFinitePositive(input.quotedNav, "quotedNav");
  const requestedUnits = assertWholeFundUnits(input.requestedUnits);
  const cashAnchor = Number.isFinite(input.cashAnchor) ? Math.max(0, input.cashAnchor) : 0;
  const requestedAmountAnchor = requestedUnits * input.quotedNav;
  const redeemableUnits = Math.min(requestedUnits, Math.floor(cashAnchor / input.quotedNav));
  const paidAmountAnchor = redeemableUnits * input.quotedNav;
  const queuedUnits = requestedUnits - redeemableUnits;
  const queuedAmountAnchor = requestedAmountAnchor - paidAmountAnchor;

  return {
    requestedUnits,
    redeemableUnits,
    queuedUnits,
    nav: input.quotedNav,
    requestedAmountAnchor,
    paidAmountAnchor,
    queuedAmountAnchor,
    remainingCashAnchor: cashAnchor - paidAmountAnchor,
    status: queuedUnits === 0 ? "paid" : redeemableUnits > 0 ? "partial" : "queued",
  };
}

/**
 * Ticket #857 grandfather: the ₳ → native multiplier to apply when crediting a
 * redemption to a character/imperial wallet. Fund payouts are computed in ₳;
 * pre-fix "legacy" units were charged the raw ₳ magnitude as native (× 1), so
 * they must be paid back at × 1 (no windfall), while post-fix units convert at
 * the true fund FX rate. The result is the per-unit blend across the request,
 * applied uniformly to every payout leg (immediate + queued). Returns 1 when
 * forex is off or there is nothing to redeem.
 */
export function blendedRedeemFxRate(params: {
  legacyUnitsRedeemed: number;
  totalUnits: number;
  fundFxRate: number;
  forexEnabled: boolean;
}): number {
  const { legacyUnitsRedeemed, totalUnits, fundFxRate, forexEnabled } = params;
  if (!forexEnabled || totalUnits <= 0) return 1;
  const legacy = Math.max(0, Math.min(legacyUnitsRedeemed, totalUnits));
  const nonLegacy = totalUnits - legacy;
  return (legacy + nonLegacy * fundFxRate) / totalUnits;
}

/**
 * Ticket #857 grandfather — display side. A position is valued in the UI by
 * feeding an ₳ amount to the currency layer, which multiplies by the fund's FX
 * rate to render native currency. Legacy units redeem rate-free (× 1), so in ₳
 * terms they are worth only `1 / rate` of a normal unit — otherwise the display
 * layer's × rate step over-states a legacy holder's position by ~rate× (≈100×),
 * showing a value the holder can never actually redeem. This returns the
 * legacy-adjusted unit count to substitute for raw `units` when computing any
 * ₳ figure that will be run through `formatAmount`/`formatPrice` (position
 * value, cost basis, per-unit avg NAV). After the display layer applies × rate,
 * the legacy portion collapses back to its true rate-free native value. Returns
 * `units` unchanged when forex is off, there is no position, or nothing is
 * legacy — so post-fix holders are untouched.
 */
export function legacyAdjustedDisplayUnits(params: {
  units: number;
  legacyUnits: number;
  fundFxRate: number;
  forexEnabled: boolean;
}): number {
  const { units, legacyUnits, fundFxRate, forexEnabled } = params;
  if (!forexEnabled || units <= 0 || !(fundFxRate > 0)) return units;
  const legacy = Math.max(0, Math.min(legacyUnits, units));
  const nonLegacy = units - legacy;
  return legacy / fundFxRate + nonLegacy;
}
