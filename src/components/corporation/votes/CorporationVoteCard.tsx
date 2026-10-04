"use client";

import { useState, useCallback } from "react";
import { useAbortableEffectFetch } from "@/hooks/useAbortableEffectFetch";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { LEGAL_STRUCTURES } from "@/lib/constants/legalStructures";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { InlineStatus, SmallButton } from "../dense/DenseKit";

interface VotingIdentity {
  kind: "character" | "corporation";
  id: string;
  name: string;
  sequentialId?: number;
  votingPower: number;
  shares: number;
  hasVoted?: boolean;
}

/** An index fund the viewer controls that holds shares in this corporation. */
interface DirectableFund {
  fundId: string;
  name: string;
  tickerSymbol: string;
  unitShare: number;
  votingPower: number;
  instruction: "yes" | "no" | null;
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
      return "Restructuring";
    case "dissolution":
      return "Dissolution";
    case "relocation":
      return "Relocation";
    case "share_issuance":
      return "Share issuance";
    case "adopt_supershares":
      return "Supershares";
    case "ticker_change":
      return "Ticker change";
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
  const [directableFunds, setDirectableFunds] = useState<DirectableFund[]>([]);

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

  // Index funds the viewer controls that hold shares here. Most viewers control
  // none, so the whole block stays hidden rather than showing an empty state.
  const fetchDirectableFunds = useCallback(async () => {
    try {
      const res = await fetch(`/api/corporations/${corporationId}/votes/${voteId}/fund-direction`);
      if (!res.ok) return;
      const data = await res.json();
      setDirectableFunds(data.funds ?? []);
    } catch {
      // stewardship is optional; voting still works without it
    }
  }, [corporationId, voteId]);

  // One abortable mount load for all three reads: without it the responses land
  // on an unmounted card, and in tests they reject during happy-dom teardown.
  useAbortableEffectFetch(async () => {
    await Promise.all([fetchVote(), fetchIdentities(), fetchDirectableFunds()]);
  }, [fetchVote, fetchIdentities, fetchDirectableFunds]);

  async function directFund(fundId: string, choice: "yes" | "no" | null) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/votes/${voteId}/fund-direction`, {
        method: choice ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice ? { fundId, vote: choice } : { fundId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchVote();
      await fetchDirectableFunds();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

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

  if (!vote) return <div className="h-16 animate-pulse border-b border-card-border/60" />;

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

  const statusTone =
    vote.status === "passed"
      ? "text-success"
      : vote.status === "failed"
        ? "text-error"
        : "text-muted";

  return (
    <div className="space-y-2 border-b border-card-border/60 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[13px] font-medium text-foreground">
          {typeLabel(vote.type)}: {proposalSummary(vote)}
        </p>
        <span className={`text-xs ${statusTone}`}>
          {vote.status === "open"
            ? turnsRemaining > 0
              ? `Open, ${turnsRemaining} turn${turnsRemaining !== 1 ? "s" : ""} left`
              : "Closing"
            : vote.status.charAt(0).toUpperCase() + vote.status.slice(1)}
        </span>
      </div>

      <div className="space-y-1">
        <div
          className="relative h-1.5 overflow-hidden rounded-sm bg-card-elevated"
          role="img"
          aria-label={`Yes ${yesPct.toFixed(1)}%, no ${noPct.toFixed(1)}%, needs ${thresholdPct}%`}
        >
          <div
            className="absolute left-0 top-0 h-full bg-success"
            style={{ width: `${yesPct}%` }}
          />
          <div
            className="absolute top-0 h-full bg-error"
            style={{ left: `${yesPct}%`, width: `${noPct}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-foreground"
            style={{ left: `${Math.min(thresholdPct, 100)}%` }}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 text-xs tabular-nums">
          <span className="text-success">
            Yes {yesShares.toLocaleString("en-US")} ({yesPct.toFixed(1)}%)
          </span>
          <span className="text-error">
            No {noShares.toLocaleString("en-US")} ({noPct.toFixed(1)}%)
          </span>
          <span className="text-muted">Abstained {notVotedShares.toLocaleString("en-US")}</span>
          <span className="text-muted">
            Needs {requiredShares.toLocaleString("en-US")} yes ({thresholdPct}%)
          </span>
        </div>
      </div>

