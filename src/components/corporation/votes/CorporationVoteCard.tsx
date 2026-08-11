"use client";

import { useState, useEffect, useCallback } from "react";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { LEGAL_STRUCTURES } from "@/lib/constants/legalStructures";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

interface VotingIdentity {
  kind: "character" | "corporation";
  id: string;
  name: string;
  sequentialId?: number;
  votingPower: number;
  shares: number;
  hasVoted?: boolean;
}

interface Props {
  corporationId: string;
  voteId: string;
  isCeo: boolean;
  viewerCharacterId?: string;
  viewerShares: number;
  totalShares: number;
  /** Viewer's vote weight incl. supershare multiplier. Defaults to viewerShares. */
  viewerVotingPower?: number;
  /** Total eligible vote weight incl. supershare bonus. Defaults to totalShares. */
  totalVotingPower?: number;
  currentTurn: number;
  onResolved?: () => void;
}

function proposalSummary(vote: CorporationVote): string {
  switch (vote.type) {
    case "governance_change": {
      const s = LEGAL_STRUCTURES.find((x) => x.id === vote.payload.newLegalStructure);
      return `Restructure to ${s?.name ?? vote.payload.newLegalStructure}`;
    }
    case "dissolution":
      return "Dissolve the corporation";
    case "relocation": {
      const cfg = vote.payload.destinationCountryId
        ? COUNTRY_CONFIGS[vote.payload.destinationCountryId as keyof typeof COUNTRY_CONFIGS]
        : null;
      return `Relocate HQ to ${cfg?.name ?? vote.payload.destinationCountryId}`;
    }
    case "share_issuance":
      return `Issue ${vote.payload.newShareCount?.toLocaleString("en-US") ?? "?"} new shares`;
    case "adopt_supershares":
      return `Adopt dual-class supershares (founder votes count ${vote.payload.superShareMultiplier ?? "?"}× each)`;
    case "ticker_change":
      return `Change stock ticker to ${vote.payload.newTicker ?? "?"}`;
  }
}

function typeLabel(type: CorporationVote["type"]): string {
  switch (type) {
    case "governance_change":
      return "Restructuring Vote";
    case "dissolution":
      return "Dissolution Vote";
    case "relocation":
      return "Relocation Vote";
    case "share_issuance":
      return "Share Issuance Vote";
    case "adopt_supershares":
      return "Supershare Vote";
    case "ticker_change":
      return "Ticker Change Vote";
  }
}

