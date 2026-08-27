"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import { DIRECTIVE_CATALOG, getDirectiveDef } from "@/lib/constants/orgDirectives";
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
 * Directives: a bloc-wide standing policy that nudges one curated metric across
 * every member while active. The proposer picks from a fixed catalog (the effect
 * magnitude is server-controlled); members decide by simple majority. Shown only
 * for categories that may table directives (economic).
 */
export function DirectivePanel({ org, viewer, currentTurn, votingWindowTurns, onChange }: Props) {
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);
  const canTable = canTableResolutionType(org.def.category, "directive");

  const pending = org.pendingLegislation.filter((l) => l.type === "directive");
  const active = org.activeLegislation.filter((l) => l.type === "directive");

  const [showForm, setShowForm] = useState(false);
  const [directiveKey, setDirectiveKey] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDef = getDirectiveDef(directiveKey);

  async function submit() {
    if (!viewerFmCountry || !directiveKey) {
      setError("Choose a directive.");
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
          body: JSON.stringify({ type: "directive", directiveKey }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to table directive");
      }
      setShowForm(false);
      setDirectiveKey("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to table directive");
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
          <h3 className="text-lg font-semibold text-foreground">Directives</h3>
          <p className="text-xs text-muted">
            A bloc-wide policy that shifts one metric across every member while in force. Passes by
            a majority of the members that hold a vote.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && canTable && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Table directive"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && canTable && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Table a directive</h4>
          <div className="mt-3 max-w-md">
            <label className="text-xs font-medium text-muted" htmlFor="directive-key">
              Directive
            </label>
            <select
              id="directive-key"
              value={directiveKey}
              onChange={(e) => setDirectiveKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Select…</option>
              {DIRECTIVE_CATALOG.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            {selectedDef && <p className="mt-2 text-xs text-muted">{selectedDef.blurb}</p>}
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
            const def = getDirectiveDef(l.directiveKey);
            const turnsLeft =
              l.directiveExpiresOnTurn != null
                ? Math.max(0, l.directiveExpiresOnTurn - currentTurn)
                : null;
            return (
              <div
                key={l._id.toString()}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/5 p-5"
              >
                <div>
                  <h5 className="text-sm font-semibold text-foreground">{def?.label ?? l.title}</h5>
                  <p className="mt-1 text-xs text-muted">
                    {def?.blurb ?? "Active bloc directive."}
                    {turnsLeft != null && (
                      <>
                        {" "}
                        · Lifts in {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                </div>
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
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
            <p className="text-sm text-muted">No pending directives.</p>
          </div>
        ) : (
          pending.map((l) => {
            const def = getDirectiveDef(l.directiveKey);
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
                      {def?.blurb ?? ""} · tabled by {l.proposedByCharacterName} · closes in{" "}
                      {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
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
