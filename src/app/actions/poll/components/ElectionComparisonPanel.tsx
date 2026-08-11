"use client";

import { Fragment } from "react";
import { formatNum, appealColor, partyColor, partyBadgeClass } from "../pollHelpers";
import { EconomicPositionPip, SocialPositionPip } from "./PollCharts";
import type { ElectionContext, InRaceVoteShare, LastElectionPartySummary } from "../types";

function partyVotePct(
  last: LastElectionPartySummary | null | undefined,
  party: string
): number | null {
  if (!last?.partyPct) return null;
  const v = last.partyPct[party];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

export function ElectionComparisonPanel({
  electionContext,
  myPotentialVoters,
  myAppeal,
  inRaceVoteShare,
  myParty,
}: {
  electionContext: ElectionContext;
  myPotentialVoters: number;
  myAppeal: number;
  inRaceVoteShare?: InRaceVoteShare;
  /** Character party id — matches `ElectionCandidate.party` / tally aggregation */
  myParty: string;
}) {
  // When poll was taken during a race, use group-level allocation totals (matches election engine)
  const useInRaceTotals = inRaceVoteShare && Object.keys(inRaceVoteShare.opponentVotes).length > 0;

  const myVotes = useInRaceTotals ? inRaceVoteShare.myVotes : myPotentialVoters;
  const opponentVotes = useInRaceTotals
    ? electionContext.opponents.map((o) => inRaceVoteShare!.opponentVotes[o.candidateId] ?? 0)
    : electionContext.opponents.map((o) => o.totalPotentialVoters);
  const total = [myVotes, ...opponentVotes];
  const grandTotal = total.reduce((a, b) => a + b, 0) || 1;
  const myShare = (myVotes / grandTotal) * 100;

  return (
    <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-yellow-500/20 flex items-center gap-3">
        <svg
          className="h-5 w-5 text-yellow-400 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <div>
          <h3 className="font-semibold text-yellow-400 text-sm">
            General Election —{" "}
            {useInRaceTotals ? "Estimated Vote Share" : "Vote Potential Comparison"}
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {electionContext.electionType.charAt(0).toUpperCase() +
              electionContext.electionType.slice(1)}{" "}
            election · {electionContext.state} ·{" "}
            {useInRaceTotals
              ? "Group-level allocation (matches election engine)"
              : "Opponent figures from reachable voters; commission poll during race for estimated share"}
          </p>
          <p className="text-xs text-muted/90 mt-2 leading-relaxed">
            These percentages are from the{" "}
            <span className="text-foreground/90">internal poll model</span> (turnout, reach, appeal,
            party org)—not official vote counts. Compare to{" "}
            <span className="text-yellow-400/90">last election</span> below for how your party
            actually performed in the prior race for this seat.
          </p>
        </div>
      </div>

      <div className="divide-y divide-yellow-500/10">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs rounded-full border px-2 py-0.5 bg-primary/10 border-primary/30 text-primary font-medium shrink-0">
                You
              </span>
              <span className="font-semibold text-sm truncate">Your Character</span>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-bold text-primary">{formatNum(myVotes)}</div>
              <div className="text-xs text-muted">{myShare.toFixed(1)}% of combined pool</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-card-border overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${myShare}%` }}
              />
            </div>
            <span className={`text-xs font-medium w-12 text-right ${appealColor(myAppeal)}`}>
              {myAppeal.toFixed(1)} appeal
            </span>
          </div>
        </div>

        {electionContext.opponents.map((opp) => {
          const oppVotes = useInRaceTotals
            ? (inRaceVoteShare!.opponentVotes[opp.candidateId] ?? 0)
            : opp.totalPotentialVoters;
          const oppShare = (oppVotes / grandTotal) * 100;
          const ahead = myVotes > oppVotes;
          const diff = Math.abs(myVotes - oppVotes);
          return (
            <div key={opp.candidateId} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs rounded-full border px-2 py-0.5 font-medium shrink-0 ${partyBadgeClass(opp.party)}`}
                  >
                    {opp.isNPP
                      ? "NPP"
                      : opp.party.charAt(0).toUpperCase() + opp.party.slice(1, 3).toUpperCase()}
                  </span>
                  <span className="font-semibold text-sm truncate">{opp.name}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-bold ${partyColor(opp.party)}`}>
                    {formatNum(oppVotes)}
                  </div>
                  <div className="text-xs text-muted">{oppShare.toFixed(1)}% of combined pool</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-card-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      opp.party === "democrat"
                        ? "bg-blue-500"
                        : opp.party === "republican"
                          ? "bg-red-500"
                          : "bg-purple-500"
                    }`}
                    style={{ width: `${oppShare}%` }}
                  />
                </div>
                <span
                  className={`text-xs font-medium w-12 text-right ${appealColor(opp.overallAppeal)}`}
                >
                  {opp.overallAppeal.toFixed(1)} appeal
                </span>
              </div>
              <div className={`mt-1.5 text-xs ${ahead ? "text-green-400" : "text-red-400"}`}>
                {ahead
                  ? `▲ You lead by ${formatNum(diff)} votes`
                  : `▼ Trailing by ${formatNum(diff)} votes`}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                <span>
                  Econ: <EconomicPositionPip value={opp.economicPosition} />
                </span>
                <span>
                  Social: <SocialPositionPip value={opp.socialPosition} />
                </span>
                <span className="text-yellow-400/80">Fav: {opp.favorability.toFixed(0)}%</span>
                <span className="text-purple-400/80">
                  Influence: {opp.politicalInfluence.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 pb-4">
        <div className="text-xs text-muted mb-1.5">
          {useInRaceTotals
            ? "Estimated vote distribution (group-level allocation)"
            : "Combined vote pool distribution"}
        </div>
        <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
          <div className="h-full bg-primary transition-all" style={{ width: `${myShare}%` }} />
          {electionContext.opponents.map((opp) => {
            const oppVotes = useInRaceTotals
              ? (inRaceVoteShare!.opponentVotes[opp.candidateId] ?? 0)
              : opp.totalPotentialVoters;
            const s = (oppVotes / grandTotal) * 100;
            return (
              <div
                key={opp.candidateId}
                className={`h-full transition-all ${
                  opp.party === "democrat"
                    ? "bg-blue-500"
                    : opp.party === "republican"
                      ? "bg-red-500"
                      : "bg-purple-500"
                }`}
                style={{ width: `${s}%` }}
              />
            );
          })}
        </div>
      </div>

      {electionContext.lastElection && (
        <div className="border-t border-yellow-500/20 bg-black/10 px-5 py-4">
          <div className="text-xs font-semibold text-yellow-400/95 mb-1">
            Last election (cycle {electionContext.lastElection.cycle}) — results by party
          </div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            Final general vote shares for the previous race for this seat (
            {formatNum(electionContext.lastElection.totalVotes)} ballots). Your line&apos;s party is
            compared using the same party id as on the ballot.
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-xs items-center">
            <span className="text-muted font-medium uppercase tracking-wide">Candidate</span>
            <span className="text-muted font-medium text-right tabular-nums">Poll pool</span>
            <span className="text-muted font-medium text-right tabular-nums">Last election</span>

            <span className="truncate font-medium text-foreground">You</span>
            <span className="text-right tabular-nums text-primary">{myShare.toFixed(1)}%</span>
            <span className="text-right tabular-nums text-yellow-400/90">
              {partyVotePct(electionContext.lastElection, myParty) != null
                ? `${partyVotePct(electionContext.lastElection, myParty)!.toFixed(1)}%`
                : "—"}
            </span>

            {electionContext.opponents.map((opp) => {
              const oppVotes = useInRaceTotals
                ? (inRaceVoteShare!.opponentVotes[opp.candidateId] ?? 0)
                : opp.totalPotentialVoters;
              const oppShare = (oppVotes / grandTotal) * 100;
              const lastP = partyVotePct(electionContext.lastElection, opp.party);
              return (
                <Fragment key={opp.candidateId}>
                  <span className="truncate font-medium text-foreground">{opp.name}</span>
                  <span className={`text-right tabular-nums ${partyColor(opp.party)}`}>
                    {oppShare.toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-yellow-400/90">
                    {lastP != null ? `${lastP.toFixed(1)}%` : "—"}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
