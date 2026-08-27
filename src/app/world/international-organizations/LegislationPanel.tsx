"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { postBillProposalWithElectionConfirmation } from "@/components/bills/BillAutoFailWarning";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary, OrgViewerInfo } from "./orgTypes";
import { VoteButtons } from "./VoteButtons";
import { VoteRoster } from "./VoteRoster";
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

/**
 * Free-trade agreements: lists active and pending FTA legislation, plus a
 * propose form visible to member foreign ministers.
 */
export function LegislationPanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  // This panel handles free-trade agreements only; other resolution types
  // (e.g. sanctions) render in their own panels.
  const activeFtas = org.activeLegislation.filter((l) => l.type === "free_trade_agreement");
  const pendingFtas = org.pendingLegislation.filter((l) => l.type === "free_trade_agreement");
  const pendingWithdrawalLegislationIds = new Set(
    org.pendingWithdrawalMeasures
      .filter(
        (measure) =>
          measure.targetType === "leave_free_trade_agreement" &&
          measure.targetCountryId === viewerFmCountry &&
          measure.organizationLegislationId
      )
      .map((measure) => measure.organizationLegislationId!.toString())
  );

  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingLegislationId, setWithdrawingLegislationId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [pendingWithdrawalIdsLocal, setPendingWithdrawalIdsLocal] = useState<Set<string>>(
    () => new Set()
  );

  function toggle(country: string) {
    const next = new Set(selected);
    if (next.has(country)) next.delete(country);
    else next.add(country);
    setSelected(next);
  }

  async function submit() {
    if (!viewerFmCountry) return;
    const partySet = new Set<string>(selected);
    partySet.add(viewerFmCountry);
    const parties = Array.from(partySet);
    if (parties.length < 2) {
      setError("Pick at least one other party.");
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
          body: JSON.stringify({ type: "free_trade_agreement", parties }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose FTA");
      }
      setSelected(new Set());
      setShowForm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose FTA");
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

  async function proposeWithdrawal(legislationId: string, legislationTitle: string) {
    if (!viewerFmCountry) return;
    setWithdrawingLegislationId(legislationId);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const {
        response: res,
        data,
        cancelled,
      } = await postBillProposalWithElectionConfirmation({
        url: `/api/country/${viewerFmCountry}/international-organizations/${org.id}/propose-leave`,
        body: {
          targetType: "free_trade_agreement",
          legislationId,
        },
      });
      if (cancelled) return;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to propose withdrawal"
        );
      }
      setWithdrawSuccess(
        `${COUNTRY_CONFIGS[viewerFmCountry].name}'s withdrawal from ${legislationTitle} was sent to the legislature.`
      );
      setPendingWithdrawalIdsLocal((prev) => new Set(prev).add(legislationId));
      onChange();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to propose withdrawal");
    } finally {
      setWithdrawingLegislationId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Free-Trade Agreements</h3>
          <p className="text-xs text-muted">
            Active FTAs zero out tariffs between every party in the agreement.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Propose new FTA"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Propose a free-trade agreement</h4>
          <p className="mt-1 text-xs text-muted">
            {COUNTRY_CONFIGS[viewerFmCountry].name} is automatically included. Select the other
            parties (must all be {org.def.shortName} members).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {org.members
              .filter((m) => m.countryId !== viewerFmCountry)
              .map((m) => {
                const active = selected.has(m.countryId);
                return (
                  <button
                    key={m.countryId}
                    type="button"
                    onClick={() => toggle(m.countryId)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-card-border bg-card text-muted hover:text-foreground"
                    }`}
                  >
                    <CountryFlag country={m.countryId} size="sm" className="mr-1.5" />
                    {m.countryName}
                  </button>
                );
              })}
          </div>
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="md" onClick={submit} isLoading={submitting}>
              Submit for ratification
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setShowForm(false);
                setSelected(new Set());
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Active FTAs */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">Active</h4>
        {withdrawSuccess && (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success">
            {withdrawSuccess}
          </div>
        )}
        {withdrawError && (
          <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
            {withdrawError}
          </div>
        )}
        {activeFtas.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No active free-trade agreements.</p>
          </div>
        ) : (
          activeFtas.map((l) => (
            <div
              key={l._id.toString()}
              className="rounded-xl border border-success/30 bg-success/5 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-foreground">{l.title}</h5>
                  <p className="mt-1 text-xs text-muted">
                    Parties:{" "}
                    {(l.parties as CountryId[])
                      .map((p) => COUNTRY_CONFIGS[p]?.name ?? p)
                      .join(", ")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    In force
                  </span>
                  {viewerFmCountry != null &&
                    viewerIsMember &&
                    (l.parties as CountryId[]).includes(viewerFmCountry) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          pendingWithdrawalLegislationIds.has(l._id.toString()) ||
                          pendingWithdrawalIdsLocal.has(l._id.toString())
                        }
                        isLoading={withdrawingLegislationId === l._id.toString()}
                        onClick={() => proposeWithdrawal(l._id.toString(), l.title)}
                      >
                        {pendingWithdrawalLegislationIds.has(l._id.toString()) ||
                        pendingWithdrawalIdsLocal.has(l._id.toString())
                          ? "Withdrawal pending"
                          : "Propose withdrawal"}
                      </Button>
                    )}
                  {(pendingWithdrawalLegislationIds.has(l._id.toString()) ||
                    pendingWithdrawalIdsLocal.has(l._id.toString())) && (
                    <p className="max-w-xs text-right text-xs text-muted">
                      A withdrawal measure for this agreement is already pending in the legislature.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pending FTAs */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Awaiting ratification
        </h4>
        {pendingFtas.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No pending legislation.</p>
          </div>
        ) : (
          pendingFtas.map((l) => {
            const parties = l.parties as CountryId[];
            // A ratified agreement binds every party, but only parties that can
            // vote decide it — the resolver narrows the ballot the same way, so
            // the roster must not await a vote that will never be cast.
            const votingParties = parties.filter((p) =>
              org.members.some((m) => m.countryId === p && m.hasVote)
            );
            const votes = dedupeOrganizationVotes(l.votes);
            const partyVotes = votes.filter((v) =>
              votingParties.includes(v.countryId as CountryId)
            );
            const turnsLeft = Math.max(0, l.closesOnTurn - currentTurn);
            const yesCount = partyVotes.filter((v) => v.vote === "yes").length;
            const myVote =
              viewerFmCountry != null
                ? (votes.find((v) => v.countryId === viewerFmCountry)?.vote ?? null)
                : null;
            // A party that has since withdrawn, or lost player-enablement, is
            // refused by the route and dropped by the resolver alike.
            const viewerIsParty =
              viewerFmCountry != null &&
              parties.includes(viewerFmCountry) &&
              votingParties.includes(viewerFmCountry);
            const needed = votesNeeded("free_trade_agreement", votingParties.length);
            const progress = needed > 0 ? (yesCount / needed) * 100 : 0;
            const requirement =
              votingParties.length === 0
                ? "no parties hold a vote"
                : requiresUnanimity("free_trade_agreement")
                  ? "unanimous required"
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
                      Parties:{" "}
                      {(l.parties as CountryId[])
                        .map((p) => COUNTRY_CONFIGS[p]?.name ?? p)
                        .join(", ")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Introduced by {l.proposedByCharacterName} · closes in {turnsLeft} turn
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
                      {yesCount} / {votingParties.length} parties yes, {requirement}
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
                  onVote={(v) => vote(l._id.toString(), v)}
                  disabled={!viewerIsParty}
                  disabledReason={
                    !viewerIsParty ? "Only foreign ministers of named parties may vote." : undefined
                  }
                  currentVote={myVote}
                />

                <VoteRoster votes={l.votes} expectedVoters={votingParties} />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
