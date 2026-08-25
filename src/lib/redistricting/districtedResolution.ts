import { largestRemainderAllocate } from "./budget";
import type { Pool } from "./pools";

/** How hard the district lean shifts the statewide baseline. 1.0 ⇒ a 16-0
 *  district is a guaranteed seat (loser pool multiplier hits 0). */
export const LEAN_STRENGTH = 1.0;

export interface Nominee {
  candidateId: string;
  sharePct: number;
}

/** Sum statewide candidate votes into per-party baselines. */
export function computePartyBaselines(
  candidateVotes: Record<string, number>,
  candidateParty: Record<string, string>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cid, v] of Object.entries(candidateVotes)) {
    const party = candidateParty[cid];
    if (!party) continue;
    out[party] = (out[party] ?? 0) + v;
  }
  return out;
}

function poolDir(p: Pool): number {
  return p === "right" ? 1 : p === "left" ? -1 : 0;
}

/** A party's strength in one district: statewide baseline shifted by the square
 *  lean (grey pools are lean-invariant), scaled by any Campaign Here boost. */
function districtScore(baseline: number, pool: Pool, netLean: number, boost?: number): number {
  const shift = netLean / 16; // -1..+1
  const mult = Math.max(0, 1 + poolDir(pool) * shift * LEAN_STRENGTH);
  return baseline * mult * (1 + (boost ?? 0) / 100);
}

/** Winner party of one district: statewide baseline shifted by the square lean,
 *  then scaled by any Campaign Here boost for that party in this district. */
export function districtWinnerParty(
  baselines: Record<string, number>,
  partyPool: Record<string, Pool>,
  netLean: number,
  boosts?: Record<string, number>
): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const party of Object.keys(baselines).sort()) {
    const score = districtScore(
      baselines[party],
      partyPool[party] ?? "grey",
      netLean,
      boosts?.[party]
    );
    if (score > bestScore) {
      bestScore = score;
      best = party;
    }
  }
  return best;
}

/**
 * Proportional party seat quotas for a districted state. Each party's share of
 * the statewide vote maps to a whole-seat count via largest remainder, gated by
 * `minShare`. The quotas sum to exactly `authoritativeSeats`, so district lean /
 * gerrymandering redistribute WHICH districts a party wins — never HOW MANY.
 * This is what prevents a statewide plurality (or a lean-invariant centrist
 * party) from sweeping every district.
 *
 * Eligibility matches `allocateSeats` and `computeSeatEstimates` exactly: a
 * party below the floor is dropped, and the field falls back to the top
 * `min(seats, parties)` ONLY in the degenerate case where nobody clears it.
 *
 * This path used to keep the older rule — re-admit EVERY party whenever fewer
 * cleared the floor than `min(seats, parties)`. Multi-seat states almost always
 * have more seats than parties, so that condition demanded a clean sweep of the
 * gate and therefore almost never held: the districted resolver effectively
 * applied no threshold, and parties polling a few percent collected
 * largest-remainder seats that both other allocators zero. #1032 removed the
 * rule from them and left this copy behind, so the districted projection and
 * the districted RESULT disagreed with the rest of the engine (#1190: a
 * candidate on 89% of Alabama was projected 7 of 8 seats, with the eighth going
 * to a party on 7.3%).
 */
export function computePartySeatQuotas(
  baselines: Record<string, number>,
  authoritativeSeats: number,
  minShare: number
): Record<string, number> {
  const parties = Object.keys(baselines);
  const out: Record<string, number> = {};
  for (const p of parties) out[p] = 0;
  if (parties.length === 0 || authoritativeSeats <= 0) return out;

  const total = parties.reduce((s, p) => s + Math.max(0, baselines[p]), 0);
  if (total <= 0) return out;

  const eligible = parties.filter((p) => baselines[p] / total >= minShare);
  const pool =
    eligible.length > 0
      ? eligible
      : [...parties]
          .sort((a, b) => baselines[b] - baselines[a])
          .slice(0, Math.min(authoritativeSeats, parties.length));

  const counts = largestRemainderAllocate(
    authoritativeSeats,
    pool.map((p) => baselines[p])
  );
  pool.forEach((p, i) => {
    out[p] = counts[i];
  });
  return out;
}

