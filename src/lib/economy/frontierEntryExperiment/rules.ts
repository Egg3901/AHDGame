/**
 * An uncovered positive-use market may use the experiment's bounded slot
 * outside the ordinary eight-turn corporate stagger. This is a pacing
 * override only: profit and margin must already pass, and unknown demand or
 * existing supply cannot qualify. Pricing, finance and policy remain binding.
 */
export function frontierPacingOpportunity(args: {
  reason: string;
  uncoveredMarket: boolean;
  positiveLocalUse: boolean;
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
}): boolean {
  return (
    args.reason === "cohort_ineligible" &&
    args.uncoveredMarket === true &&
    args.positiveLocalUse === true &&
    args.profitable === true &&
    Number.isFinite(args.marginPct) &&
    Number.isFinite(args.marginFloorPct) &&
    args.marginPct >= args.marginFloorPct
  );
}
