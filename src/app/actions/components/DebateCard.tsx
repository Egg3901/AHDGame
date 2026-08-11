"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

interface StrategyOption {
  id: string;
  label: string;
  blurb: string;
  linkedStat: string;
}

interface ActiveDebate {
  id: string;
  opponentName: string;
  deadlineRealtimeMs: number;
  canSubmit: boolean;
  submittedStrategies: string[] | null;
  strategyOptions: StrategyOption[];
}

interface LastResolvedDebate {
  id: string;
  opponentName: string;
  result: "won" | "lost" | "draw";
  favorabilitySwing: number;
  myStrategies: string[];
  resolvedAt: string | null;
}

interface DebateOutcome {
  result: "challenger" | "opponent" | "draw";
  favorabilitySwing: number;
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "resolving…";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

const STAT_LABEL: Record<string, string> = {
  debate: "Debate",
  charisma: "Charisma",
  statecraft: "Statecraft",
};

/**
 * Election-debate card on the Actions page. Renders nothing unless the player
 * has an active debate (or a recently resolved one to summarize). Lets the
 * player commit to a single risk/reward strategy before the deadline.
 */
export default function DebateCard() {
  const [debate, setDebate] = useState<ActiveDebate | null>(null);
  const [lastResolved, setLastResolved] = useState<LastResolvedDebate | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DebateOutcome | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{
      active?: ActiveDebate;
      lastResolved?: LastResolvedDebate;
    } | null>("/api/debates/active", { feature: "debate-active" })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.active) setDebate(data.active);
        else if (data.lastResolved) setLastResolved(data.lastResolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!debate || outcome) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [debate, outcome]);

  // Single-select: picking a strategy replaces any prior pick; clicking the
  // current pick clears it. Debates are one-pick.
  const toggle = (id: string) => {
    setSelected((prev) => (prev[0] === id ? [] : [id]));
  };

  const submit = useCallback(async () => {
    if (!debate || selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/debates/${debate.id}/strategies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategies: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to submit strategies.");
      if (data.resolved && data.outcome) setOutcome(data.outcome);
      // Either resolved now, or waiting on the opponent — clear the input either way.
      setDebate(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit strategies.");
      setSubmitting(false);
    }
  }, [debate, selected, submitting]);

  // Resolved-this-session summary.
  if (outcome) {
    return (
      <div
        ref={cardRef}
        className="rounded-xl border border-card-border bg-card/50 p-5 shadow-card backdrop-blur-sm"
      >
        <h3 className="text-base font-semibold text-foreground">Debate concluded</h3>
        <p className="mt-1 text-sm text-muted">
          {outcome.result === "draw"
            ? "The debate ended in a draw — no change to favorability."
            : `Result decided by a ${outcome.favorabilitySwing}-point favorability swing.`}
        </p>
      </div>
    );
  }

  // Post-submit waiting state (opponent hasn't resolved yet).
  if (!debate && !lastResolved) return null;

  if (!debate && lastResolved) {
    const tone =
      lastResolved.result === "won"
        ? "text-success"
        : lastResolved.result === "lost"
          ? "text-error"
          : "text-muted";
    return (
      <div
        ref={cardRef}
        className="rounded-xl border border-card-border bg-card/50 p-5 shadow-card backdrop-blur-sm"
      >
        <h3 className="text-base font-semibold text-foreground">Recent debate</h3>
        <p className="mt-1 text-sm text-muted">
          vs. {lastResolved.opponentName} —{" "}
          <span className={`font-semibold ${tone}`}>
            {lastResolved.result === "won"
              ? `Won (+${lastResolved.favorabilitySwing} favorability)`
              : lastResolved.result === "lost"
                ? `Lost (−${lastResolved.favorabilitySwing} favorability)`
                : "Draw"}
          </span>
        </p>
      </div>
    );
  }

  if (!debate) return null;

  const msLeft = debate.deadlineRealtimeMs - now;
  const submitted = debate.submittedStrategies ?? [];
  const hasSubmitted = !debate.canSubmit && submitted.length > 0;

  return (
    <div
      ref={cardRef}
      className="overflow-hidden rounded-xl border border-primary/30 bg-card/50 shadow-card backdrop-blur-sm"
    >
      <div className="relative px-5 pt-5 pb-1">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/60 via-secondary/30 to-transparent" />
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">
            Debate challenge — {debate.opponentName}
          </h3>
          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary">
            {formatCountdown(msLeft)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {hasSubmitted
            ? "You've locked in your strategy — this debate resolves at the deadline."
            : "Pick your debate strategy. Each leans on a different stat with its own risk/reward — a bold attack swings hard, staying above the fray plays it safe."}
        </p>
      </div>

      <div className="space-y-2 p-5 pt-3">
        {debate.strategyOptions.map((opt) => {
          const isOn = selected.includes(opt.id);
          const isSubmittedChoice = hasSubmitted && submitted.includes(opt.id);
          const stateClass = isSubmittedChoice
            ? "border-success/60 bg-success/10"
            : hasSubmitted
              ? "border-card-border bg-background opacity-50"
              : isOn
                ? "border-primary/60 bg-primary/10"
                : "border-card-border bg-background hover:border-primary/40";
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              disabled={!debate.canSubmit}
              className={`block w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${stateClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                {isSubmittedChoice ? (
                  <span className="shrink-0 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    ✓ You selected
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {STAT_LABEL[opt.linkedStat] ?? opt.linkedStat}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">{opt.blurb}</p>
            </button>
          );
        })}

        {error && (
          <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        {debate.canSubmit ? (
          <button
            type="button"
            onClick={submit}
            disabled={selected.length === 0 || submitting}
            className="mt-1 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Submitting…"
              : selected.length === 0
                ? "Select a strategy"
                : "Commit strategy"}
          </button>
        ) : hasSubmitted ? null : (
          <p className="mt-1 text-xs italic text-muted">
            Waiting on the other candidate. This debate resolves at the deadline.
          </p>
        )}
      </div>
    </div>
  );
}
