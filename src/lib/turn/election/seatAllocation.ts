import { HOUSE_SEATS, UK_COMMONS_SEATS, UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants";
import { allocateBlocListSeats } from "./blocListAllocation";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";

/**
 * Minimum vote share an eligibility group needs to enter the seat pool. Party
 * candidates are grouped together; independents and party-less candidates are
 * evaluated individually.
 *
 * State Senate and UK Commons use a lower threshold (10%) because these
 * districts elect many seats and typically have more parties splitting the
 * vote. The US House threshold is higher (20%) to reflect the practical reality
 * of two-party dominance in most congressional districts, preventing
 * near-marginal candidates from claiming seats with negligible vote shares via
 * Largest Remainder rounding.
 */
export function getMultiSeatMinShare(electionType: string): number {
  if (
    electionType === "stateSenate" ||
    electionType === "regionalCouncil" ||
    electionType === "landtag" ||
    // UK Commons regions elect large delegations and commonly field several
    // candidates per party. A 20% party gate creates an excessive cliff in a
    // competitive five-party race, where a party near one fifth of the vote
    // can otherwise receive no representation at all.
    electionType === "commons" ||
    electionType === "snap_commons" ||
    // CN Provincial People's Congress: lower threshold so CDL / CNDCA
    // token candidates with ~2-5% can hold a few seats even when CCP
    // dominates the field.
    electionType === "peoplesCongress" ||
    // IE PR-STV chambers: Dáil constituencies average ~20 seats per region
    // (~5% Hare quota), Seanad ~7.5 (~13% quota), Local Councils 12-62
    // (~2-8% quota). A 20% gate would lock out smaller parties (Greens,
    // SocDems, Aontú) that realistically seat at these district sizes.
    electionType === "dail" ||
    electionType === "seanad" ||
    electionType === "localCouncil" ||
    // Large-magnitude PR lower chambers (FR/IT/ES/SE/TR, #3239): regional
    // district magnitudes run ~15-90 seats, so Hare quotas sit well below a
    // 20% gate — use the same 10% gate as the Dáil family.
    electionType === "assembleeNationale" ||
    electionType === "cameraDeputati" ||
    electionType === "congresoDiputados" ||
    electionType === "riksdag" ||
    electionType === "milletMeclisi" ||
    // AT/FI/GR lower chambers: same regional-PR shape and magnitudes as the
    // FR/IT/ES family above.
    electionType === "nationalrat" ||
    electionType === "eduskunta" ||
    electionType === "vouli" ||
    // DD Volkskammer: the National Front's 5-party bloc list (SED + captive
    // CDU/LDPD/NDPD/DBD, ddParties.ts) guarantees every bloc partner a
    // representation — the historical system never let a 20% gate zero one
    // out. Observed founding-cycle vote shares split ~14-30% across the 5
    // candidates; a 20% gate would exclude 2-3 of them from every region's
    // allocation pool (issue #3896). Same gate for Land assemblies.
    electionType === "volkskammerDeputy" ||
    electionType === "landAssembly"
  )
    return 0.1;
  return 0.2;
}

export interface RankedCandidate {
  id: string;
  votes: number;
  /**
   * Party identifier (optional). When present, the minimum-share eligibility
   * gate is computed on the PARTY's aggregate share — all same-party
   * candidates' votes pooled — instead of the candidate's individual share.
   * "independent" (and missing) parties are never pooled: each such candidate
   * remains its own eligibility group, which reproduces the legacy
   * per-candidate behavior for callers that don't pass a party.
   */
  party?: string;
}

/**
 * Eligibility group for the minimum-share gate: same-party candidates pool
 * their votes; independents / party-less candidates stand alone.
 */
function eligibilityGroupKey(c: RankedCandidate): string {
  return c.party && c.party !== "independent" ? `party:${c.party}` : `cand:${c.id}`;
}

// ---------------------------------------------------------------------------
// Shared apportionment core (#585)
// ---------------------------------------------------------------------------

/** A candidate entering apportionment: an id, its votes, and its party (if any). */
export interface ApportionmentCandidate {
  id: string;
  votes: number;
  party?: string | null;
}

export interface LargestRemainderOptions {
  /** Minimum party-pooled vote share to enter the allocation pool. */
  minShare: number;
  /**
   * Denominator for the eligibility gate. The resolver measures against all
   * votes cast in the race; the projection measures against active-candidate
   * votes only. Those are legitimately different numbers, so the caller owns it.
   */
  totalVotesForShare: number;
}

export interface LargestRemainderResult {
  /** Seats per candidate id. Every input id is present; non-pool ids are 0. */
  seats: Record<string, number>;
  /** Candidate ids that entered the allocation pool, in pool order. */
  poolIds: string[];
  /** Summed votes of the allocation pool. Zero means nothing was allocated. */
  poolVotes: number;
  /** True when the eligibility gate admitted nobody and ranked order was used. */
  usedFallback: boolean;
}

/**
 * The one implementation of the multi-seat apportionment rule: party-pooled
 * minimum-share eligibility, the degenerate ranked-order fallback, and
 * Hamilton / Largest-Remainder assignment.
 *
 * This existed twice — once in `allocateSeats` (what resolves a race) and once
 * in `computeSeatEstimates` (what players are shown before one). They must
 * agree exactly or the projected seats differ from the seats the race resolves
 * to, and they had already drifted twice (ticket #1032): the projection gated
 * per candidate where resolution pooled by party, and its fallback re-admitted
 * every candidate in ~11 of 12 Commons regions, so no threshold applied at all.
 * Both were repaired by re-coding the copy rather than sharing it, which left
 * the same drift available on the next eligibility or LR change.
 *
 * Callers keep their own surrounding concerns: the resolver's bloc-list path,
 * 2-seat House rule, over-allocation cap and single-seat path stay in
 * `allocateSeats`; the projection's multi-seat gate and null returns stay in
 * `computeSeatEstimates`.
 */
export function largestRemainderSeats(
  candidates: ReadonlyArray<ApportionmentCandidate>,
  totalSeats: number,
  opts: LargestRemainderOptions
): LargestRemainderResult {
  const seats: Record<string, number> = {};
  for (const c of candidates) seats[c.id] = 0;
  if (candidates.length === 0 || totalSeats <= 0) {
    return { seats, poolIds: [], poolVotes: 0, usedFallback: false };
  }

  const groupKey = (c: ApportionmentCandidate) =>
    c.party && c.party !== "independent" ? `party:${c.party}` : `cand:${c.id}`;

  // Same-party candidates pool their votes against the threshold, so a party
  // splitting 22% across two candidates clears a 20% gate while a 0.8% fringe
  // candidate cannot.
  const votesByGroup = new Map<string, number>();
  for (const c of candidates) {
    const k = groupKey(c);
    votesByGroup.set(k, (votesByGroup.get(k) ?? 0) + c.votes);
  }
  const eligible =
    opts.totalVotesForShare > 0
      ? candidates.filter(
          (c) => (votesByGroup.get(groupKey(c)) ?? 0) / opts.totalVotesForShare >= opts.minShare
        )
      : [];

  // Sub-threshold candidates are never re-admitted alongside eligible ones.
  // The fallback survives only for the degenerate case where NOBODY clears the
  // gate: fill in ranked order.
  const usedFallback = eligible.length === 0;
  const pool = usedFallback
    ? [...candidates]
        .sort((a, b) => b.votes - a.votes)
        .slice(0, Math.min(totalSeats, candidates.length))
    : eligible;

  const poolVotes = pool.reduce((sum, c) => sum + c.votes, 0);
  if (pool.length === 0 || poolVotes === 0) {
    return { seats, poolIds: pool.map((c) => c.id), poolVotes, usedFallback };
  }

  const assigned = pool.map((c) => {
    const exact = (c.votes / poolVotes) * totalSeats;
    return { id: c.id, seats: Math.floor(exact), remainder: exact % 1 };
  });
  const remaining = totalSeats - assigned.reduce((s, a) => s + a.seats, 0);
  assigned.sort((a, b) => b.remainder - a.remainder);
  // Wraps: LR guarantees `remaining < pool.length`, but wrapping keeps every
  // seat assigned rather than silently dropping any if that ever stops holding.
  for (let i = 0; i < remaining; i++) assigned[i % assigned.length].seats++;
  for (const a of assigned) seats[a.id] = a.seats;

  return { seats, poolIds: pool.map((c) => c.id), poolVotes, usedFallback };
}

export interface SeatAllocationResult {
  isMultiSeat: boolean;
  authoritativeSeats: number;
  seatsEstimate: Record<string, number>;
  winners: [string, number][];
  losers: string[];
}

/**
 * Allocate seats proportionally (Largest Remainder method) for multi-seat races,
 * or assign a single seat to the top vote-getter for single-seat races.
 */
export function allocateSeats(
  electionType: string,
  state: string | undefined,
  totalSeats: number,
  ranked: RankedCandidate[],
  totalVotesCast: number,
  houseSeats: Record<string, number> = HOUSE_SEATS,
  /**
   * Bloc-list quota (party sequentialId to share) for National Front chambers.
   * When supplied on a multi-seat race the party split comes from the quota
   * instead of the vote, and only the split INSIDE each party's block is
   * decided by votes. See `@/lib/turn/election/blocListAllocation`. Undefined
   * (every country but the DDR today) leaves the proportional path untouched.
   */
  blocListShares?: Readonly<Record<string, number>>,
  /**
   * Preset-aware Commons seat map. Defaults to the modern 650-seat
   * `UK_COMMONS_SEATS`; pass `getUkCommonsSeats(preset)` so a 1953 world
   * allocates the 625-seat redistribution (ticket #1058).
   */
  commonsSeats: Record<string, number> = UK_COMMONS_SEATS
): SeatAllocationResult {
  // "senate" is single-seat for the US (one seat per class per state, always
  // totalSeats=1). Nigeria's Senate is a multi-seat-per-zone body (18-21 seats),
  // so a "senate" race carrying more than one seat is allocated proportionally
  // like any other multi-seat chamber (#912/NG — without this NG senate zones
  // only ever seated 1 winner). US senate is unaffected (totalSeats stays 1).
  const isMultiSeat =
    MULTI_SEAT_TYPES.has(electionType) || (electionType === "senate" && totalSeats > 1);

  // Use authoritative seat count for House/Commons to prevent over-allocation.
  // `houseSeats` defaults to the 2020-census `HOUSE_SEATS`; pass
  // `getHouseSeats(preset)` to allocate with the active preset's apportionment
  // (e.g. the 1990 census for a 1991 game). Commons likewise: pass
  // `getUkCommonsSeats(preset)` so 1953 worlds do not seat the modern 650 map.
  const authoritativeSeats =
    electionType === "house"
      ? (houseSeats[state!] ?? totalSeats)
      : electionType === "commons" || electionType === "snap_commons"
        ? (commonsSeats[state!] ?? totalSeats)
        : electionType === "regionalCouncil"
          ? (UK_REGIONAL_COUNCIL_SEATS[state!] ?? totalSeats)
          : totalSeats;

  const seatsEstimate: Record<string, number> = {};

  if (isMultiSeat && blocListShares) {
    // Bloc-list chamber: the quota decides the party split outright, so none of
    // the eligibility and threshold machinery below applies. There
    // is no cross-party contest to threshold.
    const blocSeats = allocateBlocListSeats(authoritativeSeats, blocListShares, ranked);
    for (const { id } of ranked) seatsEstimate[id] = blocSeats[id] ?? 0;
  } else if (isMultiSeat) {
    for (const { id } of ranked) seatsEstimate[id] = 0;

    // Eligibility is a PARTY-level gate when `party` is provided: same-party
    // candidates pool their votes against the threshold, so a party splitting
    // 22% across two candidates clears a 20% gate while a 0.8% fringe
    // candidate can no longer sneak in. Callers without party data fall back
    // to the legacy per-candidate share.
    const minShare = getMultiSeatMinShare(electionType);
    const votesByGroup = new Map<string, number>();
    for (const c of ranked) {
      const k = eligibilityGroupKey(c);
      votesByGroup.set(k, (votesByGroup.get(k) ?? 0) + c.votes);
    }
    const eligible = ranked.filter(
      (c) => (votesByGroup.get(eligibilityGroupKey(c)) ?? 0) / totalVotesCast >= minShare
    );

    // 2-seat House: winner takes both when no opponent reaches threshold; otherwise split 1-1.
    if (electionType === "house" && authoritativeSeats === 2) {
      if (eligible.length >= 2) {
        seatsEstimate[eligible[0].id] = 1;
        seatsEstimate[eligible[1].id] = 1;
      } else {
        seatsEstimate[ranked[0].id] = 2;
      }
    } else {
      // Eligibility, the degenerate ranked-order fallback and Largest Remainder
      // all live in `largestRemainderSeats` so the
      // projection engine runs the identical rule (#585).
      const { seats, poolIds, poolVotes } = largestRemainderSeats(ranked, authoritativeSeats, {
        minShare,
        totalVotesForShare: totalVotesCast,
      });
      if (poolIds.length === 1 || poolVotes === 0) {
        // Only give all seats to one candidate if they're truly the only
        // option. A zero-vote pool cannot be apportioned at all, so seat the
        // leading candidate rather than nobody.
        seatsEstimate[poolIds[0] ?? ranked[0].id] = authoritativeSeats;
      } else {
        for (const [id, count] of Object.entries(seats)) seatsEstimate[id] = count;
      }
    }

    // Safety check: ensure total allocated seats doesn't exceed authoritative count
    const totalAllocated = Object.values(seatsEstimate).reduce((s, v) => s + v, 0);
    if (totalAllocated > authoritativeSeats) {
      console.warn(
        `[Turn] Election (${electionType}/${state}): allocated ${totalAllocated} seats but state only has ${authoritativeSeats}. Capping.`
      );
      // Scale down proportionally
      const scale = authoritativeSeats / totalAllocated;
      let allocated = 0;
      const entries = Object.entries(seatsEstimate)
        .filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [id, seats] of entries) {
        const scaled = Math.floor(seats * scale);
        seatsEstimate[id] = scaled;
        allocated += scaled;
      }
      // Give remaining to top candidates
      let remaining = authoritativeSeats - allocated;
      for (const [id] of entries) {
        if (remaining <= 0) break;
        seatsEstimate[id]++;
        remaining--;
      }
    }
  } else {
    seatsEstimate[ranked[0].id] = 1;
    for (let i = 1; i < ranked.length; i++) seatsEstimate[ranked[i].id] = 0;
  }

  const winners: [string, number][] = isMultiSeat
    ? (Object.entries(seatsEstimate).filter(([, s]) => s > 0) as [string, number][])
    : [[ranked[0].id, 1]];

  const losers: string[] = isMultiSeat
    ? Object.entries(seatsEstimate)
        .filter(([, s]) => s === 0)
        .map(([id]) => id)
    : ranked.slice(1).map((r) => r.id);

  return { isMultiSeat, authoritativeSeats, seatsEstimate, winners, losers };
}
