"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";
import type { ConflictOption } from "@/lib/military/dto/conflictOption";
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
 * Entry into a conflict at the bloc's call: members vote a `join_conflict`
 * resolution, and passing it puts a bill before BOTH chambers of every
 * player-enabled member's legislature at once.
 *
 * Rendered only for a category that may table it — which in a Cold War world is
 * the two blocs and nothing else. The gate reads the org's EFFECTIVE category,
 * the same value `proposeLegislation` checks, so this surface can never offer a
 * resolution the write path would refuse.
 */
export function JoinConflictPanel({
  org,
  viewer,
  currentTurn,
  votingWindowTurns,
  onChange,
}: Props) {
  const canTable = canTableResolutionType(org.def.category, "join_conflict");
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);

  const pending = org.pendingLegislation.filter((l) => l.type === "join_conflict");

  const [showForm, setShowForm] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictOption[]>([]);
  const [theaterId, setTheaterId] = useState("");
  const [side, setSide] = useState<"A" | "B">("A");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded only when the form opens: two organisations in the world can table
  // this, so the world view is not taxed with a conflict roster nobody else reads.
  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/world/conflicts");
        if (!res.ok) return;
        const body = (await res.json()) as { conflicts?: ConflictOption[] };
        if (cancelled) return;
        const rows = body.conflicts ?? [];
        setConflicts(rows);
        setTheaterId((current) => current || (rows[0]?.id ?? ""));
      } catch {
        // Leaving the list empty is the honest failure: the submit below stays
        // disabled rather than posting a theater id nobody picked.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm]);

  if (!canTable) return null;

  const selected = conflicts.find((c) => c.id === theaterId) ?? null;

  async function submit() {
    if (!viewerFmCountry || !theaterId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/legislation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "join_conflict", theaterId, side }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose entry");
      }
      setShowForm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose entry");
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
          <h3 className="text-lg font-semibold text-foreground">Entry into a conflict</h3>
          <p className="text-xs text-muted">
            Call the bloc into a war already being fought. Entry needs unanimous consent from every
            member that holds a vote. If they carry it, every player-enabled member puts the
            question to both chambers of its own legislature at once, and each one decides for
            itself.
          </p>
          <p className="mt-1 text-xs text-muted">
            Defence of a member is not voted on. If a member is attacked, every player-led member of
            this alliance enters that war at once. Leaving the alliance beforehand is the only way
            to stay out of it, and leaving after a war has begun does not take you out of that war.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Propose entry"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Propose entry into a conflict</h4>
          {conflicts.length === 0 ? (
            <p className="mt-3 text-xs text-muted">No conflicts are being fought right now.</p>
          ) : (
            <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted" htmlFor="join-conflict-theater">
                  Conflict
                </label>
                <select
                  id="join-conflict-theater"
                  value={theaterId}
                  onChange={(e) => setTheaterId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  {conflicts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted" htmlFor="join-conflict-side">
                  Side
                </label>
                <select
                  id="join-conflict-side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as "A" | "B")}
                  className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="A">{selected?.sideALabel ?? "Side A"}</option>
                  <option value="B">{selected?.sideBLabel ?? "Side B"}</option>
                </select>
              </div>
            </div>
          )}
          {selected && (
            <p className="mt-2 text-xs text-muted">
              {selected.name}: {selected.sideALabel} against {selected.sideBLabel}.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              isLoading={submitting}
              disabled={!theaterId}
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
          Pending entry votes
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-sm text-muted">No pending entry resolutions.</p>
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
            return (
              <article
                key={l._id.toString()}
                className="rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">{l.title}</h5>
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
                      {yesCount} / {ballotSize} members in favour, unanimous consent required
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