export function CorporationVoteCard({
  corporationId,
  voteId,
  isCeo,
  viewerCharacterId,
  viewerShares,
  totalShares,
  viewerVotingPower,
  totalVotingPower,
  currentTurn,
  onResolved,
}: Props) {
  const [vote, setVote] = useState<CorporationVote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [identities, setIdentities] = useState<VotingIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("");
  const [, setIdentitiesLoading] = useState(false);

  const fetchVote = useCallback(async () => {
    const res = await fetch(`/api/corporations/${corporationId}/votes/${voteId}`);
    if (!res.ok) return;
    const data: CorporationVote = await res.json();
    setVote(data);
    if (data.status === "failed" || data.status === "cancelled") onResolved?.();
  }, [corporationId, voteId, onResolved]);

  // Fetch voting identities (character + managed corporations that hold shares)
  const fetchIdentities = useCallback(async () => {
    setIdentitiesLoading(true);
    try {
      const res = await fetch(
        `/api/corporations/${corporationId}/my-voting-identities?voteId=${voteId}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: VotingIdentity[] = data.identities ?? [];
      setIdentities(list);
      // Auto-select the first non-voted identity, or the first identity
      const firstUnvoted = list.find((i) => !i.hasVoted);
      if (firstUnvoted) {
        setSelectedIdentityId(firstUnvoted.id);
      } else if (list.length > 0) {
        setSelectedIdentityId(list[0].id);
      }
    } catch {
      // identities are optional — voting still works without them
    } finally {
      setIdentitiesLoading(false);
    }
  }, [corporationId, voteId]);

  useEffect(() => {
    fetchVote();
    fetchIdentities();
  }, [fetchVote, fetchIdentities]);

  async function castVote(choice: "yes" | "no") {
    setLoading(true);
    setError("");
    try {
      const selected = identities.find((i) => i.id === selectedIdentityId);
      const body: Record<string, unknown> = { vote: choice };
      if (selected && selected.kind === "corporation") {
        body.voterCorporationId = selected.id;
      }
      const res = await fetch(`/api/corporations/${corporationId}/votes/${voteId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchVote();
      await fetchIdentities(); // Refresh hasVoted flags
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function cancelVote() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/votes/${voteId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchVote();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (!vote) return <div className="h-36 animate-pulse rounded-lg bg-muted" />;

  const eligibleVotes = totalVotingPower ?? totalShares;
  const myVotingPower = viewerVotingPower ?? viewerShares;
  const yesShares = vote.votes
    .filter((v) => v.vote === "yes")
    .reduce((s, v) => s + v.voteShares, 0);
  const noShares = vote.votes.filter((v) => v.vote === "no").reduce((s, v) => s + v.voteShares, 0);
  const notVotedShares = Math.max(0, eligibleVotes - yesShares - noShares);
  const requiredShares = Math.ceil(eligibleVotes * vote.passThreshold);
  const yesPct = eligibleVotes > 0 ? (yesShares / eligibleVotes) * 100 : 0;
  const noPct = eligibleVotes > 0 ? (noShares / eligibleVotes) * 100 : 0;
  const thresholdPct = vote.passThreshold * 100;
  const turnsRemaining = vote.deadlineAtTurn - currentTurn;

  // Determine if the viewer can vote via any identity
  const selectedIdentity = identities.find((i) => i.id === selectedIdentityId);
  const canVote = vote.status === "open" && selectedIdentity != null && !selectedIdentity.hasVoted;

  // Check if the viewer's character already voted (for the "Voted YES/NO" display)
  const myCharVote = vote.votes.find((v) => v.characterId?.toString() === viewerCharacterId)?.vote;

  const statusBg =
    vote.status === "passed"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : vote.status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
        : vote.status === "cancelled"
          ? "bg-muted text-muted-foreground"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {typeLabel(vote.type)}
            </span>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusBg}`}
            >
              {vote.status}
            </span>
          </div>
          <p className="font-semibold text-sm">{proposalSummary(vote)}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="relative h-4 overflow-hidden rounded-full bg-muted">
          <div
            className="absolute left-0 top-0 h-full bg-green-500 transition-all duration-500"
            style={{ width: `${yesPct}%` }}
          />
          <div
            className="absolute top-0 h-full bg-red-500 transition-all duration-500"
            style={{ left: `${yesPct}%`, width: `${noPct}%` }}
          />
          {/* Threshold marker */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/70 z-10"
            style={{ left: `${Math.min(thresholdPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-semibold text-green-600">
            {yesShares.toLocaleString("en-US")} YES ({yesPct.toFixed(1)}%)
          </span>
          <span className="text-muted-foreground">
            {notVotedShares.toLocaleString("en-US")} abstained
          </span>
          <span className="font-semibold text-red-600">
            {noShares.toLocaleString("en-US")} NO ({noPct.toFixed(1)}%)
          </span>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Needs {requiredShares.toLocaleString("en-US")} YES ({thresholdPct}% of all votes) to pass
        </p>
      </div>

      {/* Status footer */}
      {vote.status === "open" && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {turnsRemaining > 0
              ? `${turnsRemaining} turn${turnsRemaining !== 1 ? "s" : ""} remaining`
              : "Closing…"}
          </span>
          <span>
            You hold {viewerShares.toLocaleString("en-US")} shares
            {myVotingPower !== viewerShares
              ? ` (${myVotingPower.toLocaleString("en-US")} votes)`
              : ""}
            {myCharVote ? ` · Voted ${myCharVote.toUpperCase()}` : ""}
          </span>
        </div>
      )}

      {/* Voting controls */}
      {vote.status === "open" && (
        <div className="space-y-3">
          {/* Identity selector — shown when user has multiple voting identities */}
          {identities.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Vote as
              </label>
              <div className="flex flex-wrap gap-1.5">
                {identities.map((ident) => {
                  const isSelected = ident.id === selectedIdentityId;
                  const isDisabled = ident.hasVoted;
                  return (
                    <button
                      key={ident.id}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => setSelectedIdentityId(ident.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all border ${
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : isDisabled
                            ? "bg-muted text-muted-foreground border-muted line-through cursor-not-allowed"
                            : "bg-card text-foreground border-card-border hover:border-primary/50 hover:bg-card-elevated"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {ident.kind === "character" ? (
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6a5 5 0 0110 0H3z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M2 3a1 1 0 011-1h2.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H13a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
                          </svg>
                        )}
                        {ident.name}
                        <span className="text-[10px] opacity-70">
                          ({ident.votingPower.toLocaleString("en-US")} votes)
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Single identity — show inline */}
          {identities.length === 1 &&
            selectedIdentity &&
            selectedIdentity.kind === "corporation" && (
              <p className="text-xs text-muted-foreground">
                Voting as{" "}
                <span className="font-medium text-foreground">{selectedIdentity.name}</span> (
                {selectedIdentity.votingPower.toLocaleString("en-US")} votes)
              </p>
            )}

          {/* Vote buttons */}
          {canVote && (
            <div className="flex gap-2">
              <button
                onClick={() => castVote("yes")}
                disabled={loading}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all bg-green-100 text-green-800 hover:bg-green-200 active:scale-[0.98] dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
              >
                ✓ Yes
              </button>
              <button
                onClick={() => castVote("no")}
                disabled={loading}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all bg-red-100 text-red-800 hover:bg-red-200 active:scale-[0.98] dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
              >
                ✗ No
              </button>
            </div>
          )}

          {!canVote && identities.length > 0 && identities.every((i) => i.hasVoted) && (
            <p className="text-xs text-muted-foreground italic">
              You have already voted on this proposal.
            </p>
          )}

          {!canVote && identities.length === 0 && !isCeo && (
            <p className="text-xs text-muted-foreground">You hold no shares in this corporation.</p>
          )}

          {isCeo && (
            <button
              onClick={cancelVote}
              disabled={loading}
              className="w-full rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-destructive/30 transition-colors"
            >
              Cancel Vote
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs font-medium text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
