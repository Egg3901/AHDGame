"use client";

import { useState } from "react";

interface RegionIssue {
  region: string;
  status: "missing" | "mismatch";
  expectedSeats: number;
  actualSeats: number;
}

interface DiagnosticResult {
  status: string;
  message: string;
  totalRegions: number;
  issuesFound: number;
  regions: RegionIssue[];
}

export function HealUKCommonsSeats() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/uk-commons-seats");
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
        "This will delete all UK Commons electedOfficials and recreate them from the most recent resolved elections.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/uk-commons-seats", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal UK Commons Seats</h3>
        <p className="mt-1 text-xs text-muted">
          Recreates UK Commons electedOfficials from the most recent resolved election results.
          Fixes missing seats after elections that failed to populate officials.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running..." : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing..." : "Heal All"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 text-xs space-y-2">
          <p className={diagnostic.status === "ok" ? "text-success" : "text-error"}>
            {diagnostic.message}
          </p>
          {diagnostic.regions.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="font-medium">Regions with issues:</p>
              <ul className="list-disc list-inside text-muted">
                {diagnostic.regions.map((r) => (
                  <li key={r.region}>
                    {r.region}:{" "}
                    {r.status === "missing"
                      ? "missing"
                      : `${r.actualSeats}/${r.expectedSeats} seats`}
                  </li>
                ))}
              </ul>
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
