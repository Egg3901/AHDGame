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
    return isCurrentVote
      ? "your current vote, no further change"
      : "no change, you already hold this position";
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
