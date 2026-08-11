"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface PrivatizationVoteData {
  _id: string;
  status: "open" | "passed" | "failed" | "cancelled";
  openedAtTurn: number;
  deadlineAtTurn: number;
  lockedBuyoutPrice: number;
  lockedBuyoutCurrency: string;
  totalReservedCash: number;
  votes: Array<{
    characterId?: string;
    corporationId?: string;
    voteShares: number;
    vote: "yes" | "no";
  }>;
  tally: { yes: number; no: number };
  resolvedAt?: string;
}

interface Props {
  corporationId: string;
  voteId: string;
  isCeo: boolean;
  viewerCharacterId: string | null;
  viewerHoldsShares: boolean;
  currentTurn: number;
  onResolved?: () => void;
}

/**
 * Visible to the CEO and any non-CEO shareholder while a privatization vote is
 * open. Polls the vote endpoint (which lazily resolves past-deadline votes).
 * CEO sees a Cancel Vote button; shareholders see Yes/No.
 */
export function PrivatizationVotePanel({
  corporationId,
  voteId,
  isCeo,
  viewerCharacterId,
  viewerHoldsShares,
  currentTurn,
  onResolved,
}: Props) {
  const [vote, setVote] = useState<PrivatizationVoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { formatAmount } = useCurrency();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(initial: boolean) {
      if (initial) setLoading(true);
      try {
        const res = await fetch(`/api/corporations/${corporationId}/privatize/${voteId}`);
        const data = await res.json();
        if (cancelled) return;
        const loaded = data.vote ?? null;
        setVote(loaded);
        if (loaded && loaded.status !== "open") {
          // Vote was resolved (passed/failed/cancelled) — refresh corp data so the
          // panel unmounts and the page reflects current state (cooldown, isPrivate, etc.).
          onResolved?.();
          return;
        }
        timer = setTimeout(() => load(false), 15_000);
      } catch {
        if (!cancelled) timer = setTimeout(() => load(false), 15_000);
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    }
    load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [corporationId, voteId, onResolved]);

  async function castVote(value: "yes" | "no") {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/privatize/${voteId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: value }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed to vote");
        return;
      }
      const data = await res.json();
      setVote((prev) => (prev ? { ...prev, tally: data.tally } : prev));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelVote() {
    if (!isCeo) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/privatize/${voteId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed to cancel");
        return;
      }
      onResolved?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-sm text-muted">Loading privatization vote…</div>;
  if (!vote) return null;

  const turnsLeft = Math.max(0, vote.deadlineAtTurn - currentTurn);
  const myVote = vote.votes.find((v) => viewerCharacterId && v.characterId === viewerCharacterId);
  const currency = vote.lockedBuyoutCurrency as CurrencyCode;
  const totalCast = vote.tally.yes + vote.tally.no;
  const yesPct = totalCast > 0 ? (vote.tally.yes / totalCast) * 100 : 0;

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 my-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-foreground">Privatization Vote</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded font-semibold border ${
            vote.status === "open"
              ? "border-primary/40 bg-primary/10 text-primary"
              : vote.status === "passed"
                ? "border-success/40 bg-success/10 text-success"
                : "border-error/40 bg-error/10 text-error"
          }`}
        >
          {vote.status.toUpperCase()}
        </span>
      </div>

      <div className="text-xs space-y-1 mb-3">
        <div className="flex justify-between">
          <span className="text-muted">Buyout price (locked)</span>
          <span className="tabular-nums font-semibold">
            {formatAmount(vote.lockedBuyoutPrice, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Turns remaining</span>
          <span className="tabular-nums font-semibold">{turnsLeft}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Yes / No (votes)</span>
          <span className="tabular-nums font-semibold">
            {vote.tally.yes.toLocaleString("en-US")} / {vote.tally.no.toLocaleString("en-US")}
            {totalCast > 0 ? ` (${yesPct.toFixed(0)}% yes)` : ""}
          </span>
        </div>
      </div>

      {error && <div className="text-xs text-error mb-2">{error}</div>}

      {vote.status === "open" && isCeo && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            You opened this vote as the buyer. Non-CEO shareholders vote yes/no on accepting your
            buyout offer at the locked price; if it passes, you purchase their shares with the
            reserved cash. You can cancel to release the reservation.
          </p>
          <button
            onClick={cancelVote}
            disabled={submitting}
            className="rounded-lg border border-card-border px-3 py-1.5 text-sm hover:bg-card transition-colors disabled:opacity-50"
          >
            {submitting ? "Cancelling…" : "Cancel Vote"}
          </button>
        </div>
      )}

      {vote.status === "open" && !isCeo && viewerHoldsShares && (
        <div className="flex gap-2">
          <button
            onClick={() => castVote("yes")}
            disabled={submitting}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              myVote?.vote === "yes"
                ? "bg-primary text-white"
                : "border border-card-border hover:bg-card"
            }`}
          >
            Vote Yes
          </button>
          <button
            onClick={() => castVote("no")}
            disabled={submitting}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              myVote?.vote === "no"
                ? "bg-error text-white"
                : "border border-card-border hover:bg-card"
            }`}
          >
            Vote No
          </button>
        </div>
      )}

      {vote.status === "open" && !isCeo && !viewerHoldsShares && (
        <p className="text-xs text-muted">
          You hold no shares in this corporation, so you cannot vote.
        </p>
      )}
    </div>
  );
}
