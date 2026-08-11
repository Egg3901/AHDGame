"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getMessageStyle } from "@/lib/utils/formatters";
import { regionApiSubUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";

// ─── Types ────────────────────────────────────────────────────────────────────

type Position = "chair" | "viceChair" | "treasurer";

interface Candidate {
  id: string;
  characterId: string;
  characterName: string;
  voteCount: number;
  isCurrentHolder: boolean;
  sequentialId?: number;
}

interface ElectionData {
  id: string;
  position: Position;
  positionLabel: string;
  status: "voting" | "completed" | "cancelled";
  startTime: string;
  endTime: string;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  candidates: Candidate[];
  totalVotes: number;
  winnerId: string | null;
  winnerName: string | null;
}

interface ElectionsResponse {
  elections: Record<Position, ElectionData | null>;
  currentHolders: Record<Position, string | null>;
  canVote: boolean;
  cooldownBlockedUntil: string | null;
  userVotes: Record<Position, { candidateId: string; candidateName: string } | null>;
  isCandidate: Record<Position, boolean>;
  canVoteReason: "membership" | "cooldown" | "tenure" | null;
  tenureTurnsRemaining: number | null;
  /** Turns until this viewer clears every participation gate. */
  turnsUntilEligible: number | null;
}

/**
 * Why this viewer cannot take part, said in turns.
 *
 * A turn is one real hour, and every other clock on this panel counts turns, so
 * the eligibility gates are expressed the same way. The old copy quoted a flat
 * "24 hours" from the wall-clock gate alone, which both ignored the (often
 * longer) party-tenure gate and forced the player to compare hours against an
 * election closing in turns.
 */
function ineligibilityNote({
  canVoteReason,
  turnsUntilEligible,
  tenureTurnsRemaining,
  turnsLeftInElection,
}: {
  canVoteReason: "membership" | "cooldown" | "tenure" | null;
  turnsUntilEligible: number | null;
  tenureTurnsRemaining: number | null;
  turnsLeftInElection: number | null;
}): string {
  if (canVoteReason === "membership") {
    return "Only members of this state party may vote or run for leadership.";
  }
  const wait = turnsUntilEligible ?? tenureTurnsRemaining;
  if (wait == null || wait <= 0) {
    return "You are not eligible to participate in this leadership election.";
  }
  const turns = `${wait} turn${wait === 1 ? "" : "s"}`;
  const why =
    canVoteReason === "cooldown"
      ? `New accounts wait ${turns} before taking part in leadership elections.`
      : `You need ${turns} more as a member of this party before taking part in its leadership elections.`;
  // Say plainly when the wait outlasts the race, rather than letting a player
  // watch a countdown they can never reach the end of.
  if (turnsLeftInElection != null && turnsLeftInElection < wait) {
    return `${why} This race closes first, so the next cycle is the one you can contest.`;
  }
  return why;
}

interface Props {
  stateId: string;
  countryId: string;
  partyId: string;
  partyColor: string;
  partyName: string;
  currentTurn: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POSITION_ORDER: Position[] = ["chair", "viceChair", "treasurer"];

const POSITION_ICON: Record<Position, string> = {
  chair: "⭐",
  viceChair: "🏛️",
  treasurer: "💰",
};

/** Get position labels appropriate for the region type (parliamentary systems use "Regional") */
function getPositionLabels(countryId: string): Record<Position, string> {
  const isParliamentary = isParliamentarySystem(COUNTRY_CONFIGS[countryId as CountryId]);
  return {
    chair: isParliamentary ? "Regional Chair" : "State Chair",
    viceChair: "Vice Chair",
    treasurer: "Treasurer",
  };
}

/** Get position descriptions appropriate for the region type */
function getPositionDescriptions(countryId: string): Record<Position, string> {
  const isParliamentary = isParliamentarySystem(COUNTRY_CONFIGS[countryId as CountryId]);
  const orgType = isParliamentary ? "regional" : "state";
  return {
    chair: `Leads the ${orgType} party. Can manage all leadership, set tax rates, and use party influence.`,
    viceChair: "Assists the chair. Can use party NPP influence alongside the chair.",
    treasurer: `Manages the ${orgType} party treasury. Can transfer and distribute funds.`,
  };
}

function TurnsRemaining({
  endTurn,
  currentTurn,
  color,
}: {
  endTurn: number;
  currentTurn: number;
  color: string;
}) {
  // Handle missing or invalid endTurn/currentTurn values
  if (!endTurn || !currentTurn || isNaN(endTurn) || isNaN(currentTurn)) {
    return <span className={`font-bold tabular-nums ${color}`}>— turns remaining</span>;
  }
  const remaining = Math.max(0, endTurn - currentTurn);
  const urgency = remaining <= 12 ? "text-error" : remaining <= 24 ? "text-warning" : "";
  return (
    <span className={`font-bold tabular-nums ${urgency || color}`}>
      {remaining} turn{remaining !== 1 ? "s" : ""} remaining
    </span>
  );
}

// ─── Single Position Panel ────────────────────────────────────────────────────

function ElectionPanel({
  election,
  position,
  partyColor,
  partyName,
  stateId,
  countryId,
  partyId,
  canVote,
  canVoteReason,
  tenureTurnsRemaining,
  turnsUntilEligible,
  userVote,
  isCandidate: isCandidateForThis,
  isCandidateElsewhere,
  currentTurn,
  onRefresh,
}: {
  election: ElectionData | null;
  position: Position;
  partyColor: string;
  partyName: string;
  stateId: string;
  countryId: string;
  partyId: string;
  canVote: boolean;
  canVoteReason: "membership" | "cooldown" | "tenure" | null;
  tenureTurnsRemaining: number | null;
  turnsUntilEligible: number | null;
  userVote: { candidateId: string; candidateName: string } | null;
  isCandidate: boolean;
  isCandidateElsewhere: boolean;
  currentTurn: number;
  onRefresh: () => void;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  const positionLabels = getPositionLabels(countryId);
  const positionDescriptions = getPositionDescriptions(countryId);
  const positionLabel = election?.positionLabel ?? positionLabels[position];

  const performAction = async (endpoint: string, body: object) => {
    setActionLoading(true);
    setMessage("");
    try {
      const res = await fetch(
        `${regionApiSubUrl(countryId, stateId, `party/${partyId}/election/${endpoint}`)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      setMessage(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) onRefresh();
    } catch {
      setMessage("✗ Network error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnter = () => performAction("enter", { position });
  const handleWithdraw = () => {
    if (confirm("Withdraw from this race?")) performAction("enter", { position, withdraw: true });
  };
  const handleVote = (candidateCharId: string) =>
    performAction("vote", { position, candidateId: candidateCharId });

  // No election at all
  if (!election) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{POSITION_ICON[position]}</span>
          <span className="font-semibold">{positionLabel}</span>
        </div>
        <p className="text-xs text-muted">No active election for this position.</p>
      </div>
    );
  }

  const isVoting = election.status === "voting";
  const isCompleted = election.status === "completed";

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-3 flex items-center justify-between gap-3"
        style={{ backgroundColor: `${partyColor}15`, borderBottom: `2px solid ${partyColor}` }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{POSITION_ICON[position]}</span>
          <div>
            <div className="font-semibold text-sm">{positionLabel} Election</div>
            <div className="text-xs text-muted">{partyName}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {isVoting ? (
            <>
              <div className="text-xs text-muted">Closes</div>
              <TurnsRemaining
                endTurn={election.endTurn}
                currentTurn={currentTurn}
                color="text-foreground"
              />
            </>
          ) : (
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                isCompleted ? "bg-success/20 text-success" : "bg-card-elevated text-muted/80"
              }`}
            >
              {isCompleted ? "Completed" : "Cancelled"}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Role description */}
        <p className="text-xs text-muted/70 italic">{positionDescriptions[position]}</p>

        {/* Winner banner */}
        {isCompleted && election.winnerName && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: `${partyColor}20`, color: partyColor }}
          >
            <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {election.winnerName} elected as {positionLabel}
          </div>
        )}

        {/* No winner */}
        {isCompleted && !election.winnerName && (
          <div className="text-xs text-muted italic">No candidates ran — position unchanged.</div>
        )}

        {/* Message */}
        {message && (
          <div className={`rounded-lg p-2.5 text-xs ${getMessageStyle(message)}`}>{message}</div>
        )}

        {/* Actions */}
        {isVoting && canVote && (
          <div className="flex flex-wrap gap-2">
            {!isCandidateForThis && (
              <button
                onClick={handleEnter}
                disabled={actionLoading || isCandidateElsewhere}
                title={
                  isCandidateElsewhere ? "Withdraw from your other candidacy first" : undefined
                }
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: partyColor }}
              >
                {actionLoading ? "…" : `Run for ${positionLabel}`}
              </button>
            )}
            {isCandidateForThis && (
              <button
                onClick={handleWithdraw}
                disabled={actionLoading}
                className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-40"
              >
                {actionLoading ? "…" : "Withdraw"}
              </button>
            )}
          </div>
        )}

        {/* Candidate list */}
        {election.candidates.length === 0 ? (
          <p className="text-xs text-muted italic">No candidates yet.</p>
        ) : (
          <div className="space-y-2">
            {election.candidates.map((cand) => {
              const isMyVote = userVote?.candidateId === cand.characterId;
              const pct =
                election.totalVotes > 0
                  ? Math.round((cand.voteCount / election.totalVotes) * 100)
                  : 0;

              return (
                <div
                  key={cand.id}
                  className={`rounded-lg border p-3 ${isMyVote ? "border-2" : "border-card-border"}`}
                  style={isMyVote ? { borderColor: partyColor } : {}}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link
                        href={`/character/${cand.sequentialId ?? cand.characterId}`}
                        className="text-sm font-medium hover:text-primary transition-colors truncate"
                      >
                        {cand.characterName}
                      </Link>
                      {cand.isCurrentHolder && (
                        <span
                          className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${partyColor}20`, color: partyColor }}
                        >
                          Incumbent
                        </span>
                      )}
                      {isMyVote && (
                        <span className="shrink-0 text-[10px] text-success font-medium">
                          Your Vote
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-sm font-bold tabular-nums">{cand.voteCount}</div>
                        <div className="text-[10px] text-muted">
                          {election.totalVotes > 0 ? `${pct}%` : "—"}
                        </div>
                      </div>
                      {isVoting && canVote && !isMyVote && (
                        <button
                          onClick={() => handleVote(cand.characterId)}
                          disabled={actionLoading}
                          className="rounded-lg border border-card-border bg-background px-2.5 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                          Vote
                        </button>
                      )}
                      {isVoting && canVote && isMyVote && (
                        <button
                          onClick={() => handleVote(cand.characterId)}
                          disabled={actionLoading}
                          className="rounded-lg border border-card-border bg-background px-2.5 py-1 text-xs text-muted hover:border-error hover:text-error disabled:opacity-40"
                          title="Click another candidate to change your vote"
                        >
                          Voted
                        </button>
                      )}
                    </div>
                  </div>
                  {election.totalVotes > 0 && (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-card-border">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: partyColor }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-card-border">
          <span>Total votes: {election.totalVotes}</span>
          {isVoting && (
            <span>
              Turn {election.startTurn} → {election.endTurn}
            </span>
          )}
        </div>

        {!canVote && isVoting && (
          <p className="text-[10px] text-muted bg-background rounded px-2 py-1.5">
            {ineligibilityNote({
              canVoteReason,
              turnsUntilEligible,
              tenureTurnsRemaining,
              turnsLeftInElection:
                election.endTurn && currentTurn
                  ? Math.max(0, election.endTurn - currentTurn)
                  : null,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StatePartyLeadershipElections({
  stateId,
  countryId,
  partyId,
  partyColor,
  partyName,
  currentTurn,
}: Props) {
  const [data, setData] = useState<ElectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(regionApiSubUrl(countryId, stateId, `party/${partyId}/election`));
      if (res.ok) setData(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [countryId, stateId, partyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="text-muted text-sm">Loading leadership elections…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="text-muted text-sm">Could not load election data.</div>
      </div>
    );
  }

  // Is this user a candidate for any position (to block multi-running)?
  const candidatePositions = POSITION_ORDER.filter((p) => data.isCandidate[p]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Leadership Elections</h2>
        <span className="text-xs text-muted">Current turn: {currentTurn}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {POSITION_ORDER.map((position) => (
          <ElectionPanel
            key={position}
            election={data.elections[position]}
            position={position}
            partyColor={partyColor}
            partyName={partyName}
            stateId={stateId}
            countryId={countryId}
            partyId={partyId}
            canVote={data.canVote}
            canVoteReason={data.canVoteReason}
            tenureTurnsRemaining={data.tenureTurnsRemaining}
            turnsUntilEligible={data.turnsUntilEligible ?? null}
            userVote={data.userVotes[position]}
            isCandidate={data.isCandidate[position]}
            isCandidateElsewhere={
              candidatePositions.length > 0 && !candidatePositions.includes(position)
            }
            currentTurn={currentTurn}
            onRefresh={fetchData}
          />
        ))}
      </div>

      <p className="text-[10px] text-muted/60 italic">
        Elections run on a shared 72-turn cycle (an election opened mid-cycle ends with the rest).
        Members may vote and change their vote at any time before the election closes. Ties are
        broken by earliest declaration date.
      </p>
    </div>
  );
}
