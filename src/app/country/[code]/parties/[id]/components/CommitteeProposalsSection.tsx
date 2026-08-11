"use client";

import { useState, useEffect, useCallback } from "react";
import { partyApiUrl } from "@/lib/urls";
import { ProposalCard } from "./ProposalCard";
import { CreateProposalForm } from "./CreateProposalForm";
import type { ProposalsResponse } from "@/lib/parties/dto/partyView";

export function CommitteeProposalsSection({
  country,
  countryCode,
  partyId,
  characterId: _characterId,
  isChair: _isChair,
}: {
  country: string;
  countryCode: string;
  partyId: string;
  characterId: string | null;
  isChair: boolean;
}) {
  const [data, setData] = useState<ProposalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/committee/proposals`);
      if (res.ok) setData(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, [country, partyId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  if (loading) {
    return (
      <div className="text-sm text-muted py-4 text-center animate-pulse">Loading proposals…</div>
    );
  }

  const canPropose = data?.canPropose ?? false;
  const canProposeMerge = data?.canProposeMerge ?? false;
  const canVote = data?.canVote ?? false;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Committee Proposals</h2>
        {canPropose && (
          <CreateProposalForm
            country={country}
            partyId={partyId}
            countryCode={countryCode}
            isChair={canProposeMerge}
            currentTransactionApprovalMode={data?.currentTransactionApprovalMode ?? "double"}
            onCreated={fetchProposals}
          />
        )}
      </div>

      {/* Open proposals from this party */}
      {data && data.openProposals.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Open Proposals
          </h3>
          {data.openProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              country={country}
              partyId={partyId}
              canVote={canVote}
              votingSide={canVote ? "proposing" : null}
              onVoted={fetchProposals}
            />
          ))}
        </div>
      )}

      {/* Incoming merge proposals targeting this party */}
      {data && data.incomingMergeProposals.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Incoming Merge Proposals
          </h3>
          <p className="text-xs text-muted">
            Another party has proposed to merge into yours. Your committee can vote to accept or
            decline.
          </p>
          {data.incomingMergeProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              country={country}
              partyId={partyId}
              canVote={canVote}
              votingSide={canVote ? "target" : null}
              onVoted={fetchProposals}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {data && data.openProposals.length === 0 && data.incomingMergeProposals.length === 0 && (
        <p className="text-sm text-muted">No open proposals.</p>
      )}

      {/* Past proposals */}
      {data && data.pastProposals.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            {showPast ? "Hide" : "Show"} past proposals ({data.pastProposals.length})
          </button>
          {showPast &&
            data.pastProposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                country={country}
                partyId={partyId}
                canVote={false}
                votingSide={null}
                onVoted={() => {}}
              />
            ))}
        </div>
      )}
    </div>
  );
}
