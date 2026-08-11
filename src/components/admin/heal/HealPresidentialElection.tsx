"use client";

import { useState } from "react";

interface DiagnosticResult {
  status: string;
  message?: string;
  election?: {
    id: string;
    cycle: number;
    status: string;
    durationHours: number;
    primaryDurationHours: number;
    startTime: string;
    primaryEndTime: string;
    endTime: string;
  };
  correctValues?: {
    durationHours: number;
    primaryDurationHours: number;
  };
  gameState?: {
    currentTurn: number;
    currentYear: number;
  };
}

export function HealPresidentialElection() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/presidential-election");
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
        "This will reset the presidential election timers and withdraw all candidates so they can re-enter.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/presidential-election", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Presidential Election</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes presidential elections with wrong durations. Resets timers to 24h primary + 24h
          general and withdraws candidates so they can re-enter the fresh primary.
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
          {diagnostic.status === "no_live_election" ? (
            <p className="text-muted">{diagnostic.message}</p>
          ) : diagnostic.status === "ok" ? (
            <p className="text-success">
              Presidential election looks healthy — {diagnostic.election?.durationHours}h total (
              {diagnostic.election?.primaryDurationHours}h primary).
            </p>
          ) : (
            <>
              <p className="font-medium text-error">Presidential election needs fix:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-muted">
                <span>Current duration:</span>
                <span className="text-error font-medium">
                  {diagnostic.election?.durationHours}h ({diagnostic.election?.primaryDurationHours}
                  h primary)
                </span>
                <span>Correct duration:</span>
                <span className="text-success font-medium">
                  {diagnostic.correctValues?.durationHours}h (
                  {diagnostic.correctValues?.primaryDurationHours}h primary)
                </span>
                <span>Cycle:</span>
                <span>{diagnostic.election?.cycle}</span>
                <span>Status:</span>
                <span>{diagnostic.election?.status}</span>
                <span>Game year:</span>
                <span>{diagnostic.gameState?.currentYear}</span>
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
