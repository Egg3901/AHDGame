"use client";

import { useState } from "react";

/**
 * One merger-review card, shared by the two surfaces that show referrals.
 *
 * The two surfaces are different jobs and now have different endpoints: the
 * corporation panel shows a CEO the referrals their own deals are caught in,
 * and the cabinet office queue shows the seated officeholder the national
 * referrals they must decide. The CARD is the same object in both places on
 * purpose, so a deal reads identically to the firm and to the regulator.
 *
 * The deadline default is printed on every pending card deliberately. A
 * fallback the player cannot see is indistinguishable from a coin flip.
 */
export interface MergerReviewSummary {
  id: string;
  acquirerName: string;
  targetName: string;
  countryId: string;
  seatName: string;
  leadSectorType: string;
  combinedSharePercent: number;
  thresholdPercent: number;
  status: "pending" | "cleared" | "clearedWithRemedy" | "blocked";
  openedAtTurn: number;
  decideByTurn: number;
  defaultDecision: string;
  remedySectorType?: string;
  decisionNote?: string;
}

export const MERGER_STATUS_LABEL: Record<MergerReviewSummary["status"], string> = {
  pending: "Under review",
  cleared: "Cleared",
  clearedWithRemedy: "Cleared with conditions",
  blocked: "Blocked",
};

export const MERGER_DECISION_LABEL: Record<string, string> = {
  cleared: "Clear",
  clearedWithRemedy: "Clear with conditions",
  blocked: "Block",
};

export type MergerDecision = "cleared" | "clearedWithRemedy" | "blocked";

interface Props {
  review: MergerReviewSummary;
  /**
   * Present only on the officeholder surface. The server re-resolves the seat
   * on every decision, so this controls what is DRAWN, never what is allowed.
   */
  onDecide?: (id: string, decision: MergerDecision, note?: string) => Promise<void>;
  busy?: boolean;
}

export function MergerReviewCard({ review, onDecide, busy = false }: Props) {
  const [note, setNote] = useState("");

  return (
    <li className="rounded-lg border border-card-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          {review.acquirerName} to {review.targetName}
        </span>
        <span className="text-xs text-muted">{MERGER_STATUS_LABEL[review.status]}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Combined {review.combinedSharePercent}% of the {review.countryId} {review.leadSectorType}{" "}
        market, against a {review.thresholdPercent}% threshold. Referred to the {review.seatName}.
      </p>
      {review.status === "pending" && (
        <p className="mt-1 text-xs text-muted">
          A decision is due by turn {review.decideByTurn}. If the seat says nothing, this deal is{" "}
          <span className="font-semibold text-foreground">
            {MERGER_DECISION_LABEL[review.defaultDecision]?.toLowerCase() ?? review.defaultDecision}
          </span>
          .
        </p>
      )}
      {review.remedySectorType && (
        <p className="mt-1 text-xs text-muted">
          Condition: the combined firm must fall back below {review.thresholdPercent}% of the{" "}
          {review.remedySectorType} market. Spinning it into a wholly-owned subsidiary does not
          count; selling it down does.
        </p>
      )}
      {review.decisionNote && (
        <p className="mt-1 text-xs italic text-muted">&ldquo;{review.decisionNote}&rdquo;</p>
      )}
      {onDecide && review.status === "pending" && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reasons (optional, shown to both parties)"
            maxLength={500}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {(["cleared", "clearedWithRemedy", "blocked"] as const).map((decision) => (
              <button
                key={decision}
                type="button"
                disabled={busy}
                onClick={() => void onDecide(review.id, decision, note.trim() || undefined)}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-card-elevated disabled:opacity-50"
              >
                {MERGER_DECISION_LABEL[decision]}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
