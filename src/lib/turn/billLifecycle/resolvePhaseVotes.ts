import type { Db } from "mongodb";
import type { BillVoteValue } from "@/lib/congress/billVoting";
import { scopeVotesToCurrentSeatHolders } from "@/lib/legislature/stateBillVoteScope";
import { toVoteSnapshot } from "@/lib/legislature/voteSnapshot";
import type { PhaseVoteResult, VoteTotals } from "./types";

/**
 * Minimal structural bill shape the vote-core needs — satisfied by both the
 * national `Bill` (`votes`/`otherChamberVotes`) and the regional `StateBill`
 * (`votes`/`overrideVotes`), so both engines resolve through this one path.
 */
export interface PhaseVoteBill {
  votes?: Record<string, BillVoteValue> | undefined;
  otherChamberVotes?: Record<string, BillVoteValue> | undefined;
  overrideVotes?: Record<string, BillVoteValue> | undefined;
  votesFor?: number;
  votesAgainst?: number;
  votesAbstain?: number;
  otherChamberVotesFor?: number;
  otherChamberVotesAgainst?: number;
  otherChamberVotesAbstain?: number;
  overrideVotesFor?: number;
  overrideVotesAgainst?: number;
}

/**
 * Shared vote-core for the unified bill-lifecycle engines (national walker AND
 * the regional walker). Scopes a bill's raw vote map to the chamber's CURRENT
 * seat holders (weighting by seatsHeld, via the shared
 * {@link scopeVotesToCurrentSeatHolders} core) and returns both the scoped
 * totals used for the pass/fail decision AND a frozen {@link BillVoteSnapshot}
 * for the display layer. This is the single place the engines solve
 * election-boundary scoping (#0836) and result freezing (#0982).
 *
 * Pass `stateId` for sub-national bills — it pins the roster lookup to that
 * state's chamber. Pass voteField `"overrideVotes"` for the state veto-override
 * phase (single-chamber map with `overrideVotesFor/Against` aggregates).
 *
 * Fallback: when there are no current-holder survivors to scope (no votes, no
 * matching officials, or every voter has left the seat), freeze the stored
 * aggregate against the raw vote map so the snapshot's headline still matches
 * the decision the caller makes from `totals`.
 */
export async function resolvePhaseVotes(
  db: Db,
  bill: PhaseVoteBill,
  opts: {
    voteField: "votes" | "otherChamberVotes" | "overrideVotes";
    officeType: string;
    countryId: string;
    stateId?: string;
  },
  resolvedAtTurn: number
): Promise<PhaseVoteResult> {
  const votes =
    opts.voteField === "otherChamberVotes"
      ? bill.otherChamberVotes
      : opts.voteField === "overrideVotes"
        ? bill.overrideVotes
        : bill.votes;
  const stored: VoteTotals =
    opts.voteField === "otherChamberVotes"
      ? {
          for: bill.otherChamberVotesFor ?? 0,
          against: bill.otherChamberVotesAgainst ?? 0,
          abstain: bill.otherChamberVotesAbstain ?? 0,
        }
      : opts.voteField === "overrideVotes"
        ? {
            for: bill.overrideVotesFor ?? 0,
            against: bill.overrideVotesAgainst ?? 0,
            abstain: 0,
          }
        : {
            for: bill.votesFor ?? 0,
            against: bill.votesAgainst ?? 0,
            abstain: bill.votesAbstain ?? 0,
          };

  const fallback = (): PhaseVoteResult => ({
    totals: stored,
    snapshot: toVoteSnapshot(
      { votes: votes ?? {}, weightMap: new Map(), totals: stored },
      resolvedAtTurn
    ),
  });

  const scoped = await scopeVotesToCurrentSeatHolders(db, votes, {
    countryId: opts.countryId,
    officeType: opts.officeType,
    stateId: opts.stateId,
  });
  // `scoped: false` = no roster lookup was possible (empty map / no valid keys);
  // an empty scoped map = every voter left the seat. Both freeze the stored
  // aggregate so the snapshot headline matches the decision.
  if (!scoped.scoped) return fallback();
  const scopedVotes = scoped.votes ?? {};
  if (Object.keys(scopedVotes).length === 0) return fallback();

  return {
    totals: scoped.totals,
    snapshot: toVoteSnapshot(
      { votes: scopedVotes, weightMap: scoped.weightMap, totals: scoped.totals },
      resolvedAtTurn
    ),
  };
}
