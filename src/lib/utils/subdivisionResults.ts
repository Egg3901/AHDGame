// src/lib/utils/subdivisionResults.ts
// Generic sub-region vote distribution + seat assignment.
// Multiparty generalization of the US county/CD logic; the scalar fallback
// reproduces the US Cook-PVI arithmetic exactly (Phase 2 depends on that).

export interface SubdivisionInput {
  id: string;
  name: string;
  electorate: number;
  /** PVI-like lean: negative = left, positive = right. */
  leanScalar?: number;
  /** Baseline vote share by seeded party abbreviation (e.g. "LAB"). */
  partyShares?: Record<string, number>;
}

export interface CandidateDistributionInfo {
  /** Seeded party abbreviation when a baseline exists in this region's data. */
  baselineKey?: string;
  /** PoliticalParty.economicPosition — sign drives the scalar fallback. */
  econPosition: number;
}

export interface SubdivisionVoteResult {
  id: string;
  name: string;
  votes: Record<string, number>;
  /** Winner share − runner-up share, percentage points. */
  margin: number;
  winner: string;
}

export function distributeSubdivisionVotes(
  subdivisions: SubdivisionInput[],
  regionVotes: Record<string, number>,
  candidates: Record<string, CandidateDistributionInfo>
): SubdivisionVoteResult[] {
  const totalElectorate = subdivisions.reduce((s, c) => s + c.electorate, 0);
  if (totalElectorate === 0) return [];

  const candidateIds = Object.keys(regionVotes);
  const totalRegionVotes = Object.values(regionVotes).reduce((s, v) => s + v, 0);
  if (totalRegionVotes === 0) return [];

  const regionShares: Record<string, number> = {};
  for (const cid of candidateIds) regionShares[cid] = regionVotes[cid] / totalRegionVotes;

  // Electorate-weighted mean baseline share per party across the region.
  const meanShare: Record<string, number> = {};
  for (const cid of candidateIds) {
    const key = candidates[cid]?.baselineKey;
    if (!key || key in meanShare) continue;
    let weighted = 0;
    for (const sub of subdivisions) weighted += (sub.partyShares?.[key] ?? 0) * sub.electorate;
    meanShare[key] = weighted / totalElectorate;
  }

  const raw: { id: string; name: string; votes: Record<string, number> }[] = [];
  for (const sub of subdivisions) {
    const turnout = totalRegionVotes * (sub.electorate / totalElectorate);
    const votes: Record<string, number> = {};
    for (const cid of candidateIds) {
      const info = candidates[cid] ?? { econPosition: 0 };
      const key = info.baselineKey;
      let rawShare: number;
      if (key && (meanShare[key] ?? 0) > 0) {
        rawShare = regionShares[cid] * ((sub.partyShares?.[key] ?? 0) / meanShare[key]);
      } else {
        // Scalar fallback — identical arithmetic to the US county PVI shift.
        const lean = sub.leanScalar ?? 0;
        let shift = 0;
        if (info.econPosition < 0) shift = -lean / 100;
        else if (info.econPosition > 0) shift = lean / 100;
        rawShare = Math.max(0.01, regionShares[cid] + shift);
      }
      votes[cid] = rawShare * turnout;
    }
    // Normalize within the subdivision so shares sum to its turnout.
    const subTotal = Object.values(votes).reduce((s, v) => s + v, 0);
    if (subTotal > 0) {
      for (const cid of candidateIds) votes[cid] = (votes[cid] / subTotal) * turnout;
    }
    raw.push({ id: sub.id, name: sub.name, votes });
  }

  // Normalize across subdivisions so each candidate's total matches the region exactly.
  for (const cid of candidateIds) {
    const rawTotal = raw.reduce((s, c) => s + c.votes[cid], 0);
    if (rawTotal > 0) {
      const scale = regionVotes[cid] / rawTotal;
      for (const c of raw) c.votes[cid] = Math.round(c.votes[cid] * scale);
    }
  }
  // Fix rounding drift on the largest holder.
  for (const cid of candidateIds) {
    const currentTotal = raw.reduce((s, c) => s + c.votes[cid], 0);
    const diff = regionVotes[cid] - currentTotal;
    if (diff !== 0) {
      const largest = raw.reduce((max, c) => (c.votes[cid] > max.votes[cid] ? c : max));
      largest.votes[cid] += diff;
    }
  }

  return raw.map((c) => {
    const sorted = [...candidateIds].sort((a, b) => c.votes[b] - c.votes[a]);
    const winner = sorted[0];
    const total = Object.values(c.votes).reduce((s, v) => s + v, 0);
    const margin =
      total > 0
        ? (c.votes[winner] / total) * 100 - (c.votes[sorted[1] ?? winner] / total) * 100
        : 0;
    return { id: c.id, name: c.name, votes: c.votes, margin, winner };
  });
}

