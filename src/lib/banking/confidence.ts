/**
 * Pure bank solvency confidence math. Provisional constants flagged for review.
 * No DB access; bankSolvencyTurn wires the inputs and writes the results.
 */

/** Provisional - weight on reserve cover in raw confidence. */
export const CONFIDENCE_RESERVE_WEIGHT = 0.45;

/** Provisional - weight on capital cover in raw confidence. */
export const CONFIDENCE_CAPITAL_WEIGHT = 0.25;

/** Provisional - weight on asset quality in raw confidence. */
export const CONFIDENCE_ASSET_QUALITY_WEIGHT = 0.3;

/** Provisional - reserve cover is capped at this multiple of required reserves. */
export const CONFIDENCE_RESERVE_COVER_CAP = 1.5;

/** Provisional - capital cover is capped at 1. */
export const CONFIDENCE_CAPITAL_COVER_CAP = 1;

/** Provisional - arrears share of loans scales asset quality by this factor. */
export const CONFIDENCE_ARREARS_PENALTY = 0.7;

/** Provisional - defaults-last-turn share of loans scales asset quality by this factor. */
export const CONFIDENCE_DEFAULTS_PENALTY = 0.3;

/** Provisional - confidence subtracted per panic turn (capped by PANIC_TURNS_CAP). */
export const CONFIDENCE_PANIC_PENALTY_PER_TURN = 0.12;

/** Provisional - panic turns beyond this do not deepen the confidence penalty. */
export const CONFIDENCE_PANIC_TURNS_CAP = 4;

/** Provisional - flat confidence penalty when the prop book was force-liquidated this turn. */
export const CONFIDENCE_FORCED_LIQUIDATION_PENALTY = 0.15;

/** Provisional - confidence >= this is green. */
export const CONFIDENCE_BAND_GREEN_MIN = 0.7;

/** Provisional - confidence >= this (and below green) is amber; else red. */
export const CONFIDENCE_BAND_AMBER_MIN = 0.4;

export type ConfidenceBand = "green" | "amber" | "red";

export type ConfidenceInput = {
  liquidCapital: number;
  postedCapital: number;
  totalDeposits: number;
  totalLoans: number;
  reserveRatioRequired: number;
  arrearsOutstanding: number;
  defaultsLastTurn: number;
  panicTurns: number;
  /** True when bankSolvencyTurn forced a prop-book leverage liquidation this turn. */
  forcedLiquidation?: boolean;
  /**
   * B8 discount-window stigma, already computed on the 0..1 confidence scale by
   * `discountWindowStigma`. Passed in rather than derived here so this module
   * stays pure and free of banking imports. Absent/0 for a bank that has not
   * drawn on the window, which is nearly all of them.
   */
  discountWindowStigma?: number;
};

export type ConfidenceResult = {
  confidence: number;
  band: ConfidenceBand;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Solvency/liquidity confidence in [0, 1] plus the published warning band.
 *
 *   reserveCover = liquid / max(1, reserveRatio * deposits), capped at 1.5
 *   capitalCover = (liquid + posted) / max(1, loans), capped at 1
 *   assetQuality = 1 - arrearsShare*0.7 - defaultsShare*0.3
 *   raw = 0.45*min(1,reserveCover) + 0.25*capitalCover + 0.30*assetQuality
 *   confidence = clamp(raw - 0.12*min(panicTurns, 4) - (forcedLiq ? 0.15 : 0), 0, 1)
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const liquidCapital = Math.max(0, finiteOrZero(input.liquidCapital));
  const postedCapital = Math.max(0, finiteOrZero(input.postedCapital));
  const totalDeposits = Math.max(0, finiteOrZero(input.totalDeposits));
  const totalLoans = Math.max(0, finiteOrZero(input.totalLoans));
  const reserveRatioRequired = Math.max(0, finiteOrZero(input.reserveRatioRequired));
  const arrearsOutstanding = Math.max(0, finiteOrZero(input.arrearsOutstanding));
  const defaultsLastTurn = Math.max(0, finiteOrZero(input.defaultsLastTurn));
  const panicTurns = Math.max(0, finiteOrZero(input.panicTurns));
  const forcedLiquidation = input.forcedLiquidation === true;

  const reserveCover = Math.min(
    CONFIDENCE_RESERVE_COVER_CAP,
    liquidCapital / Math.max(1, reserveRatioRequired * totalDeposits)
  );
  const capitalCover = Math.min(
    CONFIDENCE_CAPITAL_COVER_CAP,
    (liquidCapital + postedCapital) / Math.max(1, totalLoans)
  );
  const loanDenom = Math.max(1, totalLoans);
  const assetQuality =
    1 -
    clamp(arrearsOutstanding / loanDenom, 0, 1) * CONFIDENCE_ARREARS_PENALTY -
    clamp(defaultsLastTurn / loanDenom, 0, 1) * CONFIDENCE_DEFAULTS_PENALTY;

  const raw =
    CONFIDENCE_RESERVE_WEIGHT * Math.min(1, reserveCover) +
    CONFIDENCE_CAPITAL_WEIGHT * capitalCover +
    CONFIDENCE_ASSET_QUALITY_WEIGHT * assetQuality;

  // Borrowing from the lender of last resort is a signal, not just a loan: the
  // market reads it as a bank that could not fund itself elsewhere. It is a
  // penalty rather than a weight so a bank that never touches the window is
  // scored exactly as it was before B8.
  const penalized =
    raw -
    CONFIDENCE_PANIC_PENALTY_PER_TURN * Math.min(panicTurns, CONFIDENCE_PANIC_TURNS_CAP) -
    (forcedLiquidation ? CONFIDENCE_FORCED_LIQUIDATION_PENALTY : 0) -
    Math.max(0, finiteOrZero(input.discountWindowStigma));
  const confidence = clamp(penalized, 0, 1);

  const band: ConfidenceBand =
    confidence >= CONFIDENCE_BAND_GREEN_MIN
      ? "green"
      : confidence >= CONFIDENCE_BAND_AMBER_MIN
        ? "amber"
        : "red";

  return { confidence, band };
}
