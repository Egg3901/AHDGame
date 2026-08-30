import type { VoteShiftPreview as VoteShiftPreviewData } from "@/lib/legislature/voteShiftPreview";
import { getEconomicAxisTickLabels, getSocialAxisTickLabels } from "@/lib/utils/politics";

type AxisDelta = VoteShiftPreviewData["aye"];

function describeAxis(label: string, delta: number, negative: string, positive: string): string {
  if (delta === 0) return `${label} no change`;
  const toward = delta < 0 ? negative : positive;
  return `${label} ${Math.abs(delta).toFixed(2)} toward ${toward}`;
}

function describeVote(delta: AxisDelta, isCurrentVote: boolean): string {
  if (delta.economic === 0 && delta.social === 0) {
    // Zero can also mean the voter sits at the edge of the scale, so the line
    // states the outcome and does not guess at the reason.
    return isCurrentVote ? "your current vote, no further change" : "no change";
  }
  const econ = getEconomicAxisTickLabels();
  const social = getSocialAxisTickLabels();
  return [
    describeAxis("Economic", delta.economic, econ.negative, econ.positive),
    describeAxis("Social", delta.social, social.negative, social.positive),
  ].join(", ");
}

/**
 * Two lines above the Aye/Nay buttons telling the viewer how each vote would
 * move their own positions. The numbers come from the server, computed by the
 * same code that applies the shift, so what is shown is what will happen.
 */
export function VoteShiftPreview({
  preview,
  currentVote = null,
  className = "",
}: {
  preview: VoteShiftPreviewData | null | undefined;
  /** The vote already on record, so a zero-move line reads as "your current vote". */
  currentVote?: "for" | "against" | "abstain" | null;
  className?: string;
}) {
  if (!preview) return null;
  const isStill = (d: AxisDelta) => d.economic === 0 && d.social === 0;
  if (isStill(preview.aye) && isStill(preview.nay)) {
    // No ideology on this bill (or a vote that predates the ledger): neither
    // button moves the voter, and claiming a position match would be false.
    return (
      <p className={`text-xs text-muted ${className}`.trim()}>
        This vote does not move your positions.
      </p>
    );
  }
  return (
    <div className={`space-y-0.5 text-xs text-muted ${className}`.trim()}>
      <p>
        <span className="font-semibold text-success">Aye:</span>{" "}
        {describeVote(preview.aye, currentVote === "for")}
      </p>
      <p>
        <span className="font-semibold text-error">Nay:</span>{" "}
        {describeVote(preview.nay, currentVote === "against")}
      </p>
    </div>
  );
}
