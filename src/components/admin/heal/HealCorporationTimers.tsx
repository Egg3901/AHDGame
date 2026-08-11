"use client";

import { useState } from "react";

interface CorpTimerReport {
  id: string;
  name: string;
  typeSwitchTurn: number | null;
  typeSwitchCooldownUntilTurn: number;
  penaltyActive: boolean;
  cooldownActive: boolean;
  turnsRemainingOnCooldown: number;
  isExpired: boolean;
}

interface DiagnosticResult {
  currentTurn: number;
  corporations: CorpTimerReport[];
  total: number;
}

interface HealResult {
  message: string;
  cleared: Array<{ name: string; reason: string }>;
  skipped: Array<{ name: string; turnsRemaining: number }>;
  currentTurn: number;
}

export function HealCorporationTimers() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-timers");
      const data = await res.json();
      if (res.ok) {
        setDiagnostic(data as DiagnosticResult);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async (forceAll: boolean) => {
    const label = forceAll
      ? "force-clear ALL corporation type-switch timers (including active ones)"
      : "clear expired type-switch timers";
    if (!confirm(`This will ${label}.\n\nContinue?`)) return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceAll }),
      });
      const data: HealResult = await res.json();
      setResult({
        ok: res.ok,
        message: res.ok
          ? `${data.message}. Cleared: ${data.cleared.map((c) => c.name).join(", ") || "none"}${data.skipped.length > 0 ? `. Still active: ${data.skipped.map((c) => `${c.name} (${c.turnsRemaining}t)`).join(", ")}` : ""}`
          : ((data as unknown as { error?: string }).error ?? "Unknown error"),
      });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Corporation Timers</h3>
        <p className="mt-1 text-xs text-muted">
          Diagnoses and clears stale type-switch cooldown timers on corporations. Expired timers are
          safe to clear. Force-clear removes active cooldowns too (use only to fix corrupt state).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Diagnose"}
        </button>
        <button
          onClick={() => runHeal(false)}
          disabled={loading}
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
        >
          {loading ? "Clearing…" : "Clear Expired"}
        </button>
        <button
          onClick={() => runHeal(true)}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Clearing…" : "Force Clear All"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs max-h-56 overflow-y-auto">
          <p className="font-medium text-muted mb-1">
            {diagnostic.total} corporation(s) with timer fields — current turn:{" "}
            {diagnostic.currentTurn}
          </p>
          {diagnostic.corporations.map((c) => (
            <div key={c.id} className="flex justify-between gap-2">
              <span className="font-medium truncate">{c.name}</span>
              <span
                className={
                  c.isExpired ? "text-muted" : c.penaltyActive ? "text-error" : "text-warning"
                }
              >
                {c.isExpired
                  ? "expired"
                  : c.penaltyActive
                    ? `penalty active`
                    : `cooldown: ${c.turnsRemainingOnCooldown}t left`}
              </span>
            </div>
          ))}
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
