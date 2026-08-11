"use client";

import { useState } from "react";

interface CandidateInfo {
  name: string;
  party: string;
  votes: number;
  currentSeats: number;
  expectedSeats: number;
}

interface MisallocatedElection {
  electionId: string;
  electionType: string;
  state: string;
  totalSeats: number;
  currentWinners: number;
  expectedWinners: number;
  candidates: CandidateInfo[];
}

interface DiagnosticResult {
  status: string;
  message: string;
  totalChecked?: number;
  misallocated: MisallocatedElection[];
}

export function HealMultiSeatElections() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/multi-seat-elections");
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
        "This will recalculate seat allocation for all recent House/State Senate elections and update electedOfficials.\n\nThis may change who holds office. Continue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/multi-seat-elections", { method: "POST" });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const formatVotes = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toString();
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal House & State Senate Elections</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes multi-seat elections where seats were incorrectly allocated (e.g., all seats going
          to one candidate due to vote threshold issues). Recalculates seat distribution and updates
          electedOfficials.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running…" : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing…" : "Heal All"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-3 text-xs">
          {diagnostic.status === "no_elections" ? (
            <p className="text-muted">{diagnostic.message}</p>
          ) : diagnostic.status === "ok" ? (
            <p className="text-success">
              All {diagnostic.totalChecked} checked elections have correct seat allocation.
            </p>
          ) : (
            <>
              <p className="font-medium text-error">{diagnostic.message}</p>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {diagnostic.misallocated.map((e) => (
                  <div
                    key={e.electionId}
                    className="border-t border-card-border pt-2 first:border-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {e.electionType === "house" ? "House" : "State Senate"} — {e.state}
                      </span>
                      <span className="text-muted">
                        {e.totalSeats} seat{e.totalSeats !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-muted">
                      <span className="text-error">Current: {e.currentWinners} winner(s)</span>
                      {" → "}
                      <span className="text-success">Expected: {e.expectedWinners} winner(s)</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {e.candidates.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px]">
                          <span className="truncate max-w-[150px]">
                            {c.name} ({c.party})
                          </span>
                          <span>
                            {formatVotes(c.votes)} votes →{" "}
                            <span
                              className={
                                c.expectedSeats > 0 ? "text-success font-medium" : "text-muted"
                              }
                            >
                              {c.expectedSeats} seat{c.expectedSeats !== 1 ? "s" : ""}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
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
