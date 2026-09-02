"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary, OrgViewerInfo } from "./orgTypes";
import { VoteButtons } from "./VoteButtons";
import { VoteRoster } from "./VoteRoster";
import {
  dedupeOrganizationVotes,
  votesNeeded,
} from "@/lib/internationalOrganizations/resolutionRules";
import { useEntityName } from "./useEntityName";

interface Props {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  currentTurn: number;
  votingWindowTurns: number;
  onChange: () => void;
}

interface CandidatePick {
  characterId: string;
  characterName: string;
  countryId: CountryId;
  roleLabel: string;
}

/** Shape returned by the candidates lookup endpoint. */
interface CandidatesResponse {
  candidates: CandidatePick[];
}

export function LeadershipPanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const entityName = useEntityName();
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  // Voting and nominating both go through isVotingMember on the server, so a
  // member without a ballot must not be offered either.
  const viewerHoldsVote =
    viewerFmCountry != null &&
    org.members.some((m) => m.countryId === viewerFmCountry && m.hasPolicyVote);

  const leader = org.leadership;
  // Permanent-leadership orgs: the office is held ex officio by the leader
  // country's head of government (derived server-side) — no nominations or
  // elections ever.
  const permanentLeaderCountry = org.def.permanentLeadership?.countryId ?? null;
  const isPermanent = permanentLeaderCountry != null;
  const election = org.pendingLeadershipElections[0] ?? null;
  const seatHeldUntilTurn = leader?.termEndsOnTurn ?? null;
  const seatStillFilled =
    leader?.holderCharacterId != null &&
    seatHeldUntilTurn != null &&
    seatHeldUntilTurn > currentTurn;

  const [showForm, setShowForm] = useState(false);
  const [candidates, setCandidates] = useState<CandidatePick[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showForm) return;
    setCandidatesLoading(true);
    fetch(`/api/world/international-organizations/${org.id}/candidates`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((data: CandidatesResponse) => setCandidates(data.candidates ?? []))
      .catch(() => setCandidates([]))
      .finally(() => setCandidatesLoading(false));
  }, [showForm, org.id]);

  async function nominate() {
    if (!viewerFmCountry || !pickedId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/leadership/nominate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidateCharacterId: pickedId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to nominate");
      }
      setShowForm(false);
      setPickedId(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to nominate");
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(electionId: string, voteValue: ProposalVote) {
    if (!viewerFmCountry) throw new Error("No diplomatic role");
    const res = await fetch(
      `/api/country/${viewerFmCountry}/international-organizations/leadership-elections/${electionId}/vote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote: voteValue }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? "Vote failed");
    }
    onChange();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">{org.def.leadership.title}</h3>
        {!isPermanent && viewerHoldsVote && !election && !seatStillFilled && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Nominate a candidate"}
          </Button>
        )}
      </div>

      {/* Current holder card */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        {leader?.holderCharacterName ? (
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-card-border bg-background">
              {leader.holderCountryId && <CountryFlag country={leader.holderCountryId} size="lg" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                Currently held by
              </p>
              <p className="text-base font-semibold text-foreground">
                {leader.holderCharacterName}
              </p>
              {leader.holderCountryId && (
                <p className="text-xs text-muted">
                  {entityName(leader.holderCountryId as CountryId)}
                </p>
              )}
              {isPermanent ? (
                <p className="mt-1 text-xs text-muted">
                  Permanent office — held ex officio by the head of government of{" "}
                  {entityName(permanentLeaderCountry)}.
                </p>
              ) : (
                seatHeldUntilTurn != null && (
                  <p className="mt-1 text-xs text-muted">
                    Term ends turn {seatHeldUntilTurn}
                    {seatStillFilled
                      ? ` (in ${seatHeldUntilTurn - currentTurn} turn${
                          seatHeldUntilTurn - currentTurn === 1 ? "" : "s"
                        })`
                      : ""}
                  </p>
                )
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="italic text-muted">Seat is currently vacant.</p>
            {isPermanent && (
              <p className="mt-1 text-xs text-muted">
                Permanent office — held ex officio by the head of government of{" "}
                {entityName(permanentLeaderCountry)}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Nominate form */}
      {!isPermanent && showForm && viewerHoldsVote && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">
            Nominate a candidate for {org.def.leadership.title}
          </h4>
          <p className="mt-1 text-xs text-muted">
            Candidates must be a sitting head of government or foreign minister of a member country.
            Election runs {votingWindowTurns} turns; a majority of the voting members elects.
          </p>
          {candidatesLoading ? (
            <div className="mt-3 h-24 animate-pulse rounded-lg bg-card-border" />
          ) : candidates.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No eligible candidates available.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {candidates.map((c) => (
                <label
                  key={c.characterId}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                    pickedId === c.characterId
                      ? "border-primary bg-primary/10"
                      : "border-card-border bg-card hover:border-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={pickedId === c.characterId}
                    onChange={() => setPickedId(c.characterId)}
                    className="accent-primary"
                  />
                  <CountryFlag country={c.countryId} size="md" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{c.characterName}</p>
                    <p className="text-xs text-muted">
                      {c.roleLabel} · {entityName(c.countryId)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={nominate}
              isLoading={submitting}
              disabled={!pickedId}
            >
              Submit nomination
            </Button>
          </div>
        </div>
      )}

      {/* Active election */}
      {!isPermanent && election && (
        <article className="rounded-xl border border-card-border bg-card p-5 shadow-card">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold text-foreground">
                Nominee: {election.candidateCharacterName}
              </h5>
              <p className="mt-0.5 text-xs text-muted">
                {entityName(election.candidateCountryId as CountryId)} · Nominated by{" "}
                {election.nominatedByCharacterName}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Closes turn {election.closesOnTurn} (in{" "}
                {Math.max(0, election.closesOnTurn - currentTurn)} turn
                {Math.max(0, election.closesOnTurn - currentTurn) === 1 ? "" : "s"})
              </p>
            </div>
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              Voting
            </span>
          </div>

          {(() => {
            // Only members holding a ballot are counted, and the bar is a
            // majority of that roll rather than of whoever turned out.
            const ballotSize = org.members.filter((m) => m.hasPolicyVote).length;
            const votes = dedupeOrganizationVotes(election.votes);
            const countedVotes = votes.filter((v) =>
              org.members.some((m) => m.countryId === v.countryId && m.hasPolicyVote)
            );
            const yesCount = countedVotes.filter((v) => v.vote === "yes").length;
            const noCount = countedVotes.filter((v) => v.vote === "no").length;
            const abstainCount = countedVotes.filter((v) => v.vote === "abstain").length;
            const needed = votesNeeded("leadership_election", ballotSize);
            const requirement =
              ballotSize === 0
                ? "no members hold a vote"
                : `${needed} of ${ballotSize} needed to elect`;
            const myVote =
              viewerFmCountry != null
                ? (votes.find((v) => v.countryId === viewerFmCountry)?.vote ?? null)
                : null;
            return (
              <>
                <p className="mb-3 text-xs text-muted">
                  {yesCount} yes · {noCount} no · {abstainCount} abstain · {requirement}.
                </p>
                <VoteButtons
                  onVote={(v) => vote(election._id.toString(), v)}
                  disabled={!viewerHoldsVote}
                  disabledReason={
                    !viewerHoldsVote
                      ? !viewerIsMember
                        ? "Only foreign ministers of member countries may vote."
                        : "Your country holds no vote in this organization."
                      : undefined
                  }
                  currentVote={myVote}
                />

                <VoteRoster
                  votes={election.votes}
                  expectedVoters={org.members
                    .filter((m) => m.hasPolicyVote)
                    .map((m) => m.countryId)}
                />
              </>
            );
          })()}
        </article>
      )}
    </section>
  );
}