      {vote.status === "open" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            You hold {viewerShares.toLocaleString("en-US")} shares
            {myVotingPower !== viewerShares
              ? ` (${myVotingPower.toLocaleString("en-US")} votes)`
              : ""}
            {myCharVote ? `. You voted ${myCharVote}.` : "."}
          </p>

          {identities.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Vote as
              {identities.map((ident) => {
                const isSelected = ident.id === selectedIdentityId;
                return (
                  <button
                    key={ident.id}
                    type="button"
                    disabled={ident.hasVoted}
                    onClick={() => setSelectedIdentityId(ident.id)}
                    aria-pressed={isSelected}
                    className={`h-7 rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:line-through disabled:opacity-50 ${
                      isSelected
                        ? "border-foreground bg-foreground font-medium text-background"
                        : "border-card-border text-foreground hover:bg-card-elevated"
                    }`}
                  >
                    {ident.name} ({ident.votingPower.toLocaleString("en-US")})
                  </button>
                );
              })}
            </div>
          )}

          {identities.length === 1 &&
            selectedIdentity &&
            selectedIdentity.kind === "corporation" && (
              <p className="text-xs text-muted">
                Voting as <span className="text-foreground">{selectedIdentity.name}</span> (
                {selectedIdentity.votingPower.toLocaleString("en-US")} votes)
              </p>
            )}

          <div className="flex flex-wrap items-center gap-1.5">
            {canVote && (
              <>
                <SmallButton onClick={() => castVote("yes")} disabled={loading}>
                  Vote yes
                </SmallButton>
                <SmallButton onClick={() => castVote("no")} disabled={loading}>
                  Vote no
                </SmallButton>
              </>
            )}
            {!canVote && identities.length > 0 && identities.every((i) => i.hasVoted) && (
              <span className="text-xs text-muted">You have voted on this proposal.</span>
            )}
            {!canVote && identities.length === 0 && directableFunds.length === 0 && !isCeo && (
              <span className="text-xs text-muted">You hold no shares in this corporation.</span>
            )}
            {isCeo && (
              <SmallButton tone="danger" onClick={cancelVote} disabled={loading}>
                Cancel vote
              </SmallButton>
            )}
          </div>

          {directableFunds.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted">
                Funds you direct. An uninstructed fund votes with the majority of everyone else, or
                abstains when there is none.
              </p>
              <table className="w-full border-collapse">
                <tbody>
                  {directableFunds.map((fund) => (
                    <tr key={fund.fundId}>
                      <td className="border-b border-card-border/60 py-1.5 pr-2 text-xs text-foreground">
                        {fund.name}
                        {fund.tickerSymbol ? (
                          <span className="ml-1 text-muted">{fund.tickerSymbol}</span>
                        ) : null}
                        <span className="ml-2 tabular-nums text-muted">
                          {fund.votingPower.toLocaleString("en-US")} votes,{" "}
                          {(fund.unitShare * 100).toFixed(0)}% of units yours
                        </span>
                      </td>
                      <td className="border-b border-card-border/60 py-1.5 text-right">
                        <span className="inline-flex gap-1">
                          <SmallButton
                            disabled={loading}
                            onClick={() => directFund(fund.fundId, "yes")}
                            className={
                              fund.instruction === "yes" ? "border-success text-success" : ""
                            }
                          >
                            Yes
                          </SmallButton>
                          <SmallButton
                            disabled={loading}
                            onClick={() => directFund(fund.fundId, "no")}
                            className={fund.instruction === "no" ? "border-error text-error" : ""}
                          >
                            No
                          </SmallButton>
                          {fund.instruction && (
                            <SmallButton
                              disabled={loading}
                              onClick={() => directFund(fund.fundId, null)}
                            >
                              Withdraw
                            </SmallButton>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <InlineStatus message={error} tone="error" />
    </div>
  );
}
