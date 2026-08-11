"use client";

import { useState } from "react";

interface DiagnosticResult {
  voteId: string;
  countryId: string;
  votesFor: number;
  votesAgainst: number;
  nppMPs: number;
  nppVoted: number;
  nppMissing: number;
  playerMPs: number;
  playerVoted: number;
}

export function HealConfidenceVotes() {
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDiagnose() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/heal/confidence-votes");
      const data = await res.json();
      setDiagnostic(data.activeVotes ?? []);
    } catch {
      setMessage("Failed to diagnose.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFix() {
    setFixing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/heal/confidence-votes", { method: "POST" });
      const data = await res.json();
      setMessage(data.message);
      await handleDiagnose();
    } catch {
      setMessage("Failed to fix.");
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <h3 className="text-sm font-semibold text-white">Heal Confidence Votes</h3>
      <p className="text-xs text-muted">
        Fix active confidence votes where NPP MPs failed to auto-vote YES. Diagnoses missing NPP
        votes and records them.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleDiagnose}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {loading ? "Checking…" : "Diagnose"}
        </button>
        <button
          onClick={handleFix}
          disabled={fixing}
          className="text-sm px-3 py-1.5 rounded border border-amber-500/50 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
        >
          {fixing ? "Fixing…" : "Fix Missing NPP Votes"}
        </button>
      </div>
      {diagnostic !== null && (
        <div className="text-xs space-y-2">
          {diagnostic.length === 0 ? (
            <p className="text-muted">No active confidence votes.</p>
          ) : (
            diagnostic.map((v) => (
              <div
                key={v.voteId}
                className="rounded border border-card-border/50 bg-card-elevated p-3 space-y-1"
              >
                <p className="font-medium text-foreground">
                  {v.countryId} — Vote {v.voteId.slice(-6)}
                </p>
                <p className="text-muted">
                  Votes: <span className="text-green-400">{v.votesFor} yes</span>{" "}
                  <span className="text-red-400">{v.votesAgainst} no</span>
                </p>
                <p className="text-muted">
                  NPPs: {v.nppVoted}/{v.nppMPs} voted
                  {v.nppMissing > 0 && (
                    <span className="text-amber-400 font-medium"> ({v.nppMissing} missing)</span>
                  )}
                </p>
                <p className="text-muted">
                  Players: {v.playerVoted}/{v.playerMPs} voted
                </p>
              </div>
            ))
          )}
        </div>
      )}
      {message && <p className="text-xs text-green-400">{message}</p>}
    </div>
  );
}
