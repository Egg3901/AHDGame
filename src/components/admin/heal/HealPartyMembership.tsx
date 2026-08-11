"use client";

import { useState } from "react";

interface MismatchedMember {
  _id: string;
  name: string;
  type: "character" | "npp";
  homeState: string;
  memberCountry: string;
  currentPartyId: string;
  currentPartyName: string | null;
  currentPartyCountry: string | null;
  suggestedPartyId: string | null;
  suggestedPartyName: string | null;
}

interface DiagnosticResult {
  status: string;
  issueCount: number;
  records: MismatchedMember[];
  message: string;
}

export function HealPartyMembership() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-membership");
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
        "This will reassign characters and NPPs to the correct party in their country based on party name.\n\nMembers with no matching party will be set to independent.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-membership", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Party Membership</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes characters and NPPs whose party assignment doesn&apos;t match their country. This
          can happen after party ID migrations when a US player ends up in a UK party (or vice
          versa). Members are reassigned to a party with the same name in their correct country.
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
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
        >
          {loading ? "Fixing..." : "Fix Party Assignments"}
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
                <div className="mt-2 max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-card-border">
                        <th className="pb-1">Name</th>
                        <th className="pb-1">Type</th>
                        <th className="pb-1">State</th>
                        <th className="pb-1">Current Party</th>
                        <th className="pb-1">Suggested Fix</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/50">
                      {diagnostic.records.map((r) => (
                        <tr key={r._id}>
                          <td className="py-1 font-medium">{r.name}</td>
                          <td className="py-1">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${r.type === "character" ? "bg-primary/20 text-primary" : "bg-muted/30 text-muted"}`}
                            >
                              {r.type === "character" ? "Player" : "NPP"}
                            </span>
                          </td>
                          <td className="py-1">{r.homeState}</td>
                          <td className="py-1">
                            <span className="text-error">
                              {r.currentPartyName ?? `ID: ${r.currentPartyId}`}
                              {r.currentPartyCountry && ` (${r.currentPartyCountry})`}
                            </span>
                          </td>
                          <td className="py-1">
                            {r.suggestedPartyName ? (
                              <span className="text-success">
                                {r.suggestedPartyName} ({r.memberCountry})
                              </span>
                            ) : (
                              <span className="text-muted italic">Independent</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {diagnostic.issueCount > 100 && (
                    <p className="mt-2 text-muted italic">
                      Showing first 100 of {diagnostic.issueCount} records
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
