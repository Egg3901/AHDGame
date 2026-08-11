import type { PartyGroup } from "@/lib/elections/candidateEnrichment";
import {
  getDefaultPrimaryAllocation,
  getDelegatesForState,
  type PrimaryCalendarFamily,
} from "@/lib/constants/primaryCalendar";
import { allocateDelegates, type AllocationMethod } from "@/lib/primaryDelegateAllocation";
import type { PollingData } from "./electionResponseTypes";

export interface PrimaryProjectionSummary {
  /** Sum of (actual when present, projected otherwise) votes across all states, per candidate. */
  nationalVotesByCandidate: Record<string, number>;
  /** National vote share = candidate votes / total votes. 0–100. */
  nationalVoteSharePct: Record<string, number>;
  /** Projected/awarded delegates per candidate (from `projectPrimaryDelegateTotals`). */
  delegatesByCandidate: Record<string, number>;
  /** National delegate share = delegates / total delegates. 0–100. */
  nationalDelegateSharePct: Record<string, number>;
  /** Per-state breakdown — votes used (actual when available, else projected), winner, source. */
  perState: Array<{
    stateId: string;
    delegatesAvailable: number;
    allocationMethod: AllocationMethod;
    voteSource: "actual" | "projected" | "none";
    totalVotes: number;
    votesByCandidate: Record<string, number>;
    sharePctByCandidate: Record<string, number>;
    winnerId: string | null;
    awardedDelegatesByCandidate: Record<string, number> | null;
    projectedDelegatesByCandidate: Record<string, number>;
  }>;
}

interface SummarizePrimaryProjectionInput {
  stateIds: string[];
  family: PrimaryCalendarFamily;
  candidateIds: string[];
  totalDelegates: number;
  projectedVotesByState: Record<string, Record<string, number>>;
  actualVotesByState?: Record<string, Record<string, number>>;
  awardedDelegatesByState?: Record<string, Record<string, number>>;
  allocationByState?: Record<string, AllocationMethod>;
  /** Active reset preset — drives per-state delegate rescaling (1990 vs 2020 EV). */
  preset?: string;
}

/**
 * Canonical reconciliation between per-state primary projections and national
 * delegate totals. `projectPrimaryDelegateTotals` answers "who has how many
 * delegates," but the per-state page shows raw vote share, which can diverge
 * dramatically from delegate share under winner-take-all. This helper exposes
 * BOTH numbers from the SAME canonical state-by-state source so display callers
 * never have to re-derive vote share from a different code path (which is how
 * overview-vs-state inconsistencies historically appear).
 */
