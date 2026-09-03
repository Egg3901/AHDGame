"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { postBillProposalWithElectionConfirmation } from "@/components/bills/BillAutoFailWarning";

import type { OrgSummary, OrgViewerInfo } from "./orgTypes";
import { VoteButtons } from "./VoteButtons";
import { VoteRoster } from "./VoteRoster";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import {
  dedupeOrganizationVotes,
  requiresUnanimity,
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

/**
 * Pending membership applications + a "propose to join" CTA visible to the
 * viewer's foreign minister when their country is not yet a member.
 */
export function MembershipPanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const entityName = useEntityName();
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  // Casting a ballot goes through isVotingMember on the server; membership alone
  // is not enough.
  const viewerHoldsVote =
    viewerFmCountry != null &&
    org.members.some((m) => m.countryId === viewerFmCountry && m.hasVote);
  const viewerHasPendingWithdrawal =
    viewerFmCountry != null &&
    org.pendingWithdrawalMeasures.some(
      (measure) =>
        measure.targetType === "leave_organization" && measure.targetCountryId === viewerFmCountry
    );
  const viewerHasOpenProposal =
    viewerFmCountry != null &&
    org.pendingMembershipProposals.some((p) => p.proposingCountryId === viewerFmCountry);

  const [proposing, setProposing] = useState(false);
  const [proposingLeave, setProposingLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaveSuccess, setLeaveSuccess] = useState<string | null>(null);
  const [leavePendingLocal, setLeavePendingLocal] = useState(false);
  const hasPendingWithdrawal = viewerHasPendingWithdrawal || leavePendingLocal;

  async function proposeJoin() {
    if (!viewerFmCountry) return;
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/propose-join`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose join");
      }
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose join");
    } finally {
      setProposing(false);
    }
  }

  async function vote(proposalId: string, voteValue: ProposalVote) {
    if (!viewerFmCountry) throw new Error("No diplomatic role");
    const res = await fetch(
      `/api/country/${viewerFmCountry}/international-organizations/proposals/${proposalId}/vote`,
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

  async function proposeLeave() {
    if (!viewerFmCountry) return;
    setProposingLeave(true);
    setLeaveError(null);
    setLeaveSuccess(null);
    try {
      const {
        response: res,
        data,
        cancelled,
      } = await postBillProposalWithElectionConfirmation({
        url: `/api/country/${viewerFmCountry}/international-organizations/${org.id}/propose-leave`,
        body: { targetType: "organization" },
      });
      if (cancelled) return;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to propose withdrawal"
        );
      }
      setLeaveSuccess(
        `${entityName(viewerFmCountry)}'s withdrawal measure was sent to the legislature.`
      );
      setLeavePendingLocal(true);
      onChange();
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : "Failed to propose withdrawal");
    } finally {
      setProposingLeave(false);
    }
  }

  const canPropose = viewerFmCountry != null && !viewerIsMember && !viewerHasOpenProposal;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">Membership</h3>
        <div className="flex flex-col items-end gap-1">
          {viewerFmCountry && !viewerIsMember && (
            <>
              <Button
                variant="primary"
                size="md"
                isLoading={proposing}
                disabled={!canPropose}
                onClick={proposeJoin}
              >
                Apply for {entityName(viewerFmCountry)} to join
              </Button>
              {viewerHasOpenProposal && (
                <p className="text-xs text-muted">Application already pending.</p>
              )}
              {error && <p className="text-xs text-error">{error}</p>}
            </>
          )}
          {viewerFmCountry && viewerIsMember && (
            <>
              <Button
                variant="ghost"
                size="md"
                isLoading={proposingLeave}
                disabled={hasPendingWithdrawal}
                onClick={proposeLeave}
              >
                {hasPendingWithdrawal ? "Withdrawal pending" : "Propose withdrawal"}
              </Button>
              <p className="max-w-xs text-right text-xs text-muted">
                Sends a withdrawal resolution to the national legislature for chamber votes.
              </p>
              {hasPendingWithdrawal && (
                <p className="max-w-xs text-right text-xs text-muted">
                  A withdrawal measure is already pending in the legislature.
                </p>
              )}
              {leaveSuccess && (
                <p className="max-w-xs text-right text-xs text-success">{leaveSuccess}</p>
              )}
              {leaveError && <p className="max-w-xs text-right text-xs text-error">{leaveError}</p>}
            </>
          )}
        </div>
      </div>

      {org.pendingMembershipProposals.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <p className="text-sm text-muted">No pending membership applications.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {org.pendingMembershipProposals.map((p) => {
            const proposingName = entityName(p.proposingCountryId);
            // Empty-org accession: the org vote was waived at application time,
            // so there is no member tally to show — only the domestic bill.
            const isFoundingApplication = p.orgVoteExempt === true;
            const turnsLeft = Math.max(0, p.closesOnTurn - currentTurn);
            const votes = dedupeOrganizationVotes(p.votes);
            const myVote =
              viewerFmCountry != null
                ? (votes.find((v) => v.countryId === viewerFmCountry)?.vote ?? null)
                : null;
            // The applicant does not vote on its own accession, and a member
            // that holds no ballot cannot withhold the consent unanimity needs.
            const eligibleVoters = org.members.filter(
              (m) => m.hasVote && m.countryId !== p.proposingCountryId
            );
            const eligibleVoterCount = eligibleVoters.length;
            const countedVotes = votes.filter((v) =>
              eligibleVoters.some((m) => m.countryId === v.countryId)
            );
            const yesCount = countedVotes.filter((v) => v.vote === "yes").length;
            const noCount = countedVotes.filter((v) => v.vote === "no").length;
            const needed = votesNeeded("membership_proposal", eligibleVoterCount);
            const progress = needed > 0 ? (yesCount / needed) * 100 : 0;
            const requirement =
              eligibleVoterCount === 0
                ? "no members hold a vote"
                : requiresUnanimity("membership_proposal")
                  ? "unanimous required"
                  : `${needed} needed`;

            const canVote =
              viewerFmCountry != null &&
              viewerHoldsVote &&
              viewerFmCountry !== p.proposingCountryId;
            const reason = !viewerFmCountry
              ? "Sign in as a foreign minister to vote."
              : !viewerIsMember
                ? `${entityName(viewerFmCountry)} must be a member to vote.`
                : !viewerHoldsVote
                  ? "Your country holds no vote in this organization."
                  : viewerFmCountry === p.proposingCountryId
                    ? "Applicants cannot vote on their own application."
                    : undefined;

            return (
              <article
                key={p._id.toString()}
                className="rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">
                      {proposingName} applied to join
                    </h4>
                    <p className="mt-0.5 text-xs text-muted">
                      Proposed by {p.proposedByCharacterName} on turn {p.proposedOnTurn} · voting
                      closes in {turnsLeft} turn
                      {turnsLeft === 1 ? "" : "s"} (turn {p.closesOnTurn})
                    </p>
                    {p.domesticBillId && (
                      <p className="mt-0.5 text-xs text-muted">
                        Domestic ratification bill:{" "}
                        <span className="font-medium text-foreground">
                          {p.domesticApproved === true
                            ? "passed"
                            : p.domesticApproved === false
                              ? "failed"
                              : "in progress"}
                        </span>{" "}
                        {isFoundingApplication
                          ? " — the organization has no members to vote, so this bill alone decides admission."
                          : " — both the members' vote and this bill must pass to admit."}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    {isFoundingApplication ? "Awaiting ratification" : "Voting"}
                  </span>
                </div>

                {isFoundingApplication ? (
                  <p className="text-xs text-muted">
                    Founding application — admission is decided by the applicant&apos;s own
                    legislature.
                  </p>
                ) : (
                  <>
                    <div className="mb-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-muted">
                        <span>
                          {yesCount} / {eligibleVoterCount} yes ({noCount} no), {requirement}
                        </span>
                        <span className="tabular-nums">
                          {votingWindowTurns - turnsLeft}/{votingWindowTurns} turns
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                        <div
                          className="h-full rounded-full bg-success transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                      </div>
                    </div>

                    <VoteButtons
                      onVote={(v) => vote(p._id.toString(), v)}
                      disabled={!canVote}
                      disabledReason={reason}
                      currentVote={myVote}
                    />

                    <VoteRoster
                      votes={p.votes}
                      expectedVoters={org.members
                        .filter((m) => m.hasVote)
                        .map((m) => m.countryId)
                        .filter((c) => c !== p.proposingCountryId)}
                    />
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
