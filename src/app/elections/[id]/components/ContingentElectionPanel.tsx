"use client";

import {
  CONTINGENT_EXCLUDED_HOUSE_STATE,
  HOUSE_CONTINGENT_THRESHOLD,
  SENATE_CONTINGENT_THRESHOLD,
} from "@/lib/elections/contingentElection";
import type { ContingentElectionDisplay } from "@/lib/elections/presidentialResolutionDisplay";
import type { CandidateDetail } from "./ElectionDetailTypes";

interface ContingentElectionPanelProps {
  contingentResult: ContingentElectionDisplay;
  resolutionMode: "contingent" | "contingent_deadlock";
  candidates: CandidateDetail[];
  candidateNames: Record<string, string>;
  colorMap: Map<string, string>;
  electoralVotes: Record<string, number>;
}

function resolveVpDisplayName(
  vpId: string,
  candidates: CandidateDetail[],
  candidateNames: Record<string, string>
): string {
  if (vpId.startsWith("npp_")) {
    const nppId = vpId.slice(4);
    const ticket = candidates.find((c) => c.nppId === nppId);
    if (ticket) return ticket.runningMateName ?? ticket.characterName;
  }
  const mate = candidates.find(
    (c) => c.runningMateCharacterId === vpId || c.runningMateId === vpId
  );
  if (mate?.runningMateName) return mate.runningMateName;
  return candidateNames[vpId] ?? vpId;
}

export function ContingentElectionPanel({
  contingentResult,
  resolutionMode,
  candidates,
  candidateNames,
  colorMap,
  electoralVotes,
}: ContingentElectionPanelProps) {
  const presidentWinnerName =
    candidateNames[contingentResult.presidentWinnerId] ?? contingentResult.presidentWinnerId;
  const houseWinnerVotes =
    contingentResult.houseVoteTotals[contingentResult.presidentWinnerId] ?? 0;

  const houseRows = Object.entries(contingentResult.houseVoteTotals).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  const senateRows = Object.entries(contingentResult.senateVoteTotals).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  const delegationEntries = Object.entries(contingentResult.houseDelegationVotes).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const vpWinnerName = contingentResult.vicePresidentWinnerId
    ? resolveVpDisplayName(contingentResult.vicePresidentWinnerId, candidates, candidateNames)
    : null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-5 space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-amber-200">Contingent Election</h3>
        <p className="mt-1 text-sm text-muted">
          No candidate reached 270 electoral votes. Under the 12th Amendment, the House elected the
          President from the top three EV finishers (one vote per state delegation;{" "}
          {HOUSE_CONTINGENT_THRESHOLD} states needed). The District of Columbia has electoral votes
          but does not cast a House delegation vote.
          {senateRows.length > 0 &&
            ` The Senate elected the Vice President from the top two running mates (${SENATE_CONTINGENT_THRESHOLD} votes needed).`}
        </p>
        {resolutionMode === "contingent_deadlock" && contingentResult.deadlockBreakerUsed && (
          <p className="mt-2 text-sm text-amber-300/90">
            No chamber reached the required threshold on the simulated ballot. A deterministic
            deadlock breaker selected the winner
            {contingentResult.deadlockBreakerReason
              ? ` (${contingentResult.deadlockBreakerReason})`
              : "."}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-card-border bg-card/60 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
            President — House ballot
          </div>
          <p className="text-sm font-semibold text-foreground mb-3">
            {presidentWinnerName} — {houseWinnerVotes} state delegation
            {houseWinnerVotes === 1 ? "" : "s"}
            <span className="text-muted font-normal">
              {" "}
              ({electoralVotes[contingentResult.presidentWinnerId] ?? 0} EV)
            </span>
          </p>
          <div className="space-y-1.5">
            {houseRows.map(([id, votes]) => (
              <div key={id} className="flex items-center justify-between text-sm">
                <span style={{ color: colorMap.get(id) }} className="font-medium">
                  {candidateNames[id] ?? id}
                </span>
                <span className="tabular-nums text-muted">{votes} states</span>
              </div>
            ))}
          </div>
        </div>

        {senateRows.length > 0 && (
          <div className="rounded-lg border border-card-border bg-card/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
              Vice President — Senate ballot
            </div>
            {vpWinnerName && contingentResult.vicePresidentWinnerId && (
              <p className="text-sm font-semibold text-foreground mb-3">
                {vpWinnerName} —{" "}
                {contingentResult.senateVoteTotals[contingentResult.vicePresidentWinnerId] ?? 0}{" "}
                senator
                {(contingentResult.senateVoteTotals[contingentResult.vicePresidentWinnerId] ??
                  0) === 1
                  ? ""
                  : "s"}
              </p>
            )}
            <div className="space-y-1.5">
              {senateRows.map(([vpId, votes]) => (
                <div key={vpId} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">
                    {resolveVpDisplayName(vpId, candidates, candidateNames)}
                  </span>
                  <span className="tabular-nums text-muted">{votes} senators</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {delegationEntries.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card/60 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted mb-3">
            State delegation votes
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {delegationEntries.map(([stateId, choiceId]) => {
              if (stateId === CONTINGENT_EXCLUDED_HOUSE_STATE) return null;
              return (
                <div
                  key={stateId}
                  className="flex items-center justify-between gap-2 border-b border-card-border/40 pb-1"
                >
                  <span className="font-medium text-foreground">{stateId}</span>
                  <span className="text-muted text-right truncate">
                    {choiceId
                      ? (candidateNames[choiceId] ?? choiceId)
                      : "Abstained (tied delegation)"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
