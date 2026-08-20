import { fmtUnits } from "./plants";

/**
 * Copy under the Market Position pie after ticket #1145 dropped the Unowned
 * slice. A sole producer now reads 100%, which players (ticket #1155) took as
 * "the market is full / my unfinished farms are wasted." Share is of current
 * producers' sales, not of demand. Return null when the pie already explains
 * itself (unowned wedge still present, or other producers on the chart).
 */
export function marketShareExplainer(opts: {
  marketShare: number;
  competitorCount: number;
  unownedPercent: number;
  demandGapUnits?: number | null;
  pendingBuildUnits?: number | null;
}): string | null {
  if ((opts.unownedPercent ?? 0) > 0.05) return null;
  const soleProducer = opts.competitorCount === 0 && opts.marketShare >= 99.5;
  if (!soleProducer) return null;

  const parts: string[] = [
    "You are the only producer here right now. This pie is your share of current sales, not a cap on demand.",
  ];
  if ((opts.pendingBuildUnits ?? 0) > 0) {
    parts.push("Capacity still being built does not count in this share until it comes online.");
  }
  const gap = opts.demandGapUnits;
  if (gap != null && Number.isFinite(gap)) {
    if (gap >= 1) {
      parts.push(`Buyers still have room for about ${fmtUnits(gap)} more units a day.`);
    } else {
      parts.push(
        "Buyers are already taking all they need. Extra output sells only if you take volume from a rival or demand grows."
      );
    }
  }
  return parts.join(" ");
}

/** Remaining capacity still in the build queue, in output units. */
export function pendingBuildUnits(
  queue: ReadonlyArray<{ unitsOrdered: number; unitsDelivered: number }> | null | undefined
): number {
  if (!queue || queue.length === 0) return 0;
  let total = 0;
  for (const order of queue) {
    const ordered = Number.isFinite(order.unitsOrdered) ? order.unitsOrdered : 0;
    const delivered = Number.isFinite(order.unitsDelivered) ? order.unitsDelivered : 0;
    total += Math.max(0, ordered - delivered);
  }
  return total;
}
