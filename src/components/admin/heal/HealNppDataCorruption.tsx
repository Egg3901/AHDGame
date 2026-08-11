"use client";

import { useState } from "react";

interface DiagnosticResult {
  status: string;
  totalIssues: number;
  ukSpoWithHouseKey: number;
  ukSpoWithNaNOrg: number;
  ukSpoWithNaNCapCurrent: number;
  nppsWithNaNFunds: number;
  nppsWithNaNActionPoints: number;
  nppsWithNaNPoliticalInfluence: number;
  nppsWithNaNFavorability: number;
  nppsWithNaNDonorBaseLevel: number;
}

export function HealNppDataCorruption() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/npp-data-corruption");
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
        "This will fix corrupted UK StatePartyOrg cap contributions (house→commons migration) and reset any NaN NPP stats to 0.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/npp-data-corruption", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal NPP Data Corruption</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes UK StatePartyOrg cap contribution key mismatch (house→commons) and resets any NaN
          values in NPP stats (funds, actionPoints, politicalInfluence, favorability,
          donorBaseLevel) to 0.
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
          {loading ? "Healing..." : "Heal"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          <p>
            <span className="text-muted">Status:</span>{" "}
            <span
              className={`font-medium ${diagnostic.status === "ok" ? "text-success" : "text-warning"}`}
            >
              {diagnostic.status === "ok"
                ? "No issues"
                : `${diagnostic.totalIssues} issue(s) found`}
            </span>
          </p>
          {diagnostic.totalIssues > 0 && (
            <div className="mt-2 space-y-1">
              <p className="font-medium text-muted">UK StatePartyOrg:</p>
              {diagnostic.ukSpoWithHouseKey > 0 && (
                <p className="ml-2">
                  Stale house key:{" "}
                  <span className="font-medium">{diagnostic.ukSpoWithHouseKey}</span>
                </p>
              )}
              {diagnostic.ukSpoWithNaNOrg > 0 && (
                <p className="ml-2">
                  NaN organization:{" "}
                  <span className="font-medium">{diagnostic.ukSpoWithNaNOrg}</span>
                </p>
              )}
              {diagnostic.ukSpoWithNaNCapCurrent > 0 && (
                <p className="ml-2">
                  NaN cap current:{" "}
                  <span className="font-medium">{diagnostic.ukSpoWithNaNCapCurrent}</span>
                </p>
              )}
              <p className="font-medium text-muted mt-2">NPPs:</p>
              {diagnostic.nppsWithNaNFunds > 0 && (
                <p className="ml-2">
                  NaN funds: <span className="font-medium">{diagnostic.nppsWithNaNFunds}</span>
                </p>
              )}
              {diagnostic.nppsWithNaNActionPoints > 0 && (
                <p className="ml-2">
                  NaN actionPoints:{" "}
                  <span className="font-medium">{diagnostic.nppsWithNaNActionPoints}</span>
                </p>
              )}
              {diagnostic.nppsWithNaNPoliticalInfluence > 0 && (
                <p className="ml-2">
                  NaN politicalInfluence:{" "}
                  <span className="font-medium">{diagnostic.nppsWithNaNPoliticalInfluence}</span>
                </p>
              )}
              {diagnostic.nppsWithNaNFavorability > 0 && (
                <p className="ml-2">
                  NaN favorability:{" "}
                  <span className="font-medium">{diagnostic.nppsWithNaNFavorability}</span>
                </p>
              )}
              {diagnostic.nppsWithNaNDonorBaseLevel > 0 && (
                <p className="ml-2">
                  NaN donorBaseLevel:{" "}
                  <span className="font-medium">{diagnostic.nppsWithNaNDonorBaseLevel}</span>
                </p>
              )}
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
