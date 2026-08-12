/**
 * Slate-level (party-nested) split of a demographic group's vote pool.
 *
 * Both vote-distribution engines used to split each group's pool straight
 * across CANDIDATES by relative appeal weight, then sum a party's candidates
 * back up to a party total (`partyAppealVotes` in the swing-flow engine,
 * `allocateSeats`'s party pooling at resolution). That is correct only when
 * every party fields exactly one candidate, the FPTP assumption written into
 * the §7.3.2 notes.
 *
 * In a MULTI-SEAT chamber it breaks badly: a party fielding two candidates of
 * comparable appeal takes two candidate-shares of every group's pool, so its
 * pooled total, and therefore its largest-remainder seat count, scales with
 * how many candidates it put on the ballot rather than with its support.
 * Ticket #1048: the 1953 founding House gave CA 22/30 to the party that fielded
 * two candidates (72.9% of the state's House vote) while the same electorate
 * gave that party 55-62% in every single-seat race the same turn, and mirrored
 * it in reverse in LA (a lone candidate held to 15.0% against 42% elsewhere).
 * Fielding a co-partisan was worth roughly a third of a delegation, which is
 * the exact inverse of the real vote-splitting the FPTP spoiler pass models.
 *
 * The fix: split the group pool by SLATE, where a slate's weight is the MEAN
 * of its candidates' appeal weights, then divide a slate's take among its own
 * candidates by their within-slate weight share. Slate size cancels out, so
 * ballot slots stop buying seats while slate QUALITY still matters (a weak
 * co-partisan drags the mean, a strong one lifts it).
 *
 * Independents are never pooled. Each stands as its own slate, mirroring
 * `eligibilityGroupKey` in `turn/election/seatAllocation.ts` so the eligibility
 * gate and the vote split agree on what a "party" is.
 *
 * ⚠️ Byte-identical for one-candidate-per-party races, which is every FPTP
 * family and every primary (a primary's candidates all share one party, so the
 * single slate takes the whole pool and the within-slate split reproduces the
 * old per-candidate split exactly). Each slate of size 1 has mean = its own
 * weight, the slate weights sum to the old `groupTotalWeight`, and the
 * within-slate share is 1, so the arithmetic reduces to the previous
 * expression term for term. Only multi-candidate-per-party races move, and
 * those are precisely the broken set.
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
