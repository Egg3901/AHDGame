/**
 * Phase 7 corporate insolvency detector.
 *
 * Conservative rule: only treat a corp as insolvent when liquidCapital has
 * gone strictly negative. Design Section 5.4 layered receivables + projected
 * coupon obligations on top; that refinement is deferred to Phase 10
 * calibration so this phase exercises the cascade bound cleanly with a
 * single, well-tested check.
 *
 * NaN defaults to solvent — broken inputs should not trigger a cascade.
 */

export interface InsolvencyInputs {
  liquidCapital: number;
}

export function isCorporationInsolvent(inputs: InsolvencyInputs): boolean {
  const lc = inputs.liquidCapital;
  if (!Number.isFinite(lc)) return false;
  return lc < 0;
}
