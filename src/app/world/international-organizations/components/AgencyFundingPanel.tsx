"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import { AGENCY_CATALOG, getAgencyDef } from "@/lib/constants/orgAgencies";
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

/**
 * Agency funding: members vote (a `fund_agency` resolution) to stand up a global
 * programme; on passage a fixed cost is drawn from the pooled fund and the
 * programme applies a bounded member-wide metric benefit for a while. Shown only
 * for categories that may fund agencies (political).
 */
export function AgencyFundingPanel({
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
  const canTable = canTableResolutionType(org.def.category, "fund_agency");

  const pending = org.pendingLegislation.filter((l) => l.type === "fund_agency");
  const active = org.activeLegislation.filter((l) => l.type === "fund_agency");

  const [showForm, setShowForm] = useState(false);
  const [agencyKey, setAgencyKey] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDef = getAgencyDef(agencyKey);
  // The BALANCE stays in the fund's own currency — it is an account, not a view
  // of the viewer's wallet.
  const fundDisplay = formatFundAmount(org.fund.balanceLocal, org.fund.currencyCode);
  // Catalog costs are USD. Converting them into fund units and back out through
  // the viewer's preference keeps one rate in play: the era-resolved
  // server-side one (refs #3778), never a client read of COUNTRY_CONFIGS, which
  // priced 1953 agency costs off modern rates.
  const fundAmount = useFundFormatter(org.fund);
  const fundRate =
    org.fund.usdToFundRate && org.fund.usdToFundRate > 0 ? org.fund.usdToFundRate : 1;
  const costInFund = (costUsd: number) => fundAmount(costUsd / fundRate);

  async function submit() {
    if (!viewerFmCountry || !agencyKey) {
      setError("Choose an agency.");
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
          body: JSON.stringify({ type: "fund_agency", agencyKey }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose agency funding");
      }
      setShowForm(false);
      setAgencyKey("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose agency funding");
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Agency funding</h3>
          <p className="text-xs text-muted">
            Fund a global programme from the pooled treasury (currently{" "}
            <span className="font-semibold text-foreground">{fundDisplay}</span>); each lifts a
            metric across every member while funded. Passes by a majority of the members that hold a
            vote.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && canTable && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Fund an agency"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && canTable && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Fund an agency</h4>
          <div className="mt-3 max-w-md">
            <label className="text-xs font-medium text-muted" htmlFor="agency-key">
              Agency
            </label>
            <select
              id="agency-key"
              value={agencyKey}
              onChange={(e) => setAgencyKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Select…</option>
              {AGENCY_CATALOG.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label} ({costInFund(a.costUsd)})
                </option>
              ))}
            </select>
            {selectedDef && (
              <p className="mt-2 text-xs text-muted">
                {selectedDef.blurb} Costs {costInFund(selectedDef.costUsd)} from the fund.
              </p>
            )}
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

      {/* Funded */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted">Funded</h4>
          {active.map((l) => {
            const def = getAgencyDef(l.agencyKey);
            const turnsLeft =
              l.agencyExpiresOnTurn != null
                ? Math.max(0, l.agencyExpiresOnTurn - currentTurn)
                : null;
            return (
              <div
                key={l._id.toString()}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/5 p-5"
              >
                <div>
                  <h5 className="text-sm font-semibold text-foreground">{def?.label ?? l.title}</h5>
                  <p className="mt-1 text-xs text-muted">
                    {def?.blurb ?? "Active programme."}
                    {turnsLeft != null && (
                      <>
                        {" "}
                        · Lapses in {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                </div>
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  Funded
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
            <p className="text-sm text-muted">No pending agency funding.</p>
          </div>
        ) : (
          pending.map((l) => {
            const def = getAgencyDef(l.agencyKey);
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
                      {def?.label ?? l.title}
                    </h5>
                    <p className="mt-0.5 text-xs text-muted">
                      {def ? `${costInFund(def.costUsd)} from the fund · ` : ""}tabled by{" "}
                      {l.proposedByCharacterName} · closes in {turnsLeft} turn
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
