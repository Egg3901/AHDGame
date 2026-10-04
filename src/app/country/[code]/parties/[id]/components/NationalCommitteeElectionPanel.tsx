"use client";

import { useState, useEffect } from "react";

import { getMessageStyle } from "@/lib/utils/formatters";
import { partyApiUrl } from "@/lib/urls";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import type { CommitteeElection } from "./types";

// Renders "Available in 5h 23m" / "Available in 47m" from a positive
// remaining-ms value. Mirrors the helper in NationalElectionPanel.tsx.
function formatCooldownLabel(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `Available in ${minutes}m`;
  return `Available in ${hours}h ${minutes}m`;
}

export function NationalCommitteeElectionPanel({
  election,
  partyId,
  country,
  canVote,
  canRun,
  runCooldownUntil,
  userVotes,
  isCandidate,
  currentTurn,
  onRefresh,
}: {
  election: CommitteeElection | null;
  /** No longer drawn: party color appears only as a swatch beside the name. */
  partyColor?: string;
  partyId: string;
  country: string;
  canVote: boolean;
  canRun: boolean;
  runCooldownUntil: string | null;
  userVotes: string[];
  isCandidate: boolean;
  currentTurn: number;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedVotes, setSelectedVotes] = useState<Set<string>>(new Set(userVotes));
  const committeeLabel = getPartyRoleLabel(country, "committee");

  // Sync selectedVotes when userVotes changes
  useEffect(() => {
    setSelectedVotes(new Set(userVotes));
  }, [userVotes]);

  const handleEnter = async (withdraw = false) => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/committee/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdraw }),
      });
      const data = await res.json();
      setMsg(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) onRefresh();
    } catch {
      setMsg("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/committee/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: Array.from(selectedVotes) }),
      });
      const data = await res.json();
      setMsg(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) onRefresh();
    } catch {
      setMsg("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const toggleVote = (characterId: string) => {
    setSelectedVotes((prev) => {
      const next = new Set(prev);
      if (next.has(characterId)) {
        next.delete(characterId);
      } else if (next.size < 6) {
        next.add(characterId);
      }
      return next;
    });
  };

  if (!election) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="text-sm text-muted">No committee election data available.</p>
      </div>
    );
  }

  const isVoting = election.status === "voting";
  const remaining = Math.max(0, election.endTurn - currentTurn);
  const cooldownMs = runCooldownUntil ? new Date(runCooldownUntil).getTime() - Date.now() : 0;
  const cooldownActive = cooldownMs > 0;
  const cooldownLabel = cooldownActive ? formatCooldownLabel(cooldownMs) : "";
  const votesChanged =
    JSON.stringify([...selectedVotes].sort()) !== JSON.stringify([...userVotes].sort());

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card-muted/50 p-4 flex items-start gap-3">
        <svg
          className="h-5 w-5 text-muted shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm text-muted leading-relaxed">
          {committeeLabel} elections run for{" "}
          <span className="font-medium text-foreground">168 turns</span> (1 week). Members may vote
          for up to <span className="font-medium text-foreground">6 candidates</span>. The top 6
          vote-getters win seats on the {committeeLabel}.
        </p>
      </div>

      <div className="group rounded-xl border border-card-border bg-card overflow-hidden shadow-sm transition-all hover:shadow-md hover:border-card-border/80">
        <div className="relative border-b border-card-border/50 bg-card-muted/30 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-base text-foreground">{committeeLabel} election</h3>
                {isVoting && (
                  <span className="h-2 w-2 rounded-full bg-red-500" title="Voting in progress" />
                )}
              </div>
              <p className="text-xs text-muted">{`Elect 6 members to the ${committeeLabel}`}</p>
            </div>

            <div className="shrink-0 text-right">
              {isVoting ? (
                <div className="flex flex-col items-end">
                  <span className="text-body-sm font-medium text-muted">Time remaining</span>
                  <span
                    className={`text-lg font-bold tabular-nums leading-none mt-1 ${
                      remaining <= 24
                        ? "text-red-400"
                        : remaining <= 48
                          ? "text-yellow-400"
                          : "text-foreground"
                    }`}
                  >
                    {remaining}t
                  </span>
                </div>
              ) : (
                <span
                  className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border ${
                    election.status === "completed"
                      ? "bg-green-500/10 text-green-500 border-green-500/20"
                      : "bg-muted/10 text-muted border-muted/20"
                  }`}
                >
                  {election.status === "completed" ? "Completed" : election.status}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {msg && (
            <div className={`rounded-lg p-3 text-sm font-medium ${getMessageStyle(msg)}`}>
              {msg}
            </div>
          )}

          {isVoting && canRun && (
            <div className="flex gap-2">
              {!isCandidate ? (
                <button
                  onClick={() => handleEnter(false)}
                  disabled={loading || cooldownActive}
                  title={cooldownActive ? cooldownLabel : undefined}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading
                    ? "Processing..."
                    : cooldownActive
                      ? cooldownLabel
                      : `Run for ${committeeLabel}`}
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (confirm("Withdraw from this race?")) handleEnter(true);
                  }}
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                >
                  {loading ? "Processing..." : "Withdraw campaign"}
                </button>
              )}
            </div>
          )}

          {election.candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-card-border p-8 text-center">
              <p className="text-sm text-muted">No candidates have entered this race yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-semibold text-muted flex items-center gap-2">
                  Candidates
                  <span className="rounded-full bg-card-elevated px-1.5 py-0.5 text-body-sm text-muted-foreground">
                    {election.candidates.length}
                  </span>
                </h4>
                {isVoting && canVote && (
                  <span
                    className={`text-xs font-medium ${selectedVotes.size === 6 ? "text-warning" : "text-muted"}`}
                  >
                    Selected:{" "}
                    <span className="tabular-nums font-bold text-foreground">
                      {selectedVotes.size}
                    </span>
                    /6
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {election.candidates.map((c) => {
                  const isSelected = selectedVotes.has(c.characterId);
                  const isTop6 = election.candidates.indexOf(c) < 6;

                  return (
                    <div
                      key={c.id}
                      onClick={isVoting && canVote ? () => toggleVote(c.characterId) : undefined}
                      className={`relative overflow-hidden rounded-xl border p-3 transition-all ${
                        isVoting && canVote
                          ? "cursor-pointer hover:border-primary/50 hover:bg-card-elevated/50"
                          : ""
                      } ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                          : "border-card-border bg-card-elevated/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm text-foreground truncate">
                              {c.characterName}
                            </span>
                            {c.isCurrentCommittee && (
                              <span className="inline-flex shrink-0 items-center text-body-sm text-muted">
                                Current
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {isTop6 && election.status === "voting" && (
                              <span className="inline-flex items-center text-body-sm text-muted">
                                Top 6
                              </span>
                            )}
                            {isSelected && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-body-sm font-medium text-primary">
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                                Selected
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="text-right">
                            <div className="text-lg font-bold tabular-nums leading-none">
                              {c.voteCount}
                            </div>
                            <div className="text-body-sm text-muted text-right mt-0.5">votes</div>
                          </div>

                          {isVoting && canVote && (
                            <div
                              className={`h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? "bg-primary border-primary text-white"
                                  : "border-card-border bg-card text-transparent"
                              }`}
                            >
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isVoting && canVote && votesChanged && (
            <div className="pt-2">
              <button
                onClick={handleVote}
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                {loading ? "Submitting votes..." : `Submit votes (${selectedVotes.size} selected)`}
              </button>
              <p className="text-center text-xs text-muted mt-2">
                You can update your votes at any time before the election ends.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-body-sm font-medium text-muted pt-4 border-t border-card-border">
            <span>
              Total voters: <span className="text-foreground">{election.totalVoters}</span>
            </span>
            {isVoting && (
              <span>
                Turn {election.startTurn} → {election.endTurn}
              </span>
            )}
          </div>

          {!canVote && isVoting && (
            <div className="rounded-lg bg-card-muted p-3 text-center">
              <p className="text-xs text-muted">
                {`Only members may vote or run for the ${committeeLabel}.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
