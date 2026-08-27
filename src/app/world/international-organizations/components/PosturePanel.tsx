"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ALERT_POSTURES, POSTURE_META, type AlertPosture } from "@/lib/constants/orgPosture";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { VoteButtons } from "../VoteButtons";
import { VoteRoster } from "../VoteRoster";
import { votesNeeded } from "@/lib/internationalOrganizations/resolutionRules";

interface Props {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  currentTurn: number;
  votingWindowTurns: number;
  onChange: () => void;
}

/**
 * Alliance alert posture: members vote (a `set_posture` resolution) to move the
 * bloc between Reduced / Standard / Heightened / Article 5, each a bounded
 * benefit-with-a-cost effect applied to every member while in force. Shown only
 * for categories that may set posture (security).
 */
export function PosturePanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);

  const pending = org.pendingLegislation.filter((l) => l.type === "set_posture");
  const current = org.posture;

  const [showForm, setShowForm] = useState(false);
  const [posture, setPosture] = useState<AlertPosture>(current);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!viewerFmCountry) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/legislation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "set_posture", posture }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose posture change");
      }
      setShowForm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose posture change");
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
          <h3 className="text-lg font-semibold text-foreground">Alert posture</h3>
          <p className="text-xs text-muted">
            The alliance is at{" "}
            <span className="font-semibold text-foreground">{POSTURE_META[current].label}</span>{" "}
            posture. {POSTURE_META[current].blurb} Changing it needs a majority of the members that
            hold a vote.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Propose posture change"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Propose an alert posture</h4>
          <div className="mt-3 max-w-md">
            <label className="text-xs font-medium text-muted" htmlFor="posture-select">
              Posture
            </label>
            <select
              id="posture-select"
              value={posture}
              onChange={(e) => setPosture(e.target.value as AlertPosture)}
              className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {ALERT_POSTURES.map((p) => (
                <option key={p} value={p}>
                  {POSTURE_META[p].label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">{POSTURE_META[posture].blurb}</p>
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
          Pending posture votes
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No pending posture changes.</p>
          </div>
        ) : (
          pending.map((l) => {
            const turnsLeft = Math.max(0, l.closesOnTurn - currentTurn);
            const ballotSize = org.members.filter((m) => m.hasVote).length;
            const yesCount = l.votes.filter(
              (v) =>
                v.vote === "yes" &&
                org.members.some((m) => m.countryId === v.countryId && m.hasVote)
            ).length;
            const myVote =
              viewerFmCountry != null
                ? (l.votes.find((v) => v.countryId === viewerFmCountry)?.vote ?? null)
                : null;
            const needed = votesNeeded(l.type, ballotSize);
            const progress = needed > 0 ? (yesCount / needed) * 100 : 0;
            const target = l.postureValue ? POSTURE_META[l.postureValue].label : "—";
            return (
              <article
                key={l._id.toString()}
                className="rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">Move to {target}</h5>
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
                      {yesCount} / {ballotSize} members in favour, {needed} needed
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
                  disabled={!viewerIsMember}
                  disabledReason={
                    !viewerIsMember
                      ? "Only foreign ministers of member states may vote."
                      : undefined
                  }
                  currentVote={myVote}
                />
                <VoteRoster
                  votes={l.votes}
                  expectedVoters={org.members.filter((m) => m.hasVote).map((m) => m.countryId)}
                />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
