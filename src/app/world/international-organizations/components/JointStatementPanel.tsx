"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { VoteButtons } from "../VoteButtons";
import { VoteRoster } from "../VoteRoster";
import {
  dedupeOrganizationVotes,
  requiresUnanimity,
  votesNeeded,
} from "@/lib/internationalOrganizations/resolutionRules";

interface Props {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  currentTurn: number;
  votingWindowTurns: number;
  onChange: () => void;
}

type Stance = "endorse" | "condemn";

/**
 * Joint statements: a member-voted declaration the bloc issues about a subject
 * country — an endorsement (lifts that government's approval) or a condemnation
 * (hurts it), for a bounded window. Decided by a simple majority of members.
 * Shown only for categories that may table statements (political / security).
 */
export function JointStatementPanel({
  org,
  viewer,
  currentTurn,
  votingWindowTurns,
  onChange,
}: Props) {
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  // Tabling only needs membership, but voting needs a ballot: the route enforces
  // isVotingMember, so an enabled button for a silent member promises a vote the
  // server will refuse.
  const viewerHoldsVote =
    viewerFmCountry != null &&
    org.members.some((m) => m.countryId === viewerFmCountry && m.hasPolicyVote);
  const canTable = canTableResolutionType(org.def.category, "joint_statement");

  const pending = org.pendingLegislation.filter((l) => l.type === "joint_statement");
  const active = org.activeLegislation.filter((l) => l.type === "joint_statement");

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState<CountryId | "">("");
  const [stance, setStance] = useState<Stance>("endorse");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!viewerFmCountry || !subject) {
      setError("Choose a subject country.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/legislation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "joint_statement", subjectCountryId: subject, stance }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to table statement");
      }
      setShowForm(false);
      setSubject("");
      setStance("endorse");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to table statement");
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(legislationId: string, voteValue: ProposalVote) {
    if (!viewerFmCountry) throw new Error("No diplomatic role");
    const res = await fetch(
      `/api/country/${viewerFmCountry}/international-organizations/legislation/${legislationId}/vote`,
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

  const name = (c?: CountryId) => (c ? (COUNTRY_CONFIGS[c]?.name ?? c) : "—");
  const stanceLabel = (s?: string) => (s === "condemn" ? "Condemnation" : "Endorsement");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Joint statements</h3>
          <p className="text-xs text-muted">
            A bloc declaration about a country. An endorsement lifts that government&apos;s
            approval, a condemnation hurts it, for a limited time. Passes by a majority of the
            members that hold a vote.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && canTable && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Table statement"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && canTable && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Table a joint statement</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted" htmlFor="statement-subject">
                Subject country
              </label>
              <select
                id="statement-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value as CountryId)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">Select…</option>
                {COUNTRY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_CONFIGS[c].name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted" htmlFor="statement-stance">
                Stance
              </label>
              <select
                id="statement-stance"
                value={stance}
                onChange={(e) => setStance(e.target.value as Stance)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="endorse">Endorse (+ approval)</option>
                <option value="condemn">Condemn (− approval)</option>
              </select>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="md" onClick={submit} isLoading={submitting}>
              Submit for a vote
            </Button>
            <Button variant="ghost" size="md" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* In force */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">In force</h4>
          {active.map((l) => {
            const turnsLeft =
              l.jointStatementExpiresOnTurn != null
                ? Math.max(0, l.jointStatementExpiresOnTurn - currentTurn)
                : null;
            const condemn = l.jointStatementStance === "condemn";
            return (
              <div
                key={l._id.toString()}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-5 ${
                  condemn ? "border-error/30 bg-error/5" : "border-success/30 bg-success/5"
                }`}
              >
                <div>
                  <h5 className="text-sm font-semibold text-foreground">
                    {stanceLabel(l.jointStatementStance)} of{" "}
                    {name(l.jointStatementSubjectCountryId)}
                  </h5>
                  <p className="mt-1 text-xs text-muted">
                    {condemn
                      ? "Lowers the subject government's approval"
                      : "Raises the subject government's approval"}
                    {turnsLeft != null && (
                      <>
                        {" "}
                        · Lifts in {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    condemn
                      ? "border-error/30 bg-error/10 text-error"
                      : "border-success/30 bg-success/10 text-success"
                  }`}
                >
                  In force
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Awaiting a vote
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No pending statements.</p>
          </div>
        ) : (
          pending.map((l) => {
            const turnsLeft = Math.max(0, l.closesOnTurn - currentTurn);
            const ballotSize = org.members.filter((m) => m.hasPolicyVote).length;
            // Fold duplicate rows first: the resolver tallies the folded ballot,
            // so anything counted here must be counted the same way.
            const votes = dedupeOrganizationVotes(l.votes);
            const yesCount = votes.filter(
              (v) =>
                v.vote === "yes" &&
                org.members.some((m) => m.countryId === v.countryId && m.hasPolicyVote)
            ).length;
            const myVote =
              viewerFmCountry != null
                ? (votes.find((v) => v.countryId === viewerFmCountry)?.vote ?? null)
                : null;
            const needed = votesNeeded(l.type, ballotSize);
            const progress = needed > 0 ? (yesCount / needed) * 100 : 0;
            // Derived, never hardcoded: an org with nobody eligible cannot carry
            // anything, and the wording must follow whatever the rule says today.
            const requirement =
              ballotSize === 0
                ? "no members hold a vote"
                : requiresUnanimity(l.type)
                  ? "unanimous consent required"
                  : `${needed} needed`;
            return (
              <article
                key={l._id.toString()}
                className="rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">
                      {stanceLabel(l.jointStatementStance)} of{" "}
                      {name(l.jointStatementSubjectCountryId)}
                    </h5>
                    <p className="mt-0.5 text-xs text-muted">
                      Tabled by {l.proposedByCharacterName} · closes in {turnsLeft} turn
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
                      {yesCount} / {ballotSize} members in favour, {requirement}
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
                  onVote={(v) => vote(l._id.toString(), v)}
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
                <VoteRoster
                  votes={l.votes}
                  expectedVoters={org.members
                    .filter((m) => m.hasPolicyVote)
                    .map((m) => m.countryId)}
                />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
