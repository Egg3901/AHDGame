/**
 * NPP engine 6.4: primary consolidation (v6).
 *
 * Owner decision 2026-10-13: withdraw only. A clearly trailing NPP leaves a
 * same-party primary before it closes. It endorses nobody (NPP endorsements
 * stay manual-only), incumbents never withdraw, and a primary with any player
 * candidate is never touched.
 */
import { nppCandidateStrength } from "./candidatePlacement";

/** Turns before a primary closes in which consolidation (and no new challenge) applies. */
export const CONSOLIDATION_WINDOW_TURNS = 12;

/** An NPP below this share of its party leader's strength withdraws. */
export const CONSOLIDATION_TRAILING_RATIO = 0.6;

export interface ConsolidationEntrant {
  candidateId: string;
  party: string;
  /** Absent for a player candidate. */
  npp?: {
    _id: { toString(): string };
    politicalInfluence?: number | null;
    favorability?: number | null;
  };
  isIncumbent: boolean;
}

/** Whether a primary closing on `primaryEndTurn` is inside the window at `currentTurn`. */
export function inConsolidationWindow(
  primaryEndTurn: number | undefined,
  currentTurn: number
): boolean {
  if (primaryEndTurn == null || !Number.isFinite(primaryEndTurn)) return false;
  const remaining = primaryEndTurn - currentTurn;
  return remaining >= 0 && remaining <= CONSOLIDATION_WINDOW_TURNS;
}

/**
 * Candidate ids to withdraw from one primary's active field. Empty when any
 * entrant is a player. Per party: the strongest NPP leads, and every other
 * non-incumbent NPP under the trailing ratio of the leader's strength goes.
 */
export function trailingCandidatesToWithdraw(entrants: readonly ConsolidationEntrant[]): string[] {
  if (entrants.some((e) => !e.npp)) return [];
  const byParty = new Map<string, ConsolidationEntrant[]>();
  for (const entrant of entrants) {
    const list = byParty.get(entrant.party) ?? [];
    list.push(entrant);
    byParty.set(entrant.party, list);
  }
  const out: string[] = [];
  for (const field of byParty.values()) {
    if (field.length < 2) continue;
    const leaderStrength = Math.max(...field.map((e) => nppCandidateStrength(e.npp!)));
    if (leaderStrength <= 0) continue;
    for (const entrant of field) {
      if (entrant.isIncumbent) continue;
      if (nppCandidateStrength(entrant.npp!) < CONSOLIDATION_TRAILING_RATIO * leaderStrength) {
        out.push(entrant.candidateId);
      }
    }
  }
  return out;
}
