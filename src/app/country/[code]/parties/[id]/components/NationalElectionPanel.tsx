"use client";

import { useState } from "react";
import Link from "next/link";
import { getMessageStyle } from "@/lib/utils/formatters";
import { partyApiUrl } from "@/lib/urls";
import type { NationalElectionEntry, NationalPosition } from "./types";
import { getPositionLabels, POSITION_DESC } from "./helpers";

// Renders "Available in 5h 23m" / "Available in 47m" from a positive
// remaining-ms value. Used in the Run button's disabled state when the
// viewer is inside the new-character cooldown.
function formatCooldownLabel(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `Available in ${minutes}m`;
  return `Available in ${hours}h ${minutes}m`;
}

export function NationalElectionPanel({
  election,
  position,
  partyColor,
  partyId,
  country,
  canVote,
  canRun,
  runCooldownUntil,
  userVote,
  isCandidate: isCandidateHere,
  isCandidateElsewhere,
  currentTurn,
  electionMethod,
  onRefresh,
}: {
  election: NationalElectionEntry | null;
  position: NationalPosition;
  partyColor: string;
  partyId: string;
  country: string;
  canVote: boolean;
  canRun: boolean;
  runCooldownUntil: string | null;
  userVote: { candidateId: string; candidateName: string } | null;
  isCandidate: boolean;
  isCandidateElsewhere: boolean;
  currentTurn: number;
  /** How national leadership elections are tallied; absent/undefined means "party" (one-person one-vote). */
  electionMethod?: "party" | "committee" | "influence";
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const act = async (endpoint: string, body: object) => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/election/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const label = getPositionLabels(country)[position];

  const useInfluence = electionMethod === "influence";

  if (!election)
    return (
      <div className="rounded-xl border border-card-border bg-card p-5">
        <p className="text-sm font-semibold mb-1">{label}</p>
        <p className="text-xs text-muted">No election data yet.</p>
      </div>
    );

  const isVoting = election.status === "voting";
  const remaining = Math.max(0, election.endTurn - currentTurn);
  const cooldownMs = runCooldownUntil ? new Date(runCooldownUntil).getTime() - Date.now() : 0;
  const cooldownActive = cooldownMs > 0;
  const cooldownLabel = cooldownActive ? formatCooldownLabel(cooldownMs) : "";

  return (
    <div className="group rounded-xl border border-card-border bg-card overflow-hidden shadow-sm transition-all hover:shadow-md hover:border-card-border/80">
      <div className="relative border-b border-card-border/50 bg-card-muted/30 px-5 py-4">
        {/* Color accent strip */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: partyColor }}
        />

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-base text-foreground">{label} Election</h3>
              {isVoting && (
                <span
                  className="animate-pulse h-2 w-2 rounded-full bg-red-500"
                  title="Voting in progress"
                />
              )}
            </div>
            <p className="text-xs text-muted max-w-[85%] leading-relaxed">
              {POSITION_DESC[position]}
            </p>
          </div>

          <div className="shrink-0 text-right">
            {isVoting ? (
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted/70">
                  Time Remaining
                </span>
                <span
                  className={`font-mono text-lg font-bold tabular-nums leading-none mt-1 ${
                    remaining <= 12
                      ? "text-red-400"
                      : remaining <= 24
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
        {election.status === "completed" && (
          <div
            className={`rounded-lg border p-3 flex items-center gap-3 ${election.winnerName ? "bg-green-500/5 border-green-500/20" : "bg-muted/5 border-muted/20"}`}
          >
            {election.winnerName ? (
              <>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <span className="text-green-500">{election.winnerName}</span> elected
                  </p>
                  <p className="text-xs text-muted">New {label} confirmed</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted italic pl-1">No candidates — position unchanged.</p>
            )}
          </div>
        )}

        {msg && (
          <div className={`rounded-lg p-3 text-sm font-medium ${getMessageStyle(msg)}`}>{msg}</div>
        )}

        {isVoting && canRun && (
          <div className="flex gap-2">
            {!isCandidateHere && (
              <button
                onClick={() => act("enter", { position })}
                disabled={loading || isCandidateElsewhere || cooldownActive}
                title={
                  cooldownActive
                    ? cooldownLabel
                    : isCandidateElsewhere
                      ? "Withdraw from your other candidacy first"
                      : undefined
                }
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90 hover:shadow disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                style={{ backgroundColor: partyColor }}
              >
                {loading ? "Processing..." : cooldownActive ? cooldownLabel : `Run for ${label}`}
              </button>
            )}
            {isCandidateHere && (
              <button
                onClick={() => {
                  if (confirm("Withdraw from this race?"))
                    act("enter", { position, withdraw: true });
                }}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {loading ? "Processing..." : "Withdraw Campaign"}
              </button>
            )}
          </div>
        )}

        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-2">
            Candidates
            <span className="rounded-full bg-card-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {election.candidates.length}
            </span>
            {useInfluence && (
              <span
                className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400"
                title="Influence Weighted Voting"
              >
                Influence committed
              </span>
            )}
          </h4>

          {election.candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-card-border p-6 text-center">
              <p className="text-sm text-muted">No candidates have entered this race yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {election.candidates.map((c) => {
                const isMyVote = userVote?.candidateId === c.characterId;
                const displayVoteCount = useInfluence
                  ? Number(c.voteCount.toFixed(2))
                  : c.voteCount;
                const pct =
                  election.totalVotes > 0
                    ? useInfluence
                      ? Number(((c.voteCount / election.totalVotes) * 100).toFixed(2))
                      : Math.round((c.voteCount / election.totalVotes) * 100)
                    : 0;

                return (
                  <div
                    key={c.id}
                    className={`relative overflow-hidden rounded-xl border bg-card-elevated/30 p-3 transition-all ${
                      isMyVote
                        ? "border-2 shadow-sm"
                        : "border-card-border hover:border-card-border/80"
                    }`}
                    style={isMyVote ? { borderColor: partyColor } : {}}
                  >
                    {/* Progress bar background */}
                    <div
                      className="absolute bottom-0 left-0 top-0 bg-primary/5 transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isMyVote ? `${partyColor}10` : undefined,
                      }}
                    />

                    <div className="relative flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/character/${c.sequentialId ?? c.characterId}`}
                            className="font-bold text-foreground hover:text-primary hover:underline truncate"
                          >
                            {c.characterName}
                          </Link>
                          {c.isCurrentHolder && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm"
                              style={{ backgroundColor: `${partyColor}20`, color: partyColor }}
                            >
                              Incumbent
                            </span>
                          )}
                        </div>

                        {isMyVote && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-green-400">
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            Your Vote
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-lg font-bold tabular-nums leading-none">
                            {displayVoteCount}
                          </div>
                          <div className="text-[10px] font-medium text-muted mt-0.5">
                            {election.totalVotes > 0 ? `${pct}%` : "—"}
                          </div>
                        </div>

                        {isVoting && canVote && !isMyVote && (
                          <button
                            onClick={() => act("vote", { position, candidateId: c.characterId })}
                            disabled={loading}
                            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm transition-all hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            Vote
                          </button>
                        )}
                        {isVoting && canVote && isMyVote && (
                          <button
                            disabled
                            className="cursor-default rounded-lg border border-transparent bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-500 opacity-50"
                          >
                            Voted
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