/**
 * Place each party's quota of seats into the districts where it is strongest
 * (baseline shifted by district lean + Campaign Here boost), one winner per
 * district. Greedy by descending district-party score, then a fill pass drops
 * any leftover district to the best-scoring party that still has an open seat.
 * Because the quotas sum to the district count, every district is assigned
 * exactly once and every quota is consumed. Deterministic tie-break: higher
 * score, then party name, then district index.
 */
export function assignPartiesToDistrictsByQuota(
  districts: { index: number; netLean: number }[],
  baselines: Record<string, number>,
  partyPool: Record<string, Pool>,
  quotas: Record<string, number>,
  boostsByDistrict?: Record<string, Record<string, number>>
): { index: number; party: string; netLean: number }[] {
  const remaining: Record<string, number> = { ...quotas };
  const scoreFor = (party: string, d: { index: number; netLean: number }) =>
    districtScore(
      baselines[party] ?? 0,
      partyPool[party] ?? "grey",
      d.netLean,
      boostsByDistrict?.[String(d.index)]?.[party]
    );

  const triples: { index: number; netLean: number; party: string; score: number }[] = [];
  for (const d of districts) {
    for (const party of Object.keys(quotas)) {
      if ((quotas[party] ?? 0) <= 0) continue;
      triples.push({ index: d.index, netLean: d.netLean, party, score: scoreFor(party, d) });
    }
  }
  triples.sort(
    (a, b) =>
      b.score - a.score || (a.party < b.party ? -1 : a.party > b.party ? 1 : 0) || a.index - b.index
  );

  const assigned = new Map<number, { party: string; netLean: number }>();
  for (const t of triples) {
    if (assigned.has(t.index)) continue;
    if ((remaining[t.party] ?? 0) <= 0) continue;
    assigned.set(t.index, { party: t.party, netLean: t.netLean });
    remaining[t.party] -= 1;
  }

  // Fill pass: a district whose highest-scoring parties all exhausted their
  // quota falls to the best-scoring party that still has an open seat.
  for (const d of districts) {
    if (assigned.has(d.index)) continue;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const party of Object.keys(remaining)) {
      if ((remaining[party] ?? 0) <= 0) continue;
      const s = scoreFor(party, d);
      if (s > bestScore || (s === bestScore && best !== null && party < best)) {
        bestScore = s;
        best = party;
      }
    }
    if (best) {
      assigned.set(d.index, { party: best, netLean: d.netLean });
      remaining[best] -= 1;
    }
  }

  return [...assigned.entries()].map(([index, v]) => ({
    index,
    party: v.party,
    netLean: v.netLean,
  }));
}

/**
 * Assign each party's won districts to its primary survivors by share.
 * Strongest survivor → most competitive won districts (smallest |netLean|).
 */
export function assignDistrictsToNominees(
  districts: { index: number; party: string; netLean: number }[],
  nomineesByParty: Record<string, Nominee[]>
): Map<number, string> {
  const assignment = new Map<number, string>();
  // Group won districts by party.
  const byParty = new Map<string, { index: number; netLean: number }[]>();
  for (const d of districts) {
    const arr = byParty.get(d.party) ?? [];
    arr.push({ index: d.index, netLean: d.netLean });
    byParty.set(d.party, arr);
  }

  for (const [party, won] of byParty) {
    const nominees = [...(nomineesByParty[party] ?? [])].sort((a, b) => b.sharePct - a.sharePct);
    if (nominees.length === 0) continue;
    // Most competitive first (smallest |netLean|).
    const ordered = [...won].sort((a, b) => Math.abs(a.netLean) - Math.abs(b.netLean));
    // How many districts each nominee gets, by share, summing to won.length.
    const counts = largestRemainderAllocate(
      ordered.length,
      nominees.map((n) => n.sharePct)
    );
    let cursor = 0;
    nominees.forEach((nom, i) => {
      for (let k = 0; k < counts[i]; k++) {
        const d = ordered[cursor++];
        if (d) assignment.set(d.index, nom.candidateId);
      }
    });
  }
  return assignment;
}
