"use client";

import { useState } from "react";

interface DiagnosticResult {
  actualExecutives: { officeType: string; characterName: string | null; characterId?: string }[];
  claimingExecutive: { name: string; officeType: string; isActual: boolean }[];
  staleCount: number;
  staleNames: string[];
  duplicateRecords: number;
}

export function HealExecutiveDuplicates() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/executive-duplicates");
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
        "This will clear stale executive office claims and remove duplicate records.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/executive-duplicates", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Executive Duplicates</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes duplicate President/VP records. Clears characters who claim executive office but
          aren&apos;t the actual holder, and removes duplicate electedOfficials records.
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
          <div>
            <span className="font-medium">Actual holders:</span>
            {diagnostic.actualExecutives.length === 0 ? (
              <span className="text-muted ml-1">None</span>
            ) : (
              <ul className="mt-1 ml-4 list-disc text-muted">
                {diagnostic.actualExecutives.map((e, i) => (
                  <li key={i}>
                    {e.officeType}: {e.characterName ?? "(vacant)"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {diagnostic.staleCount > 0 && (
            <div className="text-error">
              <span className="font-medium">Stale claims ({diagnostic.staleCount}):</span>
              <ul className="mt-1 ml-4 list-disc">
                {diagnostic.staleNames.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
          )}
          {diagnostic.duplicateRecords > 0 && (
            <p className="text-warning">
              {diagnostic.duplicateRecords} duplicate electedOfficials record(s) found
            </p>
          )}
          {diagnostic.staleCount === 0 && diagnostic.duplicateRecords === 0 && (
            <p className="text-success">No issues found</p>
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
