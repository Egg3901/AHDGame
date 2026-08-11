"use client";

import React from "react";
import { SectionLabel } from "@/components/ui";
import { PresidentialMapWithStateDetail } from "@/app/elections/[id]/components/PresidentialMapWithStateDetail";
import { isContingentResolutionMode } from "@/lib/elections/presidentialResolutionDisplay";
import type { GeneralResults } from "../wikiElectionTypes";

interface ElectoralCollegeAnalysisProps {
  electionId: string;
  generalResults: GeneralResults;
  totalVotes: number;
}

/** Prose analysis section rendered inside the article (with map). */
export function ElectoralCollegeAnalysis({
  electionId,
  generalResults,
  totalVotes,
}: ElectoralCollegeAnalysisProps) {
  if (!generalResults.electoralVotesByCandidate) return null;

  const evValues = Object.values(generalResults.electoralVotesByCandidate).sort((a, b) => b - a);
  const evMarginIsClose = evValues.length >= 2 && evValues[0] - evValues[1] < 50;
  const isContingent = isContingentResolutionMode(generalResults.resolutionMode);
  const contingent = generalResults.contingentResult;
  const presidentWinnerName = contingent
    ? (generalResults.candidateNames[contingent.presidentWinnerId] ?? contingent.presidentWinnerId)
    : null;
  const houseWinnerVotes = contingent
    ? (contingent.houseVoteTotals[contingent.presidentWinnerId] ?? 0)
    : 0;

  return (
    <section className="mb-8">
      <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
        Electoral College Analysis
      </h2>

      {generalResults.electoralMapData && (
        <div className="mb-6">
          <PresidentialMapWithStateDetail
            electionId={electionId}
            electoralMapData={generalResults.electoralMapData}
            electoralVotesByCandidate={generalResults.electoralVotesByCandidate}
            candidateNames={generalResults.candidateNames}
            candidateParties={generalResults.candidateParties}
            stateVoteData={generalResults.stateVoteData}
            stateVotesOverTime={generalResults.stateVotesOverTime}
          />
        </div>
      )}

      {isContingent && contingent && presidentWinnerName ? (
        <>
          <p className="mb-4 leading-relaxed text-muted">
            No presidential candidate reached the 270 electoral votes required for an outright
            victory. Under the 12th Amendment, the House of Representatives elected the President
            from the top three Electoral College finishers, casting one vote per state delegation.
            The District of Columbia participates in the Electoral College but does not vote in the
            House contingent ballot.
          </p>
          <p className="mb-4 leading-relaxed text-muted">
            <strong className="text-foreground">{presidentWinnerName}</strong> was seated after
            winning {houseWinnerVotes} state delegation vote{houseWinnerVotes === 1 ? "" : "s"} on
            the House ballot, despite finishing with{" "}
            {generalResults.electoralVotesByCandidate?.[contingent.presidentWinnerId] ?? 0}{" "}
            electoral votes in the November tally.
            {Object.keys(contingent.senateVoteTotals).length > 0 &&
              contingent.vicePresidentWinnerId &&
              ` The Senate separately elected a Vice President from the top two running mates.`}
            {contingent.deadlockBreakerUsed &&
              " A deterministic deadlock breaker resolved an unresolved chamber ballot."}
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 leading-relaxed text-muted">
            The Electoral College system, enshrined in the Constitution, proved decisive in
            determining the presidency. Each state&apos;s electoral votes were awarded to the
            candidate who won the popular vote within that state, following the winner-take-all
            principle used by most states (Maine and Nebraska being the notable exceptions, which
            allocate electoral votes by congressional district).
          </p>
          <p className="mb-4 leading-relaxed text-muted">
            The final tally demonstrated{" "}
            {evMarginIsClose
              ? "a closely divided nation with competitive results across multiple swing states. The narrow margin in electoral votes reflected the polarized political landscape and the importance of strategic campaigning in battleground states. The outcome hinged on a handful of competitive states where both major candidates invested significant resources."
              : "a clear electoral mandate with decisive victories in key battleground states. The winning candidate's coalition proved strong enough to capture both reliably partisan states and crucial swing states, resulting in a comfortable margin in the Electoral College."}
          </p>
        </>
      )}
      {totalVotes > 0 && (
        <p className="mb-4 leading-relaxed text-muted">
          While the Electoral College determined the presidency, the popular vote provided
          additional context for understanding voter preferences nationwide. The relationship
          between the popular vote distribution and the electoral vote outcome illustrated the
          distinctive features of the American electoral system.
        </p>
      )}
    </section>
  );
}

interface ElectoralCollegeTableProps {
  generalResults: GeneralResults;
}

/** Data table section rendered outside the article prose block. */
export function ElectoralCollegeTable({ generalResults }: ElectoralCollegeTableProps) {
  if (!generalResults.electoralVotesByCandidate) return null;
  if (Object.keys(generalResults.electoralVotesByCandidate).length === 0) return null;

  const isContingent = isContingentResolutionMode(generalResults.resolutionMode);

  return (
    <section className="mb-10 rounded-xl border border-card-border bg-card/40 p-6 shadow-panel">
      <SectionLabel as="h3">Electoral College Results</SectionLabel>
      <p className="mb-4 text-sm text-muted">
        {isContingent
          ? "270 electoral votes needed for an outright win. This race was decided by a House contingent ballot after no candidate reached a majority."
          : "270 electoral votes needed to win. Winner-take-all per state (Maine and Nebraska allocate by congressional district)."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card-elevated">
            <tr className="border-b border-card-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Candidate</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Party</th>
              <th className="pb-2 font-medium text-foreground">Electoral Votes</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(generalResults.electoralVotesByCandidate)
              .sort(([, a], [, b]) => b - a)
              .map(([candId, ev]) => {
                const name = generalResults.candidateNames[candId] ?? candId;
                const party = generalResults.candidateParties[candId] ?? "—";
                return (
                  <tr
                    key={candId}
                    className="border-b border-card-border/50 last:border-0 hover:bg-card-elevated/30 transition-colors"
                  >
                    <td className="py-2 pr-4 font-medium text-foreground">{name}</td>
                    <td className="py-2 pr-4 text-muted">{party}</td>
                    <td className="py-2 font-medium text-foreground">{ev}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
