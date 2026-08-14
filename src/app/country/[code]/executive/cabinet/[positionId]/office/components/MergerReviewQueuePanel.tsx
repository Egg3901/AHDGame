"use client";

import { useState } from "react";
import { MergerReviewCard, type MergerDecision } from "@/components/mergerReview/MergerReviewCard";
import type { MergerReviewQueueData } from "../useMergerReviewQueue";

interface Props {
  data: MergerReviewQueueData | null;
  onDecided: () => void;
  /** The seat's own action gate from the office briefing. */
  canAct: boolean;
}

/**
 * The competition officeholder's own surface: every merger referred to their
 * seat, and the decisions they have already handed down.
 *
 * Renders nothing when the duty does not apply, which the server decides. The
 * decision itself is authorized entirely server-side against the seat as it
 * stands at the moment of the request.
 */
export function MergerReviewQueuePanel({ data, onDecided, canAct }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  if (!data?.applies) return null;

  const pending = data.pending ?? [];
  const decided = data.decided ?? [];

  async function decide(id: string, decision: MergerDecision, note?: string) {
    setBusyId(id);
    setErr("");
    try {
      const res = await fetch(`/api/merger-reviews/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const d = await res.json();
      if (!res.ok) setErr(d.error || "Decision failed");
      else onDecided();
    } catch {
      setErr("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Merger review</h3>
      <p className="mt-1 text-xs text-muted">
        Mergers referred to the {data.seatName}. Every referral resolves on its deadline whether or
        not you act, on the published bands, so silence is itself a decision.
      </p>
      {!data.enforcementLive && (
        <p className="mt-2 text-xs text-muted">
          Antitrust enforcement is repealed. No new deal can be referred; the referrals below opened
          under the previous law and still need deciding.
        </p>
      )}
      {err && <p className="mt-2 text-xs text-error">{err}</p>}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        Awaiting your decision
      </h4>
      {pending.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No merger is waiting on you.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {pending.map((review) => (
            <MergerReviewCard
              key={review.id}
              review={review}
              busy={busyId === review.id}
              {...(canAct ? { onDecide: decide } : {})}
            />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
            Already decided
          </h4>
          <ul className="mt-2 space-y-2">
            {decided.map((review) => (
              <MergerReviewCard key={review.id} review={review} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
