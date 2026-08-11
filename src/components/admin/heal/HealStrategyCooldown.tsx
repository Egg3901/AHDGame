"use client";

import { useState } from "react";

interface SectorCooldownReport {
  id: string;
  corporationName: string;
  stateId: string;
  sectorType: string;
  strategyId: string;
  transitionFromStrategyId: string | null;
  transitionStartTurn: number | null;
  transitionCooldownUntilTurn: number;
  isTransitioning: boolean;
  cooldownActive: boolean;
  turnsRemaining: number;
  isExpired: boolean;
}

interface DiagnosticResult {
  currentTurn: number;
  sectors: SectorCooldownReport[];
  total: number;
}

interface HealResult {
  message: string;
  cleared: Array<{ name: string; sector: string; reason: string }>;
  skipped: Array<{ name: string; sector: string; turnsRemaining: number }>;
  currentTurn: number;
}

export function HealStrategyCooldown() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/strategy-cooldown");
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
      ? "force-clear ALL strategy cooldowns (including active ones)"
      : "clear expired strategy cooldowns";
    if (!confirm(`This will ${label}.\n\nContinue?`)) return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/strategy-cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceAll }),
      });
      const data: HealResult = await res.json();
      setResult({
        ok: res.ok,
        message: res.ok
          ? `${data.message}. Cleared: ${data.cleared.map((c) => `${c.name} – ${c.sector}`).join(", ") || "none"}${data.skipped.length > 0 ? `. Still active: ${data.skipped.map((c) => `${c.name} – ${c.sector} (${c.turnsRemaining}t)`).join(", ")}` : ""}`
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
        <h3 className="font-semibold text-sm">Heal Strategy Cooldowns</h3>
        <p className="mt-1 text-xs text-muted">
          Diagnoses and clears operating strategy cooldown timers on corporate sectors. Expired
          cooldowns are safe to clear. Force-clear removes active cooldowns too (use only to fix
          corrupt state or unblock a stuck sector).
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
            {diagnostic.total} sector(s) with cooldown timers — current turn:{" "}
            {diagnostic.currentTurn}
          </p>
          {diagnostic.sectors.map((s) => (
            <div key={s.id} className="flex justify-between gap-2">
              <span className="font-medium truncate">
                {s.corporationName} – {s.stateId} ({s.sectorType})
              </span>
              <span
                className={
                  s.isExpired ? "text-muted" : s.isTransitioning ? "text-error" : "text-warning"
                }
              >
                {s.isExpired
                  ? "expired"
                  : s.isTransitioning
                    ? `transitioning from ${s.transitionFromStrategyId}`
                    : `cooldown: ${s.turnsRemaining}t left`}
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
