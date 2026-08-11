"use client";

import { useEffect, useState } from "react";

type Choice = "bailout" | "repudiate" | "restructure" | "monetize";

interface ActiveLegislativePhase {
  chamberKey: string;
  endsAtRealtimeMs: number;
  /** Turn the voting window closes (turn-first countdown). Null on legacy phases. */
  endsOnTurn?: number | null;
  votesFor: number;
  votesAgainst: number;
  executiveChoice: string | null;
}

interface Status {
  crisisState: string;
  openDecisionId: string | null;
  // `turn` drives the drift-free countdown; `realtimeMs` is the legacy fallback.
  crisisAutoActionAt: { turn?: number | null; realtimeMs: number } | null;
  /** Current game turn — drives turn-based countdowns. */
  currentTurn: number | null;
  inflationRate: number; // percentage points
  activeLegislativePhase: ActiveLegislativePhase | null;
}

interface Props {
  countryCode: string;
}

const MONETIZE_GATE_INFLATION_PCT = 8.0;

interface ConsequenceLine {
  label: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

const RESOLUTION_CONSEQUENCES: Record<Choice, ConsequenceLine[]> = {
  bailout: [
    { label: "Market access", detail: "Stays open under IMF oversight", severity: "low" },
    { label: "GDP impact", detail: "−2% (austerity conditions)", severity: "medium" },
    { label: "Bond holders", detail: "Unaffected — IMF covers rollover", severity: "low" },
  ],
  restructure: [
    { label: "Bond holders", detail: "40% haircut; maturities extended", severity: "high" },
    { label: "Market lockout", detail: "16 turns", severity: "medium" },
    { label: "GDP / FX", detail: "−6% GDP over 2 turns, −15% FX", severity: "medium" },
  ],
  repudiate: [
    { label: "Bond holders", detail: "Full default — ~5¢ recovery", severity: "high" },
    { label: "Market lockout", detail: "48 turns", severity: "high" },
    { label: "GDP / FX", detail: "−12% GDP over 3 turns, −40% FX", severity: "high" },
    { label: "Political risk", detail: "No-confidence motion likely", severity: "high" },
  ],
  monetize: [
    { label: "Market access", detail: "No lockout", severity: "low" },
    { label: "Inflation", detail: "Spike proportional to printed amount", severity: "high" },
    { label: "FX", detail: "Depreciates ~40% of inflation fraction", severity: "medium" },
  ],
};

const RESOLUTION_LABELS: Record<string, string> = {
  bailout: "IMF Bailout",
  restructure: "Restructure (40% haircut)",
  repudiate: "Repudiate (full default)",
  monetize: "Monetize (print money)",
};

export function SovereignCrisisDecisionPanel({ countryCode }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [submitting, setSubmitting] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/country/${countryCode}/sovereign-status`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          crisisState?: string;
          openDecisionId?: string | null;
          crisisAutoActionAt?: { turn?: number | null; realtimeMs: number } | null;
          currentTurn?: number | null;
          snapshot?: { inflationRate?: number };
          activeLegislativePhase?: ActiveLegislativePhase | null;
        };
        if (!cancelled)
          setStatus({
            crisisState: data.crisisState ?? "normal",
            openDecisionId: data.openDecisionId ?? null,
            crisisAutoActionAt: data.crisisAutoActionAt ?? null,
            currentTurn: data.currentTurn ?? null,
            // sovereign-status snapshot stores inflation as fraction; convert to pp for UI
            inflationRate: (data.snapshot?.inflationRate ?? 0) * 100,
            activeLegislativePhase: data.activeLegislativePhase ?? null,
          });
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (!status) return null;
  if (status.activeLegislativePhase) {
    return (
      <LegislativeVotingPanel
        countryCode={countryCode}
        phase={status.activeLegislativePhase}
        currentTurn={status.currentTurn}
      />
    );
  }
  if (status.crisisState !== "crisisPending") return null;

  // Turn-first countdown (freezes on pause, matches the engine's auto-action
  // timer) with a wall-clock fallback for a crisis fired before `.turn` existed.
  const remainingTurns = status.crisisAutoActionAt
    ? typeof status.crisisAutoActionAt.turn === "number" && status.currentTurn != null
      ? Math.max(0, status.crisisAutoActionAt.turn - status.currentTurn)
      : Math.max(0, Math.round((status.crisisAutoActionAt.realtimeMs - now) / 3_600_000))
    : null;

  const monetizeGated = status.inflationRate > MONETIZE_GATE_INFLATION_PCT;

  async function submit(choice: Choice) {
    setSubmitting(choice);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/sovereign-resolution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Submission failed (${res.status})`);
        setSubmitting(null);
        return;
      }
      setTimeout(() => window.location.reload(), 400);
    } catch {
      setSubmitting(null);
    }
  }

  const monetizeLabel = monetizeGated
    ? `Monetize — unavailable (inflation ${status.inflationRate.toFixed(1)}% exceeds 8%)`
    : "Monetize (print money)";

  const options: { choice: Choice; label: string; accentClass: string; disabled: boolean }[] = [
    {
      choice: "bailout",
      label: "IMF Bailout",
      accentClass: "border-emerald-600/40 bg-emerald-500/5",
      disabled: submitting !== null,
    },
    {
      choice: "restructure",
      label: "Restructure",
      accentClass: "border-amber-500/40 bg-amber-500/5",
      disabled: submitting !== null,
    },
    {
      choice: "repudiate",
      label: "Repudiate (full default)",
      accentClass: "border-rose-600/40 bg-rose-500/5",
      disabled: submitting !== null,
    },
    {
      choice: "monetize",
      label: monetizeLabel,
      accentClass: monetizeGated
        ? "border-card-border bg-card"
        : "border-violet-500/40 bg-violet-500/5",
      disabled: submitting !== null || monetizeGated,
    },
  ];

  return (
    <div className="rounded-lg border border-rose-500/60 bg-rose-500/5 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Sovereign Debt Crisis</h3>
          <p className="mt-0.5 text-xs text-muted">
            Bond auctions have failed three times. Choose a resolution path.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs text-muted">
            Inflation:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {status.inflationRate.toFixed(1)}%
            </span>
          </span>
          {remainingTurns !== null && (
            <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              Auto-action in {remainingTurns} turn{remainingTurns === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ choice, label, accentClass, disabled }) => {
          const consequences = RESOLUTION_CONSEQUENCES[choice];
          return (
            <div key={choice} className={`rounded-lg border p-3 ${accentClass}`}>
              <div className="text-sm font-medium text-foreground mb-2">{label}</div>
              <ul className="space-y-1 mb-3">
                {consequences.map((c) => (
                  <li key={c.label} className="flex items-baseline gap-1.5 text-xs">
                    <span className="text-muted shrink-0">{c.label}:</span>
                    <span
                      className={
                        c.severity === "high"
                          ? "text-error"
                          : c.severity === "medium"
                            ? "text-warning"
                            : "text-foreground"
                      }
                    >
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void submit(choice)}
                disabled={disabled}
                className="w-full rounded-md border border-current/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                {submitting === choice
                  ? "Submitting…"
                  : choice === "monetize" && monetizeGated
                    ? "Unavailable"
                    : "Choose this path"}
              </button>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}

function LegislativeVotingPanel({
  countryCode,
  phase,
  currentTurn,
}: {
  countryCode: string;
  phase: ActiveLegislativePhase;
  currentTurn: number | null;
}) {
  const [submitting, setSubmitting] = useState<"for" | "against" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  // Turn-first countdown (freezes on pause; matches the vote-window resolver)
  // with a wall-clock fallback for phases opened before `endsOnTurn` existed.
  const remainingTurns =
    typeof phase.endsOnTurn === "number" && currentTurn != null
      ? Math.max(0, phase.endsOnTurn - currentTurn)
      : Math.max(0, Math.round((phase.endsAtRealtimeMs - now) / 3_600_000));

  async function vote(choice: "for" | "against") {
    setSubmitting(choice);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/sovereign-resolution/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote: choice }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Submission failed (${res.status})`);
        return;
      }
      window.location.reload();
    } finally {
      setSubmitting(null);
    }
  }

  const total = phase.votesFor + phase.votesAgainst;
  const pctFor = total > 0 ? Math.min(100, Math.round((phase.votesFor / total) * 100)) : 50;
  const executiveLabel = phase.executiveChoice
    ? (RESOLUTION_LABELS[phase.executiveChoice] ?? phase.executiveChoice)
    : "n/a";

  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Legislative Ratification — {phase.chamberKey} chamber
      </h3>
      <p className="mt-1 text-xs text-muted">
        Executive proposed: <span className="font-medium text-foreground">{executiveLabel}</span>
        {" · "}
        <span className="font-medium tabular-nums">
          {remainingTurns} turn{remainingTurns === 1 ? "" : "s"}
        </span>{" "}
        remaining
      </p>

      <div className="mt-3 space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted">Vote tally</span>
          <span className="tabular-nums text-foreground">
            <span className="text-success">{phase.votesFor} for</span>
            {" · "}
            <span className="text-error">{phase.votesAgainst} against</span>
          </span>
        </div>
        {total > 0 && (
          <div className="flex h-1.5 overflow-hidden rounded bg-rose-200 dark:bg-rose-900">
            <div
              className="h-full bg-emerald-500 dark:bg-emerald-400 transition-all"
              style={{ width: `${pctFor}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void vote("for")}
          disabled={submitting !== null}
          className="rounded-md border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting === "for" ? "Submitting…" : "Vote For"}
        </button>
        <button
          type="button"
          onClick={() => void vote("against")}
          disabled={submitting !== null}
          className="rounded-md border border-rose-600 bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {submitting === "against" ? "Submitting…" : "Vote Against"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}
