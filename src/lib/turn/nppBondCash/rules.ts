/** Bond returns retain the existing once-per-holder rounding of combined cash. */
export function roundedNppBondReturns(totalAnchor: number, coupon: number) {
  const total = Math.round(totalAnchor * 100) / 100;
  const couponAnchor = Math.min(total, Math.round(coupon * 100) / 100);
  return { total, couponAnchor, maturityAnchor: total - couponAnchor };
}
