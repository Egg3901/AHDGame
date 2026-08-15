import { ObjectId, type Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import type { BillVoteSnapshot } from "@/lib/db/types/voteSnapshot";
import {
  buildScopedVoteInputs,
  type BillVoteValue,
  type ScopedVoteInputs,
  type ScopedVoteOfficial,
} from "@/lib/congress/billVoting";

export interface ScopedStateVoteResult extends ScopedVoteInputs {
  /** Weighted for/against/abstain totals over the scoped (current-chamber) votes. */
  totals: { for: number; against: number; abstain: number };
}

export type BillCardTally = { for: number; against: number; abstain: number };

/**
 * Headline tally for a bill-list card. A concluded phase uses its frozen
 * snapshot (#0982). An in-progress phase live-scopes to current seat holders
 * so de-seated voters (and their old `seatsHeld`) cannot inflate the count
 * past the chamber size (bug #0836 / ticket #973 on state lists; ticket #1075
 * on the national Congress list). Falls back to the stored aggregate only
 * when there are no current-holder votes to scope.
 */
export function resolveBillCardTally(
  votes: Record<string, BillVoteValue> | undefined,
  stored: BillCardTally,
  snapshot: BillVoteSnapshot | undefined,
  officials: ScopedVoteOfficial[],
  scope: { countryId: string; officeType: string } | null
): BillCardTally {
  if (snapshot) return { ...snapshot.totals };
  if (!scope) return stored;
  const scoped = scopeStateBillVotesWithOfficials(votes, officials, scope);
  if (Object.keys(scoped.votes ?? {}).length === 0) return stored;
  return scoped.totals;
}

export type StateBillHeadlineTallies = {
  votesFor: number;
  votesAgainst: number;
  overrideVotesFor: number;
  overrideVotesAgainst: number;
};

type StateBillTallySource = {
  votes?: Record<string, BillVoteValue>;
  votesFor: number;
  votesAgainst: number;
  votesAbstain?: number;
  voteSnapshot?: BillVoteSnapshot;
  overrideVotes?: Record<string, "for" | "against">;
  overrideVotesFor?: number;
  overrideVotesAgainst?: number;
  overrideVoteSnapshot?: BillVoteSnapshot;
};

/**
 * Origin + veto-override headlines for a state bill card that is not the
 * legislature list/detail (ticket #1107: governor office). Same rules as
 * {@link resolveBillCardTally}: freeze a concluded phase from its snapshot,
 * live-scope an in-progress phase to current seat holders.
 */
export function resolveStateBillHeadlineTallies(
  bill: StateBillTallySource,
  officials: ScopedVoteOfficial[],
  scope: { countryId: string; officeType: string } | null
): StateBillHeadlineTallies {
  const origin = resolveBillCardTally(
    bill.votes,
    { for: bill.votesFor, against: bill.votesAgainst, abstain: bill.votesAbstain ?? 0 },
    bill.voteSnapshot,
    officials,
    scope
  );
  const override = resolveBillCardTally(
    bill.overrideVotes,
    {
      for: bill.overrideVotesFor ?? 0,
      against: bill.overrideVotesAgainst ?? 0,
      abstain: 0,
    },
    bill.overrideVoteSnapshot,
    officials,
    scope
  );
  return {
    votesFor: origin.for,
    votesAgainst: origin.against,
    overrideVotesFor: override.for,
    overrideVotesAgainst: override.against,
  };
}

/**
 * Pure variant of {@link scopeStateBillVotes} for callers that have already
 * loaded the chamber roster (e.g. the bills-list page, which scopes many bills
 * that all share one chamber and must not issue a DB query per bill). Given the
 * current seat holders, drops votes from officials who no longer hold the seat,
 * re-weights survivors by `seatsHeld`, and returns the weighted totals.
 */
export function scopeStateBillVotesWithOfficials(
  votes: Record<string, BillVoteValue> | undefined,
  officials: ScopedVoteOfficial[],
  scope: { countryId: string; officeType: string }
): ScopedStateVoteResult {
  const emptyTotals = { for: 0, against: 0, abstain: 0 };
  if (!votes || Object.keys(votes).length === 0) {
    return { votes, weightMap: new Map(), totals: { ...emptyTotals } };
  }
  const scoped = buildScopedVoteInputs(votes, officials, {
    countryId: scope.countryId,
    officeType: scope.officeType,
  });
  const totals = { ...emptyTotals };
  for (const [voteKey, vote] of Object.entries(scoped.votes ?? {})) {
    totals[vote] += scoped.weightMap.get(voteKey) ?? 1;
  }
  return { ...scoped, totals };
}

/**
 * Level-agnostic core shared by the national engine vote-core
 * (`resolvePhaseVotes`) and the state helpers below: parse the vote map's
 * character/NPP keys, load the matching CURRENT seat holders, and re-weight
 * surviving votes by `seatsHeld` (bug #0836 — the single implementation of
 * election-boundary vote scoping).
 *
 * `scoped: false` means no roster lookup happened (empty map or no valid
 * keys) and `votes`/`totals` are the untouched input + zeros — callers decide
 * their own fallback semantics for that case.
 *
 * The chamber filter is level-aware: with `stateId` it pins state + office +
 * country so a same-officeType seat in another region cannot leak into the
 * weight map; without it, country only (national chambers — office is
 * enforced in-memory by `buildScopedVoteInputs`, letting a multi-seat NPP's
 * other-chamber rows load harmlessly).
 */
export async function scopeVotesToCurrentSeatHolders(
  db: Db,
  votes: Record<string, BillVoteValue> | undefined,
  scope: { countryId: string; officeType: string; stateId?: string }
): Promise<ScopedStateVoteResult & { scoped: boolean }> {
  const emptyTotals = { for: 0, against: 0, abstain: 0 };
  const voteKeys = Object.keys(votes ?? {});
  if (voteKeys.length === 0) {
    return { votes, weightMap: new Map(), totals: { ...emptyTotals }, scoped: false };
  }

  const characterIds = voteKeys.filter((key) => !key.startsWith("npp_") && ObjectId.isValid(key));
  const nppIds = voteKeys
    .filter((key) => key.startsWith("npp_") && ObjectId.isValid(key.slice(4)))
    .map((key) => key.slice(4));

  const orClauses: Record<string, unknown>[] = [];
  if (characterIds.length > 0) {
    orClauses.push({
      characterId: { $in: characterIds.map((id) => new ObjectId(id)) },
      nppId: null,
    });
  }
  if (nppIds.length > 0) {
    orClauses.push({ nppId: { $in: nppIds.map((id) => new ObjectId(id)) } });
  }
  if (orClauses.length === 0) {
    return { votes, weightMap: new Map(), totals: { ...emptyTotals }, scoped: false };
  }

  const chamberFilter =
    scope.stateId !== undefined
      ? {
          $or: orClauses,
          state: scope.stateId,
          officeType: scope.officeType,
          countryId: scope.countryId as ElectedOfficial["countryId"],
        }
      : {
          $or: orClauses,
          countryId: { $in: [scope.countryId as ElectedOfficial["countryId"]] },
        };

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(chamberFilter)
    .project<ScopedVoteOfficial>({
      characterId: 1,
      countryId: 1,
      nppId: 1,
      officeType: 1,
      seatsHeld: 1,
    })
    .toArray();

  return {
    ...scopeStateBillVotesWithOfficials(votes, officials, {
      countryId: scope.countryId,
      officeType: scope.officeType,
    }),
    scoped: true,
  };
}

/**
 * Scope a state bill's raw vote map down to the sub-national chamber's CURRENT
 * seat holders, weighting each surviving vote by that holder's current
 * `seatsHeld`. Mirrors the national `buildScopedVoteInputs` /
 * `resolveScopedVoteTotals` treatment so votes cast by a pre-election chamber
 * composition cannot inflate post-election tallies (bug #0836: 35 votes shown in
 * a 31-seat chamber after a state legislature election).
 *
 * Voters who no longer hold the seat are dropped entirely; survivors are
 * re-weighted to their current seat count. This keeps any tally within the
 * chamber size and never double-counts across an election boundary.
 */
export async function scopeStateBillVotes(
  db: Db,
  votes: Record<string, BillVoteValue> | undefined,
  scope: { stateId: string; countryId: string; officeType: string }
): Promise<ScopedStateVoteResult> {
  const { scoped: _scoped, ...result } = await scopeVotesToCurrentSeatHolders(db, votes, scope);
  return result;
}
