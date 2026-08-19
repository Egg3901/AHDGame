/**
 * Slate-level (party-nested) split of a demographic group's vote pool.
 *
 * A straight per-candidate split lets a party fielding two comparable
 * candidates take two shares of every group's pool, so seat count scales with
 * ballot slots rather than support. Split by SLATE instead: a slate's weight
 * is the MEAN of its candidates' appeal weights, then divide the slate's take
 * among its own candidates by within-slate weight share. Slate size cancels;
 * slate quality still matters (a weak co-partisan drags the mean).
 *
 * Independents are never pooled. Each stands as its own slate, mirroring
 * `eligibilityGroupKey` in `turn/election/seatAllocation.ts` so the eligibility
 * gate and the vote split agree on what a "party" is.
 *
 * Byte-identical for one-candidate-per-party races (every FPTP family and
 * every primary). Only multi-candidate-per-party races move.
 */

/** Slate key: same-party candidates pool; independents stand alone. */
export function slateKey(party: string | undefined, candidateId: string): string {
  return party && party !== "independent" ? `party:${party}` : `cand:${candidateId}`;
}

export interface SlateSplitMember {
  candidateId: string;
  party?: string;
  /** Per-candidate appeal weight for this group, as computed by the engine. */
  weight: number;
}

/**
 * Split `groupPool` across `members` by slate, returning per-candidate votes.
 *
 * Returns an even per-candidate split when every weight is zero, matching the
 * `groupTotalWeight <= 0` fallback both engines already used.
 */
export function splitGroupPoolBySlate(
  groupPool: number,
  members: SlateSplitMember[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) out[m.candidateId] = 0;
  if (members.length === 0) return out;

  const memberIdsBySlate = new Map<string, string[]>();
  const weightSumBySlate = new Map<string, number>();
  const weightByCandidate = new Map<string, number>();

  for (const m of members) {
    const key = slateKey(m.party, m.candidateId);
    const ids = memberIdsBySlate.get(key);
    if (ids) ids.push(m.candidateId);
    else memberIdsBySlate.set(key, [m.candidateId]);
    weightSumBySlate.set(key, (weightSumBySlate.get(key) ?? 0) + m.weight);
    weightByCandidate.set(m.candidateId, m.weight);
  }

  // A slate's weight is the MEAN of its candidates' weights, so slate size
  // cancels and only slate quality moves the share.
  let totalSlateWeight = 0;
  const slateWeight = new Map<string, number>();
  for (const [key, ids] of memberIdsBySlate) {
    const mean = (weightSumBySlate.get(key) ?? 0) / ids.length;
    slateWeight.set(key, mean);
    totalSlateWeight += mean;
  }

  if (totalSlateWeight <= 0) {
    for (const m of members) out[m.candidateId] = groupPool / members.length;
    return out;
  }

  for (const [key, ids] of memberIdsBySlate) {
    const slatePool = groupPool * ((slateWeight.get(key) ?? 0) / totalSlateWeight);
    const sum = weightSumBySlate.get(key) ?? 0;
    for (const id of ids) {
      // A slate whose members all weigh 0 still splits its (zero) pool evenly
      // rather than dividing by zero.
      const within = sum > 0 ? (weightByCandidate.get(id) ?? 0) / sum : 1 / ids.length;
      out[id] = slatePool * within;
    }
  }

  return out;
}
