"use client";

import { useState } from "react";

interface StaleCampaign {
  campaignId: string;
  electionId: string;
  electionType: string;
  electionStatus: string;
  candidateId: string;
  candidateIsNPP: boolean;
  candidateName: string;
  characterCountryId: string | null;
  electionCountryId: string | null;
  reason: string;
}

interface DiagnosticResult {
  status: string;
  message: string;
  totalCampaigns: number;
  staleCount: number;
  breakdown: {
    completedElection: number;
    inactiveCandidate: number;
    crossCountry: number;
  };
  staleCampaigns: StaleCampaign[];
}

export function HealStaleCampaigns() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/stale-campaigns");
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
        "This will delete all stale Campaign documents — for completed elections, inactive candidates, and cross-country mismatches.\n\nAffected players will no longer see the campaign tab. Continue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/stale-campaigns", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Stale Campaign Documents</h3>
        <p className="mt-1 text-xs text-muted">
          Removes Campaign documents that should have been deleted but weren&apos;t. Covers three
          cases: campaigns tied to completed/resolved elections, campaigns where the candidate is no
          longer active in the race, and cross-country mismatches. Fixes players who still see the
          campaign tab after leaving a race or switching countries.
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
          <div className="flex gap-4 flex-wrap">
            <span>
              <span className="font-medium">Total campaigns:</span> {diagnostic.totalCampaigns}
            </span>
            <span>
              <span className="font-medium">Stale:</span> {diagnostic.staleCount}
            </span>
            <span>
              <span className="font-medium">Completed election:</span>{" "}
              {diagnostic.breakdown.completedElection}
            </span>
            <span>
              <span className="font-medium">Inactive candidate:</span>{" "}
              {diagnostic.breakdown.inactiveCandidate}
            </span>
            <span>
              <span className="font-medium">Cross-country:</span>{" "}
              {diagnostic.breakdown.crossCountry}
            </span>
          </div>

          {diagnostic.staleCampaigns.length > 0 ? (
            <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
              {diagnostic.staleCampaigns.slice(0, 25).map((c) => (
                <div key={c.campaignId} className="border-t border-card-border pt-1">
                  <span className="text-error font-medium">{c.candidateName}</span>
                  {c.candidateIsNPP && <span className="text-muted ml-1">[NPP]</span>}
                  <span className="text-muted ml-2">
                    {c.electionType} ({c.electionStatus})
                  </span>
                  <span className="text-muted/70 ml-2">— {c.reason}</span>
                </div>
              ))}
              {diagnostic.staleCampaigns.length > 25 && (
                <p className="text-muted">...and {diagnostic.staleCampaigns.length - 25} more</p>
              )}
            </div>
          ) : (
            <p className="text-success">No stale campaign documents found</p>
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
