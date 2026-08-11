"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { VoteTallyTable } from "@/app/congress/bills/[id]/components/VoteTallyTable";
import type { VoteByParty } from "@/lib/congress/governmentVoteBreakdown";
import { formatPartyState } from "./CongressShared";

export type CandidacyLike = {
  id: string;
  nomineeId: string;
  /** Sequential ID for stable URLs (prefer this over nomineeId) */
  nomineeSequentialId?: number | null;
  nomineeName: string;
  nomineeParty: string;
  nomineePartyName: string;
  nomineePartyColor: string;
  nomineeState?: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  votesFor: number;
  voteByParty?: VoteByParty[];
  isMyVote: boolean;
  isMyCandidate: boolean;
};

export function ElectionDropdown({
  roleLabel,
  candidacies,
  partySeats,
  canVote,
  myVoteId,
  onVote,
  onWithdraw,
  viewOnlyLabel,
}: {
  roleLabel: string;
  candidacies: CandidacyLike[];
  partySeats: number;
  canVote: boolean;
  myVoteId: string | null;
  onVote: (id: string) => void;
  onWithdraw: () => void;
  viewOnlyLabel?: string | null;
}) {
  if (candidacies.length === 0) return null;
  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium hover:bg-background/50">
          <span>
            {roleLabel} — Active Candidacies ({candidacies.length})
            {canVote ? " — vote for one below" : viewOnlyLabel ? ` — ${viewOnlyLabel}` : ""}
          </span>
          <span className="text-xs text-muted font-normal tabular-nums">
            {partySeats} seats · plurality wins
          </span>
        </summary>
        <div className="border-t border-card-border">
          {candidacies.map((c) => {
            const isMyVote = myVoteId === c.id;
            return (
              <div
                key={c.id}
                className={`border-b border-card-border/50 last:border-0 ${isMyVote ? "bg-primary/5" : ""}`}
              >
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar
                    url={c.avatarUrl}
                    name={c.nomineeName}
                    size="h-7 w-7"
                    className="shrink-0"
                    borderKey={c.borderKey}
                    tintColor={c.tintColor}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={
                        c.nomineeId ? `/character/${c.nomineeSequentialId ?? c.nomineeId}` : "#"
                      }
                      className="text-sm font-medium hover:text-primary"
                    >
                      {c.nomineeName}
                      <span className="text-muted ml-1">
                        {formatPartyState(c.nomineeParty, c.nomineeState, c.nomineePartyName)}
                      </span>
                    </Link>
                  </div>
                  <span className="text-xs tabular-nums font-medium shrink-0">
                    {c.votesFor} votes
                  </span>
                  {c.isMyCandidate && (
                    <button
                      onClick={() => {
                        if (confirm("Withdraw candidacy? This will cost 3 NPI.")) {
                          onWithdraw();
                        }
                      }}
                      className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
                    >
                      Withdraw
                    </button>
                  )}
                  {canVote && (
                    <button
                      onClick={() => onVote(c.id)}
                      disabled={isMyVote}
                      className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${isMyVote ? "bg-primary/20 text-primary" : "bg-green-500/20 text-green-400 hover:bg-green-500/30"}`}
                    >
                      {isMyVote ? "✓ Voted" : "Vote"}
                    </button>
                  )}
                  {!canVote && isMyVote && (
                    <span className="shrink-0 text-xs text-primary font-medium">✓ Voted</span>
                  )}
                </div>
                {c.voteByParty && c.voteByParty.length > 0 && (
                  <div className="px-4 pb-3 pt-0">
                    <p className="mb-1.5 text-[11px] font-medium text-muted">Breakdown by party</p>
                    <VoteTallyTable
                      voteByParty={c.voteByParty}
                      chamberLabel={`${roleLabel} — ${c.nomineeName}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
