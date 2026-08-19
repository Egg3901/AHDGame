"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import {
  MAX_STATE_ORG_BONUS_GENERAL,
  MAX_STATE_ORG_BONUS_PRIMARY,
  STATE_ORG_COST_ACTIONS,
  STATE_ORG_COST_FUNDS,
  STATE_ORG_MAX_LEVEL,
} from "@/lib/electionEngine/constants";

interface CandidateRow {
  characterId: string;
  characterName: string;
  level: number;
}

export function StateOrganizationPanel({ stateId }: { stateId: string }) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return fetch(`/api/political-operations/state-org/by-state/${stateId}`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates?: CandidateRow[] }) => {
        setCandidates(d.candidates ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [stateId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      trackAction("org.build", { stateId });
      const res = await fetch("/api/political-operations/state-org/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Build failed");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Organization in {stateId}</h3>
        <Link
          href="/political-operations"
          className="text-xs font-medium text-primary hover:underline"
        >
          Full organization map →
        </Link>
      </div>
      <p className="mb-2 text-xs text-muted">
        Per-candidate ground game investment. Each level multiplies the candidate&apos;s vote weight
        in this state in the primary <strong>and</strong> in the general election (+
        {Math.round(MAX_STATE_ORG_BONUS_PRIMARY * 100)}% primary, +
        {Math.round(MAX_STATE_ORG_BONUS_GENERAL * 100)}% general, at level {STATE_ORG_MAX_LEVEL}).
        Levels carry through the whole cycle and drop to 25% only after the general resolves. Build
        your own here, or open the map to invest across states.
      </p>
      {candidates.length === 0 ? (
        <p className="mb-3 text-sm text-muted">Nobody has invested here yet.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {candidates.map((c) => {
            const filled = "▓".repeat(c.level);
            const empty = "░".repeat(STATE_ORG_MAX_LEVEL - c.level);
            const pct = Math.round(
              (c.level / STATE_ORG_MAX_LEVEL) * MAX_STATE_ORG_BONUS_PRIMARY * 100
            );
            return (
              <li key={c.characterId} className="flex items-center justify-between">
                <span className="text-foreground">{c.characterName}</span>
                <span className="font-mono text-xs text-muted">
                  {filled}
                  {empty} Lv {c.level} · +{pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={build}
        className="w-full rounded border border-primary/60 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy
          ? "Building..."
          : `Build +1 here (${STATE_ORG_COST_ACTIONS} actions + $${STATE_ORG_COST_FUNDS.toLocaleString("en-US")})`}
      </button>
    </section>
  );
}
