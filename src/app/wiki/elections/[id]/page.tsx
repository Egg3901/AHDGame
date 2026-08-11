"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/wiki/layout/Breadcrumbs";
import type { ElectionDetail } from "./wikiElectionTypes";
import {
  formatDate,
  generateOverview,
  generateBackground,
  generateCandidatesNarrative,
  generateCampaignNarrative,
  generatePrimaryNarrative,
  generateResultsNarrative,
} from "./wikiElectionHelpers";
import { ElectionInfoBox } from "./components/ElectionInfoBox";
import { PrimaryResultsSection } from "./components/PrimaryResultsSection";
import { GeneralResultsSection } from "./components/GeneralResultsSection";
import {
  ElectoralCollegeAnalysis,
  ElectoralCollegeTable,
} from "./components/ElectoralCollegeSection";
import { ElectionFooter } from "./components/ElectionFooter";

export default function WikiElectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const [election, setElection] = useState<ElectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/wiki/elections/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(setElection)
      .catch(() => setError("Election not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="text-muted">Loading election…</div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center text-error">
          {error ?? "Election not found"}
        </div>
        <Link
          href="/wiki/elections"
          className="mt-4 block text-sm text-muted hover:text-foreground"
        >
          ← Back to Elections
        </Link>
      </div>
    );
  }

  const totalVotes = election.generalResults
    ? Object.values(election.generalResults.totalVotes).reduce((a, b) => a + b, 0)
    : 0;

  const primaryNarrative = generatePrimaryNarrative(election);
  const resultsNarrative = generateResultsNarrative(election, totalVotes);
  const backgroundNarrative = generateBackground(election);
  const candidates = generateCandidatesNarrative(election, totalVotes);
  const campaignNarrative = generateCampaignNarrative(election);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs
        items={[
          { label: "Wiki", href: "/" },
          { label: "Elections", href: "/wiki/elections" },
          { label: election.label },
        ]}
      />

      <article className="prose prose-invert max-w-none">
        {/* Header with title */}
        <header className="mb-8 border-b border-card-border pb-6">
          <h1 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
            {election.label}
          </h1>
          <p className="text-sm text-muted">
            Completed {formatDate(election.endTime)} · Cycle {election.cycle}
            {election.totalSeats && election.electionType === "house" && (
              <>
                {" "}
                · {election.totalSeats} seat{election.totalSeats > 1 ? "s" : ""}
              </>
            )}
          </p>
        </header>

        {/* Overview section - Lead paragraph */}
        <section className="mb-8">
          <p className="text-lg leading-relaxed text-foreground/90">
            {generateOverview(election, totalVotes)}
          </p>
        </section>

        {/* Info box - Election at a glance */}
        <ElectionInfoBox election={election} totalVotes={totalVotes} />

        {/* Background & Context */}
        {backgroundNarrative && (
          <section className="mb-8">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Background
            </h2>
            <p className="mb-4 leading-relaxed text-muted">{backgroundNarrative}</p>
          </section>
        )}

        {/* Candidates section */}
        {candidates.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Candidates
            </h2>
            <p className="mb-6 leading-relaxed text-muted">
              The election featured {candidates.length} candidate
              {candidates.length !== 1 ? "s" : ""}, representing diverse political perspectives and
              competing visions for{" "}
              {election.electionType === "president" ? "the nation's future" : "governance"}.
            </p>
            <div className="space-y-5">
              {candidates.map((candidate, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-card-border bg-card/30 p-5 shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-foreground mb-1">{candidate.name}</h3>
                      <p className="text-sm font-medium text-primary">{candidate.party}</p>
                    </div>
                    {candidate.placement === "winner" && (
                      <span className="rounded-full bg-success/10 border border-success/25 px-3 py-1 text-xs font-semibold text-success shrink-0">
                        WINNER
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed text-muted">
                      {candidate.placement === "winner"
                        ? `${candidate.name} secured victory in this election, earning ${candidate.pct.toFixed(1)}% of the vote with ${candidate.votes.toLocaleString("en-US")} total votes. `
                        : candidate.placement === "runner-up"
                          ? `${candidate.name} finished in second place with ${candidate.pct.toFixed(1)}% of the vote (${candidate.votes.toLocaleString("en-US")} votes), representing a strong showing for the ${candidate.party}. `
                          : `${candidate.name} earned ${candidate.pct.toFixed(1)}% of the vote (${candidate.votes.toLocaleString("en-US")} votes) in this contest. `}
                      {election.electionType === "president" && candidate.ev !== undefined && (
                        <span>
                          This translated to {candidate.ev} electoral votes in the Electoral
                          College.{" "}
                        </span>
                      )}
                      {election.electionType === "house" && candidate.seats !== undefined && (
                        <span>
                          The {candidate.party} won {candidate.seats} seat
                          {candidate.seats !== 1 ? "s" : ""} in the House delegation.{" "}
                        </span>
                      )}
                    </p>
                    <p className="text-sm leading-relaxed text-muted">
                      {candidate.placement === "winner"
                        ? `With this victory, the ${candidate.party} secured control of this office for the coming term. The win solidified the party's position and provided a mandate to pursue its policy agenda.`
                        : candidate.placement === "runner-up"
                          ? `Despite the loss, ${candidate.name}'s campaign demonstrated the ${candidate.party}'s competitive strength and ability to mobilize significant voter support. The close result highlighted the competitive nature of this race.`
                          : `The ${candidate.name} campaign contributed to the broader democratic process by offering voters an alternative perspective and participating in the electoral contest.`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Primary Elections section */}
        {primaryNarrative && (
          <section className="mb-8">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Primary Elections
            </h2>
            <p className="mb-4 leading-relaxed text-muted">
              Prior to the general election, candidates competed within their respective parties to
              secure nominations. The primary process allowed party members to select their
              standard-bearers through a weighted scoring system that incorporated multiple campaign
              performance factors.
            </p>
            <p className="mb-4 leading-relaxed text-muted">{primaryNarrative}</p>
            <p className="text-sm italic text-muted/80">
              Primary results reflected each candidate&apos;s ability to mobilize party support,
              build organizational strength, and articulate a compelling vision during the
              nomination phase of the election cycle.
            </p>
          </section>
        )}

        {/* General Election Campaign section */}
        {campaignNarrative && (
          <section className="mb-8 clear-both">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Campaign
            </h2>
            <p className="mb-4 leading-relaxed text-muted">{campaignNarrative}</p>
            {election.electionType !== "president" && totalVotes > 0 && (
              <p className="mb-4 leading-relaxed text-muted">
                When polls closed, a total of {totalVotes.toLocaleString("en-US")} votes had been
                cast, reflecting {election.electionType === "house" ? "significant" : "substantial"}{" "}
                voter engagement in this contest for{" "}
                {election.electionType === "house"
                  ? "legislative representation"
                  : "executive office"}
                .
              </p>
            )}
          </section>
        )}

        {/* Results section */}
        {resultsNarrative && (
          <section className="mb-8">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Results
            </h2>
            <p className="mb-4 leading-relaxed text-muted">
              When all votes were tallied, the election produced the following outcome:
            </p>
            <p className="mb-4 leading-relaxed text-muted">{resultsNarrative}</p>
            {election.generalResults?.finalized && (
              <p className="text-sm italic text-muted/80">
                These results were officially certified and finalized, marking the conclusion of the{" "}
                {election.year} election cycle for this office.
              </p>
            )}
          </section>
        )}

        {/* Electoral College Analysis (president only, inside article) */}
        {election.electionType === "president" && election.generalResults && (
          <ElectoralCollegeAnalysis
            electionId={election.id}
            generalResults={election.generalResults}
            totalVotes={totalVotes}
          />
        )}

        {/* Historical Significance */}
        {election.generalResults && (
          <section className="mb-8">
            <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
              Historical Significance
            </h2>
            <p className="mb-4 leading-relaxed text-muted">
              {election.electionType === "president"
                ? `This presidential election marked an important milestone in the nation's democratic tradition. The peaceful transfer of power (or continuity of leadership) that followed the election reaffirmed the strength of American democratic institutions. The results would shape federal policy priorities, judicial appointments, and the nation's direction for the next four years.`
                : election.electionType === "governor"
                  ? `As a gubernatorial contest, this election had significant implications for ${election.stateName}'s governance and policy direction. The newly elected governor would lead the state's executive branch, influence legislative priorities, and represent the state's interests in federal-state relations. The election outcome reflected voter sentiment on key state issues and set the tone for governance in the coming years.`
                  : election.electionType === "senate"
                    ? `This Senate election contributed to the balance of power in the upper chamber of Congress. Senate races carry particular importance due to the body's six-year terms, advice-and-consent role in presidential appointments, and unique constitutional responsibilities. The newly elected senator would represent ${election.stateName} in federal legislative deliberations and serve on key Senate committees.`
                    : election.electionType === "house"
                      ? `The results of this House election determined the composition of ${election.stateName}'s congressional delegation for a two-year term. Collectively, these races contributed to the national balance of power in the House of Representatives, influencing which party would control the chamber's agenda, committee chairmanships, and legislative priorities.`
                      : `This state legislative election shaped the composition of ${election.stateName}'s lawmaking body. The results would influence state policy on a wide range of issues including education, healthcare, infrastructure, and economic development. The balance of power established by this election would impact the legislative process and the relationship between the legislative and executive branches at the state level.`}
            </p>
            {candidates.length >= 3 && (
              <p className="mb-4 leading-relaxed text-muted">
                The presence of multiple candidates representing different parties highlighted the
                diversity of political viewpoints within the electorate. While the major parties
                dominated the contest, the participation of additional candidates provided voters
                with a broader range of choices and contributed to the democratic process.
              </p>
            )}
          </section>
        )}

        {/* Detailed Results heading */}
        <section className="mb-6 mt-12">
          <h2 className="mb-4 scroll-mt-24 border-b border-card-border pb-2 text-2xl font-semibold text-foreground">
            Detailed Results and Data
          </h2>
          <p className="mb-3 leading-relaxed text-muted">
            The following tables provide comprehensive statistical data from the {election.year}{" "}
            election, including primary competition results, vote tallies, and final standings.
            These figures represent the official tabulated results as recorded at the conclusion of
            the election process.
          </p>
          <p className="mb-6 text-sm text-muted">
            Note: All percentages are calculated from total votes cast.{" "}
            {election.electionType === "president" &&
              "Electoral vote allocations follow each state's designated method (winner-take-all or proportional by district)."}
          </p>
        </section>
      </article>

      {/* Data Tables Section - Primary Results */}
      <PrimaryResultsSection
        primaryResults={election.primaryResults}
        snapshotHistory={election.primarySnapshotHistory}
      />

      {/* Electoral College Table (President only) */}
      {election.electionType === "president" && election.generalResults && (
        <ElectoralCollegeTable generalResults={election.generalResults} />
      )}

      {/* General Election Results Table */}
      {election.generalResults && (
        <GeneralResultsSection
          electionType={election.electionType}
          generalResults={election.generalResults}
          totalVotes={totalVotes}
        />
      )}

      {!election.generalResults && election.primaryResults.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card/40 p-8 text-center">
          <div className="mb-4 text-4xl opacity-30">📊</div>
          <p className="text-base text-foreground mb-2 font-medium">Election Data Pending</p>
          <p className="text-sm text-muted">
            Detailed results for this election are not yet available. Complete vote tallies,
            candidate information, and analysis will be added once the election concludes and
            results are certified.
          </p>
          <p className="mt-4 text-sm text-muted/80">
            Check back after the election date for comprehensive results and historical context.
          </p>
        </div>
      )}

      {/* See Also / Navigation footer */}
      <ElectionFooter election={election} />
    </div>
  );
}
