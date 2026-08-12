/**
 * Bloc-list seat allocation — the National Front model.
 *
 * In a bloc-list chamber the party split is NOT an outcome of the vote. Each
 * party carries a negotiated quota (see `@/lib/constants/blocList`), and the
 * election only decides how that party's own slate divides its slots. This is
 * the DDR Volkskammer and, structurally, every single-list Eastern-bloc
 * assembly: one list, agreed shares, a vote that ratifies rather than chooses.
 *
 * Two properties the ordinary proportional path cannot give us:
 *
 *  1. The party split is unbreakable by candidate positioning. Under PR plus a
 *     ruling-party vote multiplier, a well-fitted bloc-party candidate out-polls
 *     the ruling party and takes the chamber with it, which is exactly what the
 *     live 1953 world was about to do (LDPD 35.9% against SED 19.1%). Quota
 *     allocation has no such failure mode because the vote never touches the
 *     split.
 *  2. The intra-party contest still decides everything inside a party's block,
 *     which is the contest DDR politics actually had.
 *
 * SEAT REPRESENTATION. Following `allocateSeats`, a candidate holds a BLOCK of
 * seats rather than a single seat: a race with `totalSeats: 90` and four
 * candidates returns four counts summing to 90. Both stages here are therefore
 * largest-remainder splits (quota across parties, then a party's block across
 * its own candidates), and both conserve their total exactly.
 *
 * Pure and deterministic; ties break on the caller's stable ranking.
 */

import type { RankedCandidate } from "./seatAllocation";

/**
 * Largest-remainder split of `total` across weighted keys. Exact-sum: the
 * returned counts always sum to `total` when `total > 0` and some weight is
 * positive. Shared by both stages.
 */
function largestRemainder(total: number, weights: ReadonlyArray<{ key: string; weight: number }>) {
  const out = new Map<string, number>();
  const positive = weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  if (total <= 0 || positive.length === 0) {
    // Degenerate: no usable weights. Spread evenly so seats are never lost.
    if (total > 0 && weights.length > 0) {
      for (let i = 0; i < total; i++) {
        const k = weights[i % weights.length].key;
        out.set(k, (out.get(k) ?? 0) + 1);
      }
    }
    return out;
  }

  const totalWeight = positive.reduce((s, x) => s + x.weight, 0);
  const raw = positive.map((x) => {
    const exact = (x.weight / totalWeight) * total;
    return { key: x.key, seats: Math.floor(exact), remainder: exact % 1 };
  });
  let assigned = raw.reduce((s, r) => s + r.seats, 0);
  // Stable ordering: largest fractional part first, key as the tiebreak, so the
  // same inputs always produce the same chamber.
  raw.sort((a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (let i = 0; assigned < total; i++, assigned++) raw[i % raw.length].seats++;
  for (const r of raw) if (r.seats > 0) out.set(r.key, r.seats);
  return out;
}

/**
 * Allocate `totalSeats` by bloc-list quota.
 *
 * @param totalSeats  seats in this race
 * @param quotaShares party sequentialId (string) to quota weight; normalised
 * @param ranked      candidates, highest votes first
 * @returns candidateId to seat count, covering every candidate in `ranked`
 *
 * Parties absent from the quota receive nothing: an unsanctioned party cannot
 * appear on the National Front list at all, which is the point of the list.
 * Their candidates are returned with 0 rather than omitted, so callers can
 * present a complete result.
 *
 * A quota party that fielded nobody has its share redistributed across the
 * parties that did, in proportion to their own quotas, rather than leaving the
 * chamber short.
 */
export function allocateBlocListSeats(
  totalSeats: number,
  quotaShares: Readonly<Record<string, number>>,
  ranked: ReadonlyArray<RankedCandidate>
): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const c of ranked) seats[c.id] = 0;
  if (totalSeats <= 0 || ranked.length === 0) return seats;

  // Group the sanctioned candidates by party, preserving vote-descending order.
  const byParty = new Map<string, RankedCandidate[]>();
  for (const c of ranked) {
    const party = c.party;
    if (!party) continue;
    const weight = quotaShares[party];
    if (!Number.isFinite(weight) || weight <= 0) continue;
    byParty.set(party, [...(byParty.get(party) ?? []), c]);
  }
  // No sanctioned candidate stood: nobody is seated. The caller decides whether
  // that is a failed list; this function does not invent a winner.
  if (byParty.size === 0) return seats;

  // Stage 1: the quota, over the parties that actually fielded a slate.
  const perParty = largestRemainder(
    totalSeats,
    [...byParty.keys()].map((party) => ({ key: party, weight: quotaShares[party] }))
  );

  // Stage 2: each party's block, over its own candidates by vote.
  for (const [party, blockSeats] of perParty) {
    const cands = byParty.get(party) ?? [];
    if (cands.length === 0 || blockSeats <= 0) continue;
    if (cands.length === 1) {
      seats[cands[0].id] = blockSeats;
      continue;
    }
    const within = largestRemainder(
      blockSeats,
      cands.map((c) => ({ key: c.id, weight: Math.max(0, c.votes) }))
    );
    for (const [id, n] of within) seats[id] = n;
  }
  return seats;
}
