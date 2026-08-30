import { useCountdown } from "@/hooks/useCountdown";
import { VoteShiftPreview } from "@/components/bills/VoteShiftPreview";
import type { VoteShiftPreview as VoteShiftPreviewData } from "@/lib/legislature/voteShiftPreview";

export function VoteBar({
  votesFor,
  votesAgainst,
  votesAbstain,
  label,
  deadline,
  myVote,
  canVote,
  onVote,
  omitAbstain = false,
  requiredPct,
  requiredLabel,
  shiftPreview,
}: {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  label: string;
  deadline: string | null;
  myVote: "for" | "against" | "abstain" | null;
  canVote: boolean;
  onVote?: (v: "for" | "against" | "abstain") => void;
  /** When true, only For / Against buttons (e.g. veto override). */
  omitAbstain?: boolean;
  /** If set, draws a threshold marker at this % and shows a "Needs X%" label. */
  requiredPct?: number;
  /** When set, the threshold flag shows this text instead of the raw percentage. */
  requiredLabel?: string;
  /** What Aye and Nay would do to the viewer's positions; shown above the buttons. */
  shiftPreview?: VoteShiftPreviewData | null;
}) {
  const total = votesFor + votesAgainst + votesAbstain || 1;
  const pctFor = (votesFor / total) * 100;
  const pctAgn = (votesAgainst / total) * 100;
  const pctAbs = (votesAbstain / total) * 100;
  const countdown = useCountdown(deadline);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        {deadline && (
          <span
            className={`text-xs tabular-nums font-mono ${countdown === "Expired" ? "text-red-400" : "text-yellow-400"}`}
          >
            ⏱ {countdown}
          </span>
        )}
      </div>

      {/* Bar */}
      <div className="relative">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-card-border gap-px">
          <div
            style={{ width: `${pctFor}%`, backgroundColor: "#22c55e" }}
            className="transition-all"
          />
          <div
            style={{ width: `${pctAgn}%`, backgroundColor: "#ef4444" }}
            className="transition-all"
          />
          <div
            style={{ width: `${pctAbs}%`, backgroundColor: "#6b7280" }}
            className="transition-all"
          />
        </div>
        {requiredPct !== undefined && (
          <div
            className="absolute top-[-4px] bottom-[-4px] w-[2px] rounded-full bg-amber-300"
            style={{ left: `calc(${requiredPct}% - 1px)` }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        <span className="text-success">
          ✓ {votesFor} For ({pctFor.toFixed(0)}%)
        </span>
        <span className="text-error">
          ✗ {votesAgainst} Against ({pctAgn.toFixed(0)}%)
        </span>
        {votesAbstain > 0 && <span className="text-muted">– {votesAbstain} Abstain</span>}
        {(requiredLabel !== undefined || requiredPct !== undefined) && (
          <span className="text-amber-400 font-medium">
            ⚑ {requiredLabel ?? `${requiredPct}% needed to pass`}
          </span>
        )}
      </div>

      {myVote && (
        <p className="text-xs text-muted">
          Your vote:{" "}
          <span
            className={`font-semibold ${myVote === "for" ? "text-success" : myVote === "against" ? "text-error" : "text-muted"}`}
          >
            {myVote}
          </span>
          {canVote && <span className="ml-2 text-muted/60">(click below to change)</span>}
        </p>
      )}

      {canVote && onVote && <VoteShiftPreview preview={shiftPreview} className="pt-1" />}

      {canVote && onVote && (
        <div className="flex gap-2 pt-1">
          {(omitAbstain
            ? (["for", "against"] as const)
            : (["for", "against", "abstain"] as const)
          ).map((v) => (
            <button
              key={v}
              onClick={() => onVote(v)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors capitalize ${
                myVote === v
                  ? v === "for"
                    ? "border-success/50 bg-success/20 text-success"
                    : v === "against"
                      ? "border-error/50 bg-error/20 text-error"
                      : "border-card-border bg-card-elevated text-muted"
                  : "border-card-border bg-card text-muted hover:text-foreground hover:border-foreground/20"
              }`}
            >
              {v === "for" ? "✓ For" : v === "against" ? "✗ Against" : "– Abstain"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
