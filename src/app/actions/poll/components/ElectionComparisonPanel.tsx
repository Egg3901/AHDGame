"use client";

import { formatNum, appealColor, partyHex } from "../pollHelpers";
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

type Entry = {
  id: string;
  name: string;
  party: string | null;
  tag: string;
  votes: number;
  appeal: number | null;
  econ: number | null;
  social: number | null;
  favorability: number | null;
  influence: number | null;
};

export function ElectionComparisonPanel({
  electionContext,
  myPotentialVoters,
  myAppeal,
  inRaceVoteShare,
  myParty,
  partyColors,
}: {
  electionContext: ElectionContext;
  myPotentialVoters: number;
  myAppeal: number;
  inRaceVoteShare?: InRaceVoteShare;
  /** Character party id, matches `ElectionCandidate.party` / tally aggregation */
  myParty: string;
  /** Display hex per party id; unknown parties render neutral gray. */
  partyColors?: Record<string, string>;
}) {
  // When the poll was taken during a race, use group-level allocation totals (matches the election engine).
  const useInRaceTotals = inRaceVoteShare && Object.keys(inRaceVoteShare.opponentVotes).length > 0;

  const myVotes = useInRaceTotals ? inRaceVoteShare.myVotes : myPotentialVoters;
  const entries: Entry[] = [
    {
      id: "you",
      name: "You",
      party: myParty,
      tag: "You",
      votes: myVotes,
      appeal: myAppeal,
      econ: null,
      social: null,
      favorability: null,
      influence: null,
    },
    ...electionContext.opponents.map((o) => ({
      id: o.candidateId,
      name: o.name,
      party: o.isNPP ? null : o.party,
      tag: o.isNPP ? "NPP" : o.party.charAt(0).toUpperCase() + o.party.slice(1, 3).toUpperCase(),
      votes: useInRaceTotals
        ? (inRaceVoteShare!.opponentVotes[o.candidateId] ?? 0)
        : o.totalPotentialVoters,
      appeal: o.overallAppeal,
      econ: o.economicPosition,
      social: o.socialPosition,
      favorability: o.favorability,
      influence: o.politicalInfluence,
    })),
  ];
  const grandTotal = entries.reduce((a, e) => a + e.votes, 0) || 1;
  const share = (v: number) => (v / grandTotal) * 100;
  const myShare = share(myVotes);
  const rivals = entries.slice(1);
  const topRival = rivals.reduce<Entry | null>(
    (best, e) => (!best || e.votes > best.votes ? e : best),
    null
  );
  const lead = topRival ? myVotes - topRival.votes : null;
  const type =
    electionContext.electionType.charAt(0).toUpperCase() + electionContext.electionType.slice(1);

  return (
    <section
      aria-labelledby="poll-race-heading"
      className="rounded-lg border border-card-border bg-card p-5 sm:p-6"
    >
      <h2 id="poll-race-heading" className="text-heading font-semibold">
        {useInRaceTotals ? "Estimated vote share" : "Vote potential"}
      </h2>
      <p className="mt-1 text-body-sm text-muted">
        {type} election in {electionContext.state}.{" "}
        {useInRaceTotals
          ? "Group-level allocation, the same as the election engine."
          : "Rival figures come from reachable voters. Commission a poll during the race for an estimated share."}
      </p>

      {lead != null && topRival && (
        <p className="mt-4 text-body-lg font-semibold">
          <span className={lead >= 0 ? "text-success" : "text-error"}>
            {lead >= 0 ? "You lead" : "You trail"} {topRival.name}
          </span>
          <span className="tabular-nums text-foreground">
            {" "}
            by {formatNum(Math.abs(lead))} votes
          </span>
        </p>
      )}

      <div
        className="mt-3 flex h-3 w-full gap-px overflow-hidden rounded-full"
        role="img"
        aria-label={`Combined pool: ${entries.map((e) => `${e.name} ${share(e.votes).toFixed(1)}%`).join(", ")}`}
      >
        {entries.map((e) => (
          <div
            key={e.id}
            className="h-full"
            style={{ width: `${share(e.votes)}%`, backgroundColor: partyHex(partyColors, e.party) }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted">
        {entries.map((e) => (
          <li key={e.id} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: partyHex(partyColors, e.party) }}
              aria-hidden
            />
            {e.name} {share(e.votes).toFixed(1)}%
          </li>
        ))}
      </ul>

      <ul className="mt-5 divide-y divide-card-border">
        {entries.map((e) => {
          const hex = partyHex(partyColors, e.party);
          return (
            <li key={e.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: hex }}
                    aria-hidden
                  />
                  <span className="truncate text-body-lg font-semibold">{e.name}</span>
                  {e.id !== "you" && (
                    <span className="shrink-0 text-body-sm font-medium" style={{ color: hex }}>
                      {e.tag}
                    </span>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-body-lg font-semibold tabular-nums">
                    {formatNum(e.votes)}
                  </span>
                  <span className="ml-2 text-body-sm tabular-nums text-muted">
                    {share(e.votes).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-border">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${share(e.votes)}%`, backgroundColor: hex }}
                  />
                </div>
                {e.appeal != null && (
                  <span
                    className={`w-24 text-right text-body-sm font-medium tabular-nums ${appealColor(e.appeal)}`}
                  >
                    {e.appeal.toFixed(1)} appeal
                  </span>
                )}
              </div>
              {e.econ != null && e.social != null && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm text-muted">
                  <span>
                    Economic <EconomicPositionPip value={e.econ} />
                  </span>
                  <span>
                    Social <SocialPositionPip value={e.social} />
                  </span>
                  <span>Favorability {e.favorability?.toFixed(0)}%</span>
                  <span>Influence {e.influence?.toFixed(0)}%</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-body-sm text-muted">
        These shares come from the internal poll model (turnout, reach, appeal, party organization),
        not official vote counts.
      </p>

      {electionContext.lastElection && (
        <div className="mt-6">
          <h3 className="text-body-lg font-semibold">
            Last election, cycle {electionContext.lastElection.cycle}
          </h3>
          <p className="mt-1 text-body-sm text-muted">
            Final general vote shares for the previous race for this seat (
            {formatNum(electionContext.lastElection.totalVotes)} ballots), by party.
          </p>
          <table className="mt-3 w-full text-body">
            <thead>
              <tr className="text-left text-body-sm text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Candidate
                </th>
                <th scope="col" className="px-3 py-1 text-right font-medium">
                  Poll pool
                </th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">
                  Last election
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {entries.map((e) => {
                const last = e.party ? partyVotePct(electionContext.lastElection, e.party) : null;
                return (
                  <tr key={e.id}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: partyHex(partyColors, e.party) }}
                          aria-hidden
                        />
                        {e.name}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {share(e.votes).toFixed(1)}%
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-muted">
                      {last != null ? `${last.toFixed(1)}%` : "No data"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
