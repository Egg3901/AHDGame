import { POSITIVE_MODIFIER_NET_CAP, type ActiveModifier } from "@/lib/utils/approvalModifiers";

export interface ApprovalBreakdown {
  /** Population-weighted state average, before any national adjustment. */
  stateAverage: number;
  /** Each national adjustment that moves the rating, rounded for display. */
  nationalAdjustments: ActiveModifier[];
  /** Sum of the adjustments as `applyModifiers` applied them (cap included). */
  nationalNet: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export const NATIONAL_CAP_ADJUSTMENT_ID = "national_positive_cap";

/**
 * Split a stored national rating into the state average and the national
 * adjustments applied after it.
 *
 * The snapshot runs every national modifier through one `applyModifiers` call
 * (positives capped, negatives not) and stores the list it consumed, so the
 * state average is the rating minus that call's net effect. Derived rather than
 * stored: it reconciles with the stored rating by construction, and it works
 * for snapshots written before this existed.
 *
 * When positives overshoot the cap a "cap" line is added so the lines still add
 * up. Adjustments that round to zero are dropped.
 */
export function buildApprovalBreakdown(
  approval: number,
  nationalModifiers: ActiveModifier[]
): ApprovalBreakdown {
  let positive = 0;
  let negative = 0;
  for (const m of nationalModifiers) {
    if (!Number.isFinite(m.effect)) continue;
    if (m.effect >= 0) positive += m.effect;
    else negative += m.effect;
  }
  const cappedPositive = Math.min(positive, POSITIVE_MODIFIER_NET_CAP);
  const nationalNet = round1(cappedPositive + negative);

  const lines: ActiveModifier[] = nationalModifiers
    .filter((m) => Number.isFinite(m.effect) && round1(m.effect) !== 0)
    .map((m) => ({ ...m, effect: round1(m.effect) }));
  if (positive > cappedPositive) {
    lines.push({
      id: NATIONAL_CAP_ADJUSTMENT_ID,
      label: "Cap on combined positive effects",
      effect: round1(cappedPositive - positive),
      marginEffect: 0,
    });
  }

  return { stateAverage: round1(approval - nationalNet), nationalAdjustments: lines, nationalNet };
}

/** Display rounding for a modifier effect: one decimal, and null when it rounds to nothing. */
export function displayEffect(effect: number): number | null {
  if (!Number.isFinite(effect)) return null;
  if (effect === 0) return 0;
  const rounded = round1(effect);
  return rounded === 0 ? null : rounded;
}