export function summarizePrimaryProjection({
  stateIds,
  family,
  candidateIds,
  totalDelegates,
  projectedVotesByState,
  actualVotesByState = {},
  awardedDelegatesByState = {},
  allocationByState = {},
  preset,
}: SummarizePrimaryProjectionInput): PrimaryProjectionSummary {
  const nationalVotesByCandidate = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  const perState: PrimaryProjectionSummary["perState"] = [];

  // Cumulative vote priority is used by PR allocation tie-breaks; we walk states
  // in calendar order so the priority matches `projectPrimaryDelegateTotals`.
  const cumulativeVotePriority: Record<string, number> = {};
  for (const stateId of stateIds) {
    const actual = actualVotesByState[stateId];
    const hasActual = !!actual && Object.values(actual).some((v) => v > 0);
    const voteSource = hasActual ? actual : (projectedVotesByState[stateId] ?? null);
    if (!voteSource) continue;
    for (const [cid, v] of Object.entries(voteSource)) {
      cumulativeVotePriority[cid] = (cumulativeVotePriority[cid] ?? 0) + v;
    }
  }

  for (const stateId of stateIds) {
    const delegatesAvailable = getDelegatesForState(stateId, family, preset);
    const method = allocationByState[stateId] ?? getDefaultPrimaryAllocation(stateId, family);

    const actual = actualVotesByState[stateId];
    const hasActual = !!actual && Object.values(actual).some((v) => v > 0);
    const projected = projectedVotesByState[stateId];

    let voteSource: "actual" | "projected" | "none" = "none";
    let votesByCandidate: Record<string, number> = {};
    if (hasActual) {
      voteSource = "actual";
      votesByCandidate = actual;
    } else if (projected && Object.values(projected).some((v) => v > 0)) {
      voteSource = "projected";
      votesByCandidate = projected;
    }

    const totalVotes = Object.values(votesByCandidate).reduce((s, v) => s + v, 0);
    const sharePctByCandidate: Record<string, number> = {};
    let winnerId: string | null = null;
    let topVotes = -Infinity;
    for (const cid of candidateIds) {
      const votes = votesByCandidate[cid] ?? 0;
      sharePctByCandidate[cid] = totalVotes > 0 ? Math.round((votes / totalVotes) * 1000) / 10 : 0;
      nationalVotesByCandidate[cid] = (nationalVotesByCandidate[cid] ?? 0) + votes;
      if (votes > topVotes && votes > 0) {
        topVotes = votes;
        winnerId = cid;
      }
    }

    const awarded = awardedDelegatesByState[stateId];
    const hasAwarded = !!awarded && Object.values(awarded).some((d) => d > 0);

    let projectedDelegatesByCandidate: Record<string, number> = Object.fromEntries(
      candidateIds.map((id) => [id, 0])
    );
    if (hasAwarded) {
      projectedDelegatesByCandidate = { ...projectedDelegatesByCandidate, ...awarded };
    } else if (delegatesAvailable > 0 && totalVotes > 0) {
      const allocation = allocateDelegates(
        method,
        votesByCandidate,
        delegatesAvailable,
        cumulativeVotePriority
      );
      for (const cid of candidateIds) {
        projectedDelegatesByCandidate[cid] = allocation.byCandidate[cid] ?? 0;
      }
    }

    perState.push({
      stateId,
      delegatesAvailable,
      allocationMethod: method,
      voteSource,
      totalVotes,
      votesByCandidate: { ...votesByCandidate },
      sharePctByCandidate,
      winnerId,
      awardedDelegatesByCandidate: hasAwarded ? { ...awarded } : null,
      projectedDelegatesByCandidate,
    });
  }

  const totalNationalVotes = Object.values(nationalVotesByCandidate).reduce((s, v) => s + v, 0);
  const nationalVoteSharePct: Record<string, number> = {};
  for (const cid of candidateIds) {
    nationalVoteSharePct[cid] =
      totalNationalVotes > 0
        ? Math.round((nationalVotesByCandidate[cid] / totalNationalVotes) * 1000) / 10
        : 0;
  }

  const delegatesByCandidate = projectPrimaryDelegateTotals({
    stateIds,
    family,
    candidateIds,
    projectedVotesByState,
    actualVotesByState,
    awardedDelegatesByState,
    allocationByState,
  });
  const nationalDelegateSharePct: Record<string, number> = {};
  for (const cid of candidateIds) {
    nationalDelegateSharePct[cid] =
      totalDelegates > 0 ? Math.round((delegatesByCandidate[cid] / totalDelegates) * 1000) / 10 : 0;
  }

  return {
    nationalVotesByCandidate,
    nationalVoteSharePct,
    delegatesByCandidate,
    nationalDelegateSharePct,
    perState,
  };
}

interface ProjectPrimaryDelegateTotalsInput {
  stateIds: string[];
  family: PrimaryCalendarFamily;
  candidateIds: string[];
  projectedVotesByState: Record<string, Record<string, number>>;
  actualVotesByState?: Record<string, Record<string, number>>;
  awardedDelegatesByState?: Record<string, Record<string, number>>;
  allocationByState?: Record<string, AllocationMethod>;
  /** Active reset preset — drives per-state delegate rescaling (1990 vs 2020 EV). */
  preset?: string;
}

/**
 * Build a live delegate projection for one party's presidential primary. Any
 * state that has already awarded delegates stays locked to the real allocation;
 * remaining states are allocated from the same per-state vote projection the
 * primary map uses so the card standings and map tell the same story.
 */
export function projectPrimaryDelegateTotals({
  stateIds,
  family,
  candidateIds,
  projectedVotesByState,
  actualVotesByState = {},
  awardedDelegatesByState = {},
  allocationByState = {},
  preset,
}: ProjectPrimaryDelegateTotalsInput): Record<string, number> {
  const totals = Object.fromEntries(candidateIds.map((candidateId) => [candidateId, 0]));

  const cumulativeVotePriority: Record<string, number> = {};
  for (const stateId of stateIds) {
    const voteSource =
      actualVotesByState[stateId] && Object.values(actualVotesByState[stateId]).some((v) => v > 0)
        ? actualVotesByState[stateId]
        : projectedVotesByState[stateId];
    if (!voteSource) continue;
    for (const [candidateId, votes] of Object.entries(voteSource)) {
      cumulativeVotePriority[candidateId] = (cumulativeVotePriority[candidateId] ?? 0) + votes;
    }
  }

  for (const stateId of stateIds) {
    const awarded = awardedDelegatesByState[stateId];
    if (awarded && Object.values(awarded).some((delegates) => delegates > 0)) {
      for (const [candidateId, delegates] of Object.entries(awarded)) {
        totals[candidateId] = (totals[candidateId] ?? 0) + delegates;
      }
      continue;
    }

    const delegatesAvailable = getDelegatesForState(stateId, family, preset);
    if (delegatesAvailable <= 0) continue;

    const votesByCandidate =
      actualVotesByState[stateId] && Object.values(actualVotesByState[stateId]).some((v) => v > 0)
        ? actualVotesByState[stateId]
        : projectedVotesByState[stateId];
    if (!votesByCandidate) continue;

    const method = allocationByState[stateId] ?? getDefaultPrimaryAllocation(stateId, family);
    const allocation = allocateDelegates(
      method,
      votesByCandidate,
      delegatesAvailable,
      cumulativeVotePriority
    );

    for (const [candidateId, delegates] of Object.entries(allocation.byCandidate)) {
      totals[candidateId] = (totals[candidateId] ?? 0) + delegates;
    }
  }

  return totals;
}

