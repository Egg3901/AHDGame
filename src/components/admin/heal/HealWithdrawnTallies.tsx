"use client";

import { useState } from "react";

interface DiagnosticResult {
  affectedTallies: number;
  affected: Array<{
    electionId: string;
    electionType: string;
    state: string;
    withdrawnCandidates: string[];
    staleVotes: number;
  }>;
}

export function HealWithdrawnTallies() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/elections/heal-withdrawn-tallies");
      const data = await res.json();
      if (res.ok) {
        setDiagnostic(data);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async () => {
    if (
      !confirm(
        "This will remove withdrawn candidates' vote data from all active election tallies.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/elections/heal-withdrawn-tallies", { method: "POST" });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Withdrawn Candidate Tallies</h3>
        <p className="mt-1 text-xs text-muted">
          Finds and removes withdrawn candidates&apos; votes, names, and seat estimates from active
          election tallies. Fixes incorrect vote share percentages and seat projections after NPP
          withdrawals.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running\u2026" : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing\u2026" : "Heal Now"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          <p className="font-medium">
            Found{" "}
            <span className={diagnostic.affectedTallies > 0 ? "text-error" : "text-success"}>
              {diagnostic.affectedTallies} tally record(s) with stale data
            </span>
          </p>
          {diagnostic.affected.length > 0 && (
            <div className="space-y-1">
              {diagnostic.affected.map((e, i) => (
                <div key={i} className="text-muted">
                  <span className="font-medium text-foreground/80">
                    {e.electionType} ({e.state})
                  </span>
                  {" — "}
                  {e.withdrawnCandidates.join(", ")} ({e.staleVotes.toLocaleString("en-US")} stale
                  votes)
                </div>
              ))}
            </div>
          )}
          {diagnostic.affectedTallies === 0 && (
            <p className="text-success">All tallies are clean.</p>
          )}
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
