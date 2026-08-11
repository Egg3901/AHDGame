"use client";

import { useState } from "react";

interface MismatchedRecord {
  _id: string;
  stateId: string;
  partyId: string;
  partyCountry: string;
  stateCountry: string;
  organization: number;
}

interface DiagnosticResult {
  status: string;
  issueCount: number;
  records: MismatchedRecord[];
  message: string;
}

export function HealCrossCountryPartyOrg() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/cross-country-party-org");
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
        "This will DELETE all statePartyOrg records where the party's country doesn't match the state's country.\n\nThis is irreversible. Continue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/cross-country-party-org", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Cross-Country Party Organization</h3>
        <p className="mt-1 text-xs text-muted">
          Removes statePartyOrg records where a party appears in states belonging to a different
          country (e.g., US parties in UK regions). This can happen if parties were created before
          country filtering was added.
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
          {loading ? "Deleting..." : "Delete Invalid Records"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          {diagnostic.status === "ok" ? (
            <p className="text-success">{diagnostic.message}</p>
          ) : (
            <>
              <p className="font-medium text-warning">{diagnostic.message}</p>
              {diagnostic.records.length > 0 && (
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-card-border">
                        <th className="pb-1">State</th>
                        <th className="pb-1">Party</th>
                        <th className="pb-1">Party Country</th>
                        <th className="pb-1">State Country</th>
                        <th className="pb-1 text-right">Org</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/50">
                      {diagnostic.records.map((r) => (
                        <tr key={r._id}>
                          <td className="py-1">{r.stateId}</td>
                          <td className="py-1">{r.partyId}</td>
                          <td className="py-1 text-error">{r.partyCountry}</td>
                          <td className="py-1">{r.stateCountry}</td>
                          <td className="py-1 text-right tabular-nums">{r.organization}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {diagnostic.issueCount > 50 && (
                    <p className="mt-2 text-muted italic">
                      Showing first 50 of {diagnostic.issueCount} records
                    </p>
                  )}
                </div>
              )}
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