/**
 * Combined delegate-first standing used to rank presidential-primary candidates
 * consistently across every surface. Delegates dominate (they decide the
 * winner) and sit in the integer part; national vote share is a [0,1) fraction
 * that breaks delegate ties and keeps the ordering sensible before any delegates
 * are awarded. Feeds `primaryScore` so downstream consumers that re-sort by
 * `primaryScore` still match the delegate winner (#3022). Kept small on purpose:
 * some surfaces render `primaryScore` directly (e.g. the wiki results table), so
 * a candidate reads as e.g. `12.3` (12 delegates, leading the vote tiebreak),
 * never a millions-scale composite.
 */
export function presidentialPrimaryStanding(delegates: number, voteShareFraction: number): number {
  const frac = Math.max(0, Math.min(0.999, voteShareFraction));
  return delegates + frac;
}

export function applyProjectedDelegateShares(
  group: PartyGroup,
  projectedDelegates: Record<string, number>,
  totalDelegates: number,
  nationalVotesByCandidate?: Record<string, number>
): PartyGroup {
  const totalNationalVotes = nationalVotesByCandidate
    ? Object.values(nationalVotesByCandidate).reduce((s, v) => s + v, 0)
    : 0;
  const candidates = group.candidates
    .map((candidate) => {
      const delegates = projectedDelegates[candidate.id] ?? 0;
      return {
        ...candidate,
        sharePct: totalDelegates > 0 ? Math.round((delegates / totalDelegates) * 1000) / 10 : 0,
        // Overwrite the ideology-based primaryScore with a delegate-consistent
        // standing so every primaryScore-sorted surface agrees with the
        // delegate winner (#3022). Only applied when a votes map is supplied
        // (presidential path); other callers keep the original primaryScore.
        primaryScore: nationalVotesByCandidate
          ? presidentialPrimaryStanding(
              delegates,
              totalNationalVotes > 0
                ? (nationalVotesByCandidate[candidate.id] ?? 0) / totalNationalVotes
                : 0
            )
          : candidate.primaryScore,
      };
    })
    .sort((a, b) => {
      const delegateDiff = (projectedDelegates[b.id] ?? 0) - (projectedDelegates[a.id] ?? 0);
      if (delegateDiff !== 0) return delegateDiff;
      return b.primaryScore - a.primaryScore;
    });

  return {
    ...group,
    candidates,
  };
}

export function applyProjectedDelegatePolling(
  polling: PollingData | null,
  groups: PartyGroup[]
): PollingData | null {
  if (!polling || polling.source !== "primary") return polling;

  const sharesPct: Record<string, number> = {};
  const candidateNames: Record<string, string> = {};
  const candidateParties: Record<string, string> = {};
  const candidatePartyNames: Record<string, string> = {};
  const candidatePartyColors: Record<string, string> = {};
  for (const group of groups) {
    for (const candidate of group.candidates) {
      sharesPct[candidate.id] = candidate.sharePct;
      candidateNames[candidate.id] = candidate.characterName;
      candidateParties[candidate.id] = group.partyId;
      candidatePartyNames[candidate.id] = group.partyName;
      candidatePartyColors[candidate.id] = group.partyColor;
    }
  }

  const leaderId = Object.entries(sharesPct).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  return {
    ...polling,
    sharesPct,
    candidateNames,
    candidateParties,
    candidatePartyNames,
    candidatePartyColors,
    leaderId,
    leaderName: leaderId ? (candidateNames[leaderId] ?? null) : null,
    leaderParty: leaderId ? (candidateParties[leaderId] ?? null) : null,
  };
}
