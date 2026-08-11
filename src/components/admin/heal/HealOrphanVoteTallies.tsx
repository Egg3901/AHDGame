"use client";

import { useState } from "react";

interface DiagnosticResult {
  orphanTallies: number;
  examples: Array<{
    electionId: string;
    candidateCount: number;
  }>;
}

export function HealOrphanVoteTallies() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/elections/heal-orphan-tallies");
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
    if (!confirm("This will delete vote tallies for elections that no longer exist.\n\nContinue?"))
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/elections/heal-orphan-tallies", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Orphan Vote Tallies</h3>
        <p className="mt-1 text-xs text-muted">
          Finds and removes vote tallies for elections that no longer exist in the database.
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
          {loading ? "Healing…" : "Heal Now"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          <p className="font-medium">
            Found{" "}
            <span className={diagnostic.orphanTallies > 0 ? "text-error" : "text-success"}>
              {diagnostic.orphanTallies} orphan tally record(s)
            </span>
          </p>
          {diagnostic.examples.length > 0 && (
            <div>
              <p className="text-muted font-medium mb-1">Examples (by election ID):</p>
              {diagnostic.examples.map((e, i) => (
                <p key={i} className="text-muted">
                  {e.electionId} — {e.candidateCount} candidates
                </p>
              ))}
            </div>
          )}
          {diagnostic.orphanTallies === 0 && (
            <p className="text-success">No orphan vote tallies found.</p>
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
