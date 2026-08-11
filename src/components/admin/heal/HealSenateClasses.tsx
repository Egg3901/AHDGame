"use client";

import { useState } from "react";

interface DiagnosticResult {
  orphanOfficials: number;
  orphanElections: number;
  examples: {
    officials: { state: string; senateClass: number; characterId: string | null }[];
    elections: { state: string; senateClass: number; status: string }[];
  };
}

export function HealSenateClasses() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/officials/heal-senate");
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
        "This will permanently delete senate officials and elections whose class does not belong to their state.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/officials/heal-senate", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Senate Classes</h3>
        <p className="mt-1 text-xs text-muted">
          Removes ElectedOfficial and Election records whose senate class does not belong to their
          state. Fixes states incorrectly showing all 3 classes instead of their correct 2.
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
            <span className={diagnostic.orphanOfficials > 0 ? "text-error" : "text-success"}>
              {diagnostic.orphanOfficials} orphan official(s)
            </span>{" "}
            and{" "}
            <span className={diagnostic.orphanElections > 0 ? "text-error" : "text-success"}>
              {diagnostic.orphanElections} orphan election(s)
            </span>
          </p>
          {diagnostic.examples.officials.length > 0 && (
            <div>
              <p className="text-muted font-medium mb-1">Example orphan officials:</p>
              {diagnostic.examples.officials.map((o, i) => (
                <p key={i} className="text-muted">
                  {o.state} — Class {o.senateClass}
                  {o.characterId ? " (occupied)" : " (vacant)"}
                </p>
              ))}
            </div>
          )}
          {diagnostic.examples.elections.length > 0 && (
            <div>
              <p className="text-muted font-medium mb-1">Example orphan elections:</p>
              {diagnostic.examples.elections.map((e, i) => (
                <p key={i} className="text-muted">
                  {e.state} — Class {e.senateClass} ({e.status})
                </p>
              ))}
            </div>
          )}
          {diagnostic.orphanOfficials === 0 && diagnostic.orphanElections === 0 && (
            <p className="text-success">No orphan records found — senate classes look healthy.</p>
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
