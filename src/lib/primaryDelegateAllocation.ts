/**
 * Delegate allocation math for presidential primaries.
 *
 * Two methods selected per state by the state party chair:
 *   - Proportional (PR) — Hamilton's method with a 15% viability floor (Dem rules)
 *   - Winner-take-all (WTA) — plurality winner takes every delegate (GOP rule for many states)
 *
 * Pure functions — no DB, no side effects. Used by the stagger-phase accumulator
 * and the per-state primary result breakdown.
 */

export type AllocationMethod = "PR" | "WTA";

/** 15% viability threshold for proportional allocation (standard Dem rule). */
export const PR_VIABILITY_THRESHOLD = 0.15;

export interface DelegateAllocation {
  /** candidateId → delegates awarded in this state */
  byCandidate: Record<string, number>;
  /** Total delegates awarded. Equals `delegatesAvailable` unless nobody is viable. */
  totalAwarded: number;
  /** Candidates filtered out for being below viability (PR only). */
  nonViable: string[];
}

/**
 * Allocate `delegatesAvailable` delegates proportionally among candidates using
 * Hamilton's largest-remainder method, after filtering out any candidate below
 * the 15% viability threshold.
 *
 * If no candidate clears the threshold, delegates are allocated proportionally
 * among the full field (prevents zero-delegate states from breaking the total).
 */
export function allocateProportional(
  votesByCandidate: Record<string, number>,
  delegatesAvailable: number
): DelegateAllocation {
  const entries = Object.entries(votesByCandidate).filter(([, v]) => v > 0);
  if (entries.length === 0 || delegatesAvailable <= 0) {
    return { byCandidate: {}, totalAwarded: 0, nonViable: [] };
  }

  const totalVotes = entries.reduce((s, [, v]) => s + v, 0);

  // Viability filter
  const viable = entries.filter(([, v]) => v / totalVotes >= PR_VIABILITY_THRESHOLD);
  const nonViable = entries
    .filter(([, v]) => v / totalVotes < PR_VIABILITY_THRESHOLD)
    .map(([id]) => id);

  // Fall back to the full field if nobody is viable
  const pool = viable.length > 0 ? viable : entries;
  const poolTotal = pool.reduce((s, [, v]) => s + v, 0);

  // Hamilton's method: floor each candidate's quota, then distribute the leftover
  // to the largest remainders.
  const quotas = pool.map(([id, v]) => {
    const exact = (v / poolTotal) * delegatesAvailable;
    return { id, exact, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  const byCandidate: Record<string, number> = {};
  for (const q of quotas) byCandidate[q.id] = q.floor;

  let assigned = quotas.reduce((s, q) => s + q.floor, 0);
  const leftover = delegatesAvailable - assigned;

  if (leftover > 0) {
    // Sort by remainder desc, break ties by vote count desc for determinism
    const ranked = [...quotas].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      const av = votesByCandidate[a.id] ?? 0;
      const bv = votesByCandidate[b.id] ?? 0;
      return bv - av;
    });
    for (let i = 0; i < leftover && i < ranked.length; i++) {
      byCandidate[ranked[i].id] += 1;
      assigned += 1;
    }
  }

  return { byCandidate, totalAwarded: assigned, nonViable };
}

/**
 * Winner-take-all: plurality leader takes every delegate in the state.
 *
 * Tie-breaking, in order:
 *   1. `tiebreakPriority[candidateId]` if supplied (higher wins) — typically
 *      cumulative votes across all states or a candidate-favorability score
 *   2. `candidateId.localeCompare` (deterministic alphabetical fallback)
 */
export function allocateWinnerTakeAll(
  votesByCandidate: Record<string, number>,
  delegatesAvailable: number,
  tiebreakPriority?: Record<string, number>
): DelegateAllocation {
  const entries = Object.entries(votesByCandidate).filter(([, v]) => v > 0);
  if (entries.length === 0 || delegatesAvailable <= 0) {
    return { byCandidate: {}, totalAwarded: 0, nonViable: [] };
  }

  const ranked = entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (tiebreakPriority) {
      const pa = tiebreakPriority[a[0]] ?? 0;
      const pb = tiebreakPriority[b[0]] ?? 0;
      if (pb !== pa) return pb - pa;
    }
    return a[0].localeCompare(b[0]);
  });

  const winnerId = ranked[0][0];
  return {
    byCandidate: { [winnerId]: delegatesAvailable },
    totalAwarded: delegatesAvailable,
    nonViable: [],
  };
}

/** Dispatch by method. tiebreakPriority only used for WTA. */
export function allocateDelegates(
  method: AllocationMethod,
  votesByCandidate: Record<string, number>,
  delegatesAvailable: number,
  tiebreakPriority?: Record<string, number>
): DelegateAllocation {
  return method === "WTA"
    ? allocateWinnerTakeAll(votesByCandidate, delegatesAvailable, tiebreakPriority)
    : allocateProportional(votesByCandidate, delegatesAvailable);
}
