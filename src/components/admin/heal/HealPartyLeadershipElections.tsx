"use client";

import { useState } from "react";

interface OrphanedCandidate {
  candidateId: string;
  characterId: string;
  characterName: string;
  electionType: "state" | "national" | "committee";
  countryId: string;
  partyId: string;
  partyName: string;
  position?: string;
  characterParty: string;
  characterPartyName: string;
}

interface DiagnosticResult {
  status: string;
  issueCount: number;
  candidates: OrphanedCandidate[];
  message: string;
}

export function HealPartyLeadershipElections() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-leadership-elections");
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
        "This will withdraw all candidates from party leadership elections who are no longer members of that party.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-leadership-elections", { method: "POST" });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const getElectionTypeLabel = (type: "state" | "national" | "committee") => {
    switch (type) {
      case "state":
        return "State Party";
      case "national":
        return "National Party";
      case "committee":
        return "National Committee";
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Party Leadership Elections Member Left</h3>
        <p className="mt-1 text-xs text-muted">
          Finds and withdraws candidates from party leadership elections (Chair, Vice Chair,
          Treasurer, National Committee) who are no longer members of that party. This can happen if
          a player leaves a party while registered for an election.
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
          {loading ? "Fixing..." : "Withdraw Invalid Candidates"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          {diagnostic.status === "ok" ? (
            <p className="text-success">{diagnostic.message}</p>
          ) : (
            <>
              <p className="font-medium text-warning">{diagnostic.message}</p>
              {diagnostic.candidates.length > 0 && (
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-card-border">
                        <th className="pb-1">Name</th>
                        <th className="pb-1">Country</th>
                        <th className="pb-1">Election Type</th>
                        <th className="pb-1">Election Party</th>
                        <th className="pb-1">Current Party</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/50">
                      {diagnostic.candidates.map((c) => (
                        <tr key={c.candidateId}>
                          <td className="py-1">{c.characterName}</td>
                          <td className="py-1">{c.countryId}</td>
                          <td className="py-1">
                            {getElectionTypeLabel(c.electionType)}
                            {c.position && ` (${c.position})`}
                          </td>
                          <td className="py-1">{c.partyName}</td>
                          <td className="py-1 text-warning">{c.characterPartyName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {diagnostic.issueCount > 50 && (
                    <p className="mt-2 text-muted italic">
                      Showing first 50 of {diagnostic.issueCount} candidates
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
