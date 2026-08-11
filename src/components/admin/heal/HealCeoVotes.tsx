"use client";

import { useState } from "react";

interface CorpDiagnostic {
  id: string;
  sequentialId: number;
  name: string;
  voteCount: number;
  hasPendingCeo: boolean;
}

interface DiagnosticResult {
  totalVacantCorps: number;
  corpsWithIssues: number;
  diagnostics: CorpDiagnostic[];
}

export function HealCeoVotes() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/ceo-votes");
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
        "This will clear all CEO votes and pending CEO offers for corporations with vacant CEO positions.\n\nThis allows shareholders to start fresh CEO elections.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/ceo-votes", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Stale CEO Votes</h3>
        <p className="mt-1 text-xs text-muted">
          Clears CEO votes and pending CEO offers for corporations with vacant CEO positions. Use
          when a CEO cannot accept the position due to stale vote data blocking re-election.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing..." : "Heal All Vacant"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          <p>
            <span className="text-muted">Corporations with vacant CEO:</span>{" "}
            <span className="font-medium">{diagnostic.totalVacantCorps}</span>
          </p>
          <p>
            <span className="text-muted">With stale votes or pending CEO:</span>{" "}
            <span className="font-medium">{diagnostic.corpsWithIssues}</span>
          </p>
          {diagnostic.diagnostics.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {diagnostic.diagnostics.map((c) => (
                <p key={c.id} className="flex justify-between">
                  <span>
                    #{c.sequentialId} {c.name}
                  </span>
                  <span className="text-muted">
                    {c.voteCount} vote(s){c.hasPendingCeo ? ", pending CEO" : ""}
                  </span>
                </p>
              ))}
            </div>
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
