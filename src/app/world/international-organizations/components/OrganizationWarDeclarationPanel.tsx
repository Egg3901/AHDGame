"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { useEnabledCountryIds } from "@/lib/hooks/useEnabledCountryIds";
import { WAR_GOALS } from "@/lib/military/warGoals";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import {
  dedupeOrganizationVotes,
  requiresUnanimity,
  votesNeeded,
} from "@/lib/internationalOrganizations/resolutionRules";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { VoteButtons } from "../VoteButtons";
import { VoteRoster } from "../VoteRoster";

interface Props {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  currentTurn: number;
  votingWindowTurns: number;
  onChange: () => void;
}

export function OrganizationWarDeclarationPanel({
  org,
  viewer,
  currentTurn,
  votingWindowTurns,
  onChange,
}: Props) {
  const resolveCountryName = useCountryDisplayName();
  const viewerCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerCountry != null && org.members.some((member) => member.countryId === viewerCountry);
  const viewerHoldsVote =
    viewerCountry != null &&
    org.members.some((member) => member.countryId === viewerCountry && member.hasVote);
  const memberIds = new Set(org.members.map((member) => member.countryId));
  const targets = useEnabledCountryIds().filter((countryId) => !memberIds.has(countryId));
  const pending = org.pendingLegislation.filter((item) => item.type === "declare_war");

  const [showForm, setShowForm] = useState(false);
  const [targetCountryId, setTargetCountryId] = useState("");
  const [warGoal, setWarGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!viewerCountry || !targetCountryId || !warGoal) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/country/${viewerCountry}/international-organizations/${org.id}/legislation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "declare_war", targetCountryId, warGoal }),
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to propose a declaration of war");
      }
      setShowForm(false);
      onChange();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Failed to propose a declaration of war"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(legislationId: string, voteValue: ProposalVote) {
    if (!viewerCountry) throw new Error("No diplomatic role");
    const response = await fetch(
      `/api/country/${viewerCountry}/international-organizations/legislation/${legislationId}/vote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote: voteValue }),
      }
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Vote failed");
    }
    onChange();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Collective declaration of war</h3>
          <p className="text-xs text-muted">
            Every player nation in the bloc must consent. If the resolution passes, NPP nations join
            automatically. Each eligible player nation then votes on its own declaration in every
            voting chamber at the same time. A failed national declaration keeps only that country
            out of the war.
          </p>
        </div>
        {viewerIsMember && viewerCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((visible) => !visible)}
          >
            {showForm ? "Cancel" : "Propose declaration"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Propose a collective war</h4>
          <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted" htmlFor="org-war-target">
                Target country
              </label>
              <select
                id="org-war-target"
                value={targetCountryId}
                onChange={(event) => setTargetCountryId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">Select a country</option>
                {targets.map((countryId) => (
                  <option key={countryId} value={countryId}>
                    {resolveCountryName(countryId)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted" htmlFor="org-war-goal">
                War goal
              </label>
              <select
                id="org-war-goal"
                value={warGoal}
                onChange={(event) => setWarGoal(event.target.value)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">Select a war goal</option>
                {WAR_GOALS.map((goal) => (
                  <option key={goal.id} value={goal.id} disabled={!goal.selectable}>
                    {goal.label}
                    {goal.selectable ? "" : " (not yet available)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              isLoading={submitting}
              disabled={!targetCountryId || !warGoal}
            >
              Submit for a vote
            </Button>
            <Button variant="ghost" size="md" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Pending declarations
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No declaration resolutions are pending.</p>
          </div>
        ) : (
          pending.map((item) => {
            const turnsLeft = Math.max(0, item.closesOnTurn - currentTurn);
            const expectedVoters = org.members
              .filter((member) => member.hasVote)
              .map((member) => member.countryId);
            const votes = dedupeOrganizationVotes(item.votes);
            const yesCount = votes.filter(
              (cast) => cast.vote === "yes" && expectedVoters.includes(cast.countryId)
            ).length;
            const needed = votesNeeded(item.type, expectedVoters.length);
            const progress = needed > 0 ? (yesCount / needed) * 100 : 0;
            const myVote = viewerCountry
              ? (votes.find((cast) => cast.countryId === viewerCountry)?.vote ?? null)
              : null;
            const requirement =
              expectedVoters.length === 0
                ? "no player nations hold a vote"
                : requiresUnanimity(item.type)
                  ? "unanimous player consent required"
                  : `${needed} needed`;
            return (
              <article
                key={item._id.toString()}
                className="rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">{item.title}</h5>
                    <p className="mt-0.5 text-xs text-muted">
                      Tabled by {item.proposedByCharacterName} · closes in {turnsLeft} turn
                      {turnsLeft === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    Voting
                  </span>
                </div>
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>
                      {yesCount} / {expectedVoters.length} player nations in favour, {requirement}
                    </span>
                    <span className="tabular-nums">
                      {votingWindowTurns - turnsLeft}/{votingWindowTurns} turns
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                </div>
                <VoteButtons
                  onVote={(value) => vote(item._id.toString(), value)}
                  disabled={!viewerHoldsVote}
                  disabledReason={
                    !viewerHoldsVote
                      ? !viewerIsMember
                        ? "Only foreign ministers of member states may vote."
                        : "Your country holds no vote in this organization."
                      : undefined
                  }
                  currentVote={myVote}
                />
                <VoteRoster votes={item.votes} expectedVoters={expectedVoters} />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
