/**
 * Portable rules for player acquisition of AI-run (NPP) corporations (#217).
 *
 * Pure data in, plain data out: no database, no clock, no randomness, no
 * environment. The shell (`acquisitionOffers.ts`) loads the documents, calls
 * these, and writes the results back.
 *
 * An NPP-run target has no human CEO who can press "Accept", so a qualifying
 * offer auto-resolves deterministically against the existing reference
 * valuation anchor: accept at or above a modest premium over fair value,
 * reject below it. The premium is the friction against cheap roll-ups of
 * small NPP corps; concentration and bank-charter concerns stay with the
 * existing merger-review gate and executor guards, which run unchanged.
 */

export const NPP_ACQUISITION_PREMIUM_MULTIPLIER = 1.1;

/** Minimal shape the classifier needs; deliberately not the full Corporation. */
export interface NppAcquisitionTargetLike {
  ceoType?: "character" | "imperial" | "npp";
  /** Present while a player-appointed NPP caretaker runs a player-owned corp. */
  caretakerCeo?: unknown;
}

/**
 * Whether an offer against this target auto-resolves instead of waiting for a
 * human "Accept". True only for genuinely AI-run corps: `ceoType "npp"`
 * without a caretaker overlay. Caretaker-run corps stay player property, so
 * they keep the pending offer + owner notification flow.
 */
export function isNppAutoResolvableTarget(target: NppAcquisitionTargetLike): boolean {
  return target.ceoType === "npp" && !target.caretakerCeo;
}

/**
 * The asking price (anchor units) for an NPP-run target at the given reference
 * valuation: the valuation plus the NPP premium, rounded up so a fractional
 * premium never resolves below fair value plus premium.
 */
export function nppAcquisitionMinimumPrice(targetValuationAnchor: number): number {
  if (!Number.isFinite(targetValuationAnchor) || targetValuationAnchor <= 0) return 0;
  return Math.ceil(targetValuationAnchor * NPP_ACQUISITION_PREMIUM_MULTIPLIER);
}

/** Deterministic price gate: accept iff the offered price meets the asking price. */
export function meetsNppAcquisitionThreshold(
  priceAnchor: number,
  targetValuationAnchor: number
): boolean {
  if (!Number.isFinite(priceAnchor)) return false;
  return priceAnchor >= nppAcquisitionMinimumPrice(targetValuationAnchor);
}