/**
 * Force subdivision winners to match the game's actual seat allocation.
 * Greedy: all (subdivision, candidate) pairs sorted by that candidate's local
 * vote share; each pair claims the subdivision if the candidate still has
 * seats and the subdivision is unclaimed. Ties break on id for determinism.
 * Subdivisions left unclaimed (seat total < subdivision count) become vacant
 * (winner ""); a forced winner's margin can be negative, which renders as the
 * lightest tint.
 */
export function assignSeatConsistentWinners(
  distributed: SubdivisionVoteResult[],
  seatsByCandidate: Record<string, number>
): SubdivisionVoteResult[] {
  const remaining: Record<string, number> = { ...seatsByCandidate };
  const pairs: { id: string; cid: string; share: number }[] = [];
  for (const d of distributed) {
    const total = Object.values(d.votes).reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    for (const [cid, v] of Object.entries(d.votes)) {
      pairs.push({ id: d.id, cid, share: v / total });
    }
  }
  pairs.sort((a, b) => b.share - a.share || a.id.localeCompare(b.id) || a.cid.localeCompare(b.cid));

  const winnerById: Record<string, string> = {};
  for (const p of pairs) {
    if (winnerById[p.id] !== undefined) continue;
    if ((remaining[p.cid] ?? 0) <= 0) continue;
    winnerById[p.id] = p.cid;
    remaining[p.cid]--;
  }

  return distributed.map((d) => {
    const w = winnerById[d.id];
    if (!w) return { ...d, winner: "", margin: 0 };
    const total = Object.values(d.votes).reduce((s, v) => s + v, 0);
    const bestOther = Math.max(
      0,
      ...Object.entries(d.votes)
        .filter(([cid]) => cid !== w)
        .map(([, v]) => v)
    );
    const margin = total > 0 ? ((d.votes[w] - bestOther) / total) * 100 : 0;
    return { ...d, winner: w, margin };
  });
}

export interface LeanOrderedResult {
  id: string;
  winner: string;
  party: string;
  margin: number;
}

/**
 * Byte-identical port of assignCDSeats: order subdivisions left→right by
 * leanScalar, order candidates left→right by party economicPosition, fill
 * seats sequentially; leftover subdivisions are vacant.
 */
export function assignByLeanOrdering(
  subdivisions: SubdivisionInput[],
  seatsWon: Record<string, number>,
  candidateParties: Record<string, string>,
  partyEconPositions: Record<string, number> = {}
): LeanOrderedResult[] {
  const sorted = [...subdivisions].sort((a, b) => (a.leanScalar ?? 0) - (b.leanScalar ?? 0));

  const candidates = Object.entries(seatsWon);
  candidates.sort((a, b) => {
    const aPos = partyEconPositions[candidateParties[a[0]] ?? ""] ?? 0;
    const bPos = partyEconPositions[candidateParties[b[0]] ?? ""] ?? 0;
    return aPos - bPos;
  });

  const results: LeanOrderedResult[] = [];
  let idx = 0;
  for (const [candidateId, seats] of candidates) {
    const party = candidateParties[candidateId] ?? "independent";
    for (let i = 0; i < seats && idx < sorted.length; i++) {
      const sub = sorted[idx];
      results.push({
        id: sub.id,
        winner: candidateId,
        party,
        margin: Math.abs(sub.leanScalar ?? 0),
      });
      idx++;
    }
  }
  while (idx < sorted.length) {
    results.push({ id: sorted[idx].id, winner: "", party: "independent", margin: 0 });
    idx++;
  }
  return results;
}

/**
 * Human-readable Cook-PVI-style lean label for a subdivision.
 *
 * Convention: negative = Left, positive = Right. A value at (or within a small
 * epsilon of) zero is "Even" rather than being forced into "Right +0.0" — a
 * strict `< 0 ? "Left" : "Right"` maps exactly 0.0 to the Right, which is wrong
 * and produced misleading uniform "Lean: Right +0.0" labels (e.g. the Alaska
 * borough map when all cookPVI values were 0). Callers use `neutral` to drive
 * neutral shading for the "Even" case.
 */
export function formatLeanLabel(
  leanScalar: number,
  epsilon = 0.5
): { label: string; neutral: boolean } {
  if (!Number.isFinite(leanScalar) || Math.abs(leanScalar) < epsilon) {
    return { label: "Even", neutral: true };
  }
  const side = leanScalar < 0 ? "Left" : "Right";
  return { label: `${side} +${Math.abs(leanScalar).toFixed(1)}`, neutral: false };
}
