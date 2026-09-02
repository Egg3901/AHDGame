"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { MAX_ORG_DUES_RATE_ANNUAL } from "@/lib/constants/internationalOrganizations";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { VoteButtons } from "../VoteButtons";
import { VoteRoster } from "../VoteRoster";
import { formatFundAmount } from "./fundCurrency";
import { useFundFormatter } from "./useFundFormatter";
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

const MAX_DUES_PCT = MAX_ORG_DUES_RATE_ANNUAL * 100;

/**
 * Org treasury & dues: shows the pooled fund balance + current dues rate, and
 * lets members table + vote a `set_dues` resolution (simple majority) to change
 * the annual assessment that capitalizes the fund each turn.
 */
export function DuesPanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  // Tabling only needs membership, but voting needs a ballot: the route enforces
  // isVotingMember, so an enabled button for a silent member promises a vote the
  // server will refuse.
  const viewerHoldsVote =
    viewerFmCountry != null &&
    org.members.some((m) => m.countryId === viewerFmCountry && m.hasPolicyVote);

  const pending = org.pendingLegislation.filter((l) => l.type === "set_dues");

  const [showForm, setShowForm] = useState(false);
  const [pct, setPct] = useState<string>((org.fund.duesRateAnnual * 100).toString());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!viewerFmCountry) return;
    const pctNum = Number(pct);
    if (!(pctNum >= 0) || pctNum > MAX_DUES_PCT) {
      setError(`Enter a rate between 0 and ${MAX_DUES_PCT}%.`);
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
          body: JSON.stringify({ type: "set_dues", duesRateAnnual: pctNum / 100 }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose dues change");
      }
      setShowForm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose dues change");
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

  // Balance native, assessment converted: one is the account, the other is a
  // figure you are only reading.
  const fundAmount = useFundFormatter(org.fund);
  const fundDisplay = formatFundAmount(org.fund.balanceLocal, org.fund.currencyCode);
  const ratePct = `${(org.fund.duesRateAnnual * 100).toFixed(3)}%`;
  const annualDuesDisplay = fundAmount(org.fund.annualDuesLocal ?? 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Treasury &amp; dues</h3>
          <p className="text-xs text-muted">
            Members are assessed <span className="font-semibold text-foreground">{ratePct}</span> of
            GDP / year (about{" "}
            <span className="font-semibold text-foreground">{annualDuesDisplay}/yr</span> across its
            VOTING members — the rest pay tribute at a fixed rate they do not set) into the pooled
            fund (currently <span className="font-semibold text-foreground">{fundDisplay}</span>).
            Changing the rate needs a majority of the members that hold a vote.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Propose dues change"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Propose a dues rate</h4>
          <div className="mt-3 max-w-xs">
            <label className="text-xs font-medium text-muted" htmlFor="dues-rate">
              Annual dues (% of member GDP)
            </label>
            <input
              id="dues-rate"
              type="number"
              min={0}
              max={MAX_DUES_PCT}
              step={0.001}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">Max {MAX_DUES_PCT}% / year.</p>
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

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Pending dues votes
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No pending dues changes.</p>
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
                    <h5 className="text-sm font-semibold text-foreground">{l.title}</h5>
                    <p className="mt-0.5 text-xs text-muted">
                      Proposed: {((l.duesRateAnnual ?? 0) * 100).toFixed(3)}% of GDP / year · tabled
                      by {l.proposedByCharacterName} · closes in {turnsLeft} turn
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
