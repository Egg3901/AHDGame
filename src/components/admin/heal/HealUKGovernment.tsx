"use client";

import { useCallback, useState } from "react";

interface HealDiagnostic {
  government: {
    _id: string;
    status: string;
    formationType: string;
    governingPartyId: string;
    totalSeatsSupporting: number;
    cycle: number;
    pmName: string | null;
  } | null;
  activePmVote: {
    _id: string;
    voteType: string;
    threshold: number | null;
    votesFor: number;
    votesAgainst: number;
    status: string;
    openedAt: string;
  } | null;
  seatsByParty: Record<string, number>;
  totalSeats: number;
  currentPM: { name: string; party: string; type: string } | null;
  candidates: { id: string; name: string; party: string }[];
}

export function HealUKGovernment() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<HealDiagnostic | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/uk/government/heal");
      const data = await res.json();
      if (res.ok) {
        setDiagnostic(data as HealDiagnostic);
      } else {
        setMessage({ ok: false, text: data.error ?? "Failed to load UK government state" });
      }
    } catch {
      setMessage({ ok: false, text: "Network error" });
    } finally {
      setLoading(false);
    }
  }, []);

  const retriggerFormation = async () => {
    if (
      !confirm(
        "Re-run UK formation logic (checkAndInitiateUKFormation)?\n\n" +
          "Requires an existing parliamentaryGovernments document UK. " +
          "If the doc is missing, run a full turn or seed instead."
      )
    ) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/uk/government/heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retrigger_formation" }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ ok: true, text: "Formation logic completed. Refresh the diagnostic below." });
        await refresh();
      } else {
        setMessage({ ok: false, text: data.error ?? "Request failed" });
      }
    } catch {
      setMessage({ ok: false, text: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const appointPm = async () => {
    if (!selectedCandidateId) {
      setMessage({ ok: false, text: "Select a character to appoint as Prime Minister." });
      return;
    }
    if (
      !confirm(
        `Appoint this character as Prime Minister via the server appointUKPrimeMinister path?\n\nCharacter ID: ${selectedCandidateId}`
      )
    ) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/uk/government/heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "appoint_pm", characterId: selectedCandidateId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          ok: true,
          text: data.appointedName ? `Appointed: ${data.appointedName}` : "PM appointed.",
        });
        await refresh();
      } else {
        setMessage({ ok: false, text: data.error ?? "Request failed" });
      }
    } catch {
      setMessage({ ok: false, text: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold">UK government heal</h3>
        <p className="mt-1 text-xs text-muted">
          Inspect <code className="text-xs">UK</code>, active PM confidence votes, and Commons
          seats. Retrigger minority/majority formation bookkeeping or force-appoint a player MP as
          PM when the simulation is stuck.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Working…" : "Refresh diagnostic"}
        </button>
        <button
          type="button"
          onClick={retriggerFormation}
          disabled={loading}
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
        >
          Retrigger formation
        </button>
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? "text-success" : "text-error"}`} role="status">
          {message.text}
        </p>
      )}

      {diagnostic && (
        <div className="space-y-3 rounded-lg border border-card-border bg-card-elevated/50 p-3 text-xs">
          <div>
            <span className="font-medium text-foreground">parliamentaryGovernments (UK)</span>
            {diagnostic.government ? (
              <ul className="mt-1 list-inside list-disc text-muted">
                <li>status: {diagnostic.government.status}</li>
                <li>formation: {diagnostic.government.formationType}</li>
                <li>governing party id: {diagnostic.government.governingPartyId}</li>
                <li>seats (doc): {diagnostic.government.totalSeatsSupporting}</li>
                <li>cycle: {diagnostic.government.cycle}</li>
                <li>pmName (doc): {diagnostic.government.pmName ?? "—"}</li>
              </ul>
            ) : (
              <p className="mt-1 text-warning">
                No UK document — retrigger will no-op until one exists (e.g. after turn processing).
              </p>
            )}
          </div>

          <div>
            <span className="font-medium text-foreground">Active confidence vote</span>
            {diagnostic.activePmVote ? (
              <ul className="mt-1 list-inside list-disc text-muted">
                <li>id: {diagnostic.activePmVote._id}</li>
                <li>type: {diagnostic.activePmVote.voteType}</li>
                <li>
                  votes: {diagnostic.activePmVote.votesFor} yes /{" "}
                  {diagnostic.activePmVote.votesAgainst} no
                </li>
                <li>threshold: {diagnostic.activePmVote.threshold ?? "—"}</li>
              </ul>
            ) : (
              <p className="mt-1 text-muted">None</p>
            )}
          </div>

          <div>
            <span className="font-medium text-foreground">Commons seats by party (tally)</span>
            <p className="mt-1 text-muted">Total filled: {diagnostic.totalSeats} / 650</p>
            <ul className="mt-1 max-h-32 list-inside list-disc overflow-y-auto text-muted">
              {Object.entries(diagnostic.seatsByParty)
                .sort((a, b) => b[1] - a[1])
                .map(([party, seats]) => (
                  <li key={party}>
                    Party {party}: {seats}
                  </li>
                ))}
            </ul>
          </div>

          <div>
            <span className="font-medium text-foreground">
              Current PM (legacy / character lookup)
            </span>
            {diagnostic.currentPM ? (
              <p className="mt-1 text-muted">
                {diagnostic.currentPM.name} (party {diagnostic.currentPM.party})
              </p>
            ) : (
              <p className="mt-1 text-muted">None resolved</p>
            )}
          </div>

          <div className="border-t border-card-border pt-3">
            <span className="font-medium text-foreground">
              Force appoint PM (player Commons MP)
            </span>
            <p className="mt-1 text-muted">
              {diagnostic.candidates.length} eligible character(s) from heal diagnostic.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedCandidateId}
                onChange={(e) => setSelectedCandidateId(e.target.value)}
                className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="">Select character…</option>
                {diagnostic.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (party {c.party}, {c.id.slice(-6)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={appointPm}
                disabled={loading || !selectedCandidateId}
                className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                Appoint PM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
