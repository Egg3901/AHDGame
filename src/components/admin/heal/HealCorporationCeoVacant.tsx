"use client";

import { useState } from "react";

interface CorpDiagnostic {
  id: string;
  sequentialId: number;
  name: string;
  ceoId: string | null;
}

interface DiagnosticResult {
  totalAffected: number;
  missingCeoVacant: number;
  nullCeoVacant: number;
  corporations: CorpDiagnostic[];
}

export function HealCorporationCeoVacant() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-ceo-vacant");
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
        "This will set ceoVacant: false on all corporations with an active CEO that are missing the field, and create CEO self-votes.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-ceo-vacant", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Missing CEO Vacant Field</h3>
        <p className="mt-1 text-xs text-muted">
          Finds corporations with an active CEO but missing the ceoVacant field. Sets ceoVacant:
          false and creates a CEO self-vote so the field is properly initialized.
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
          {loading ? "Healing..." : "Heal All"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          <p>
            <span className="text-muted">Corps missing ceoVacant field:</span>{" "}
            <span className="font-medium">{diagnostic.totalAffected}</span>
          </p>
          {diagnostic.corporations.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {diagnostic.corporations.map((c) => (
                <p key={c.id} className="flex justify-between">
                  <span>
                    #{c.sequentialId} {c.name}
                  </span>
                  <span className="text-muted">CEO: {c.ceoId ? "present" : "none"}</span>
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
