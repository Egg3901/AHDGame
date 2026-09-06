import { HOUSE_SEATS, UK_COMMONS_SEATS, UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants";
import { allocateBlocListSeats } from "./blocListAllocation";
import { MODERN_ERA_START_YEAR } from "@/lib/constants/monetaryEra";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";

/**
 * Minimum vote share a candidate needs to be eligible for a seat.
 *
 * State Senate uses a lower threshold (10%) because these districts are larger
 * and typically have more parties splitting the vote — small third parties can
 * win a seat with 10-15% in a crowded field. The US House threshold is higher
 * (20%) to reflect the practical reality of two-party dominance in most
 * congressional districts, preventing near-marginal candidates from claiming
 * seats with negligible vote shares via Largest Remainder rounding.
 */
export function getMultiSeatMinShare(
  electionType: string,
  opts?: {
    /**
     * True when the majoritarian winner's bonus is active for this race
     * (historical UK Commons). Lowers the Commons gate to 10% so third
     * parties enter the pool and the duopoly boost has someone to squeeze —
     * with the 20% gate the minors were deleted before the boost applied and
     * the "bonus" degenerated to plain PR (ticket #1032). 1950s-shaped:
     * Liberals hold a squeezed handful of seats instead of zero. Modern
     * (1999+) worlds never pass a bonus, so their gate is untouched.
     */
    majoritarian?: boolean;
  }
): number {
  if (opts?.majoritarian && (electionType === "commons" || electionType === "snap_commons"))
    return 0.1;
  if (
    electionType === "stateSenate" ||
    electionType === "regionalCouncil" ||
    electionType === "landtag" ||
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

/**
 * Majoritarian (FPTP-style) winner's-bonus configuration for a multi-seat
 * chamber whose real-world counterpart elects by single-member plurality.
 *
 * The game models FPTP chambers (UK Commons) as regional multi-seat races
 * allocated by Largest Remainder — near-PR. Real FPTP rewards the regional
 * plurality party beyond its vote share (winner's bonus + wasted votes).
 *
 * When this config is present, a BLOC is lifted against the rest of the pool
 * by a power law — bloc weight ∝ (bloc share)^exponent vs (rest share)^exponent.
 * The region's two leading party groups BY VOTES are full members; every other
 * group joins in proportion to how close it ran to the runner-up, tapered by
 * `taper`. Largest Remainder assignment (and therefore exact seat conservation
 * and determinism) is unchanged.
 *
 * Issue #3244; ticket #1032 softened ^3 → ^2 and guaranteed the vote leader a
 * slot; tickets #1276 / #1277 replaced the all-or-nothing pair — whose second
 * slot keyed on state ORGANIZATION and flipped between turns on a sub-point
 * difference, relocating 9 to 20 seats each time — with the votes-only taper.
 */
export interface MajoritarianBonusConfig {
  /**
   * Exponent applied to the vote-odds ratio between the top-two party groups.
   * 2 = square-law winner's bonus (current Commons default); 3 = classic
   * cube law; 1 = no amplification.
   */
  exponent: number;
  /**
   * How fast bloc membership falls away behind the runner-up (tickets #1276 /
   * #1277). A group polling `v` joins the boosted bloc with weight
   * `min(1, (v / runnerUpVotes) ^ taper)`. Defaults to
   * `UK_COMMONS_BONUS_TAPER`. Higher values squeeze third parties harder;
   * `taper → ∞` reproduces the old all-or-nothing pair.
   */
  taper?: number;
}

/** What `applyMajoritarianBonus` did, so callers can report it honestly. */
export interface MajoritarianBonusOutcome {
  /** Effective per-candidate weights. Sums to the pool's total votes. */
  effective: Map<string, number>;
  /**
   * True only when the bonus actually re-weighted the pool. False when it
   * declined — a two-party pool with nothing to squeeze, or a minority bloc
   * the BOOST-only guard protects. Display surfaces use this to decide whether
   * quota copy would be a fabrication (#1276).
   */
  applied: boolean;
}

/**
 * Winner's-bonus exponent for UK Commons FPTP-style regions.
 * Square law (^2) keeps a clear plurality advantage without the cube-law
 * wipeouts that made ~40% look like a landslide loss (ticket #1032).
 */
export const UK_COMMONS_FPTP_EXPONENT = 2;

/**
 * How fast the winner's bonus tapers away behind the runner-up.
 *
 * Calibrated in `scripts/sim/reports/ticket-1276-1277-commons-bonus-taper.md`
 * over 48 real UK Commons races and 1,248 real vote distributions. At k=3 the
 * discontinuity at the runner-up boundary collapses from a maximum of 18 seats
 * across 20 of 48 races to 1 seat in 3 (largest-remainder rounding, which is
 * irreducible), while third parties still hold only 15.0% of seats on 26.8% of
 * the vote so the FPTP squeeze survives. k=2 flattens a real 0.4-point lead to
 * a dead heat, which reads as the bonus having become plain PR.
 */
export const UK_COMMONS_BONUS_TAPER = 3;

/**
 * Resolves the majoritarian winner's-bonus config for an election type at the
 * CURRENT in-game year. DEFAULTED OFF — returns `undefined` (current
 * proportional behavior, byte-identical allocation) unless BOTH:
 *
 *  - the chamber is FPTP-style (UK Commons, incl. snap elections), AND
 *  - the current in-game year (`gameState.currentYear`) is historical:
 *    strictly before 1999 (`MODERN_ERA_START_YEAR`).
 *
 * KEYING (2026-07-17 correction): this is a RUNTIME per-election rule, so it
 * keys on the current in-game year, not the frozen seed preset. Any world's
 * historical phase gets majoritarian UK outcomes (#3244: 1950s-style majors
 * produce clearer regional winners instead of hung near-PR parliaments),
 * and the same world GRADUATES back to the established proportional shape
 * when its clock reaches 1999 — so the live 1991-default world at in-game
 * ~2015 allocates proportionally, its pre-#3244 status quo. Seat rosters,
 * tests, and player expectations on 2019/2023 worlds (year always ≥ 2019)
 * are byte-identical, as is any caller passing no year (fail-safe modern).
 */
export function getMajoritarianBonus(
  electionType: string,
  currentYear: number | null | undefined
): MajoritarianBonusConfig | undefined {
  if (electionType !== "commons" && electionType !== "snap_commons") return undefined;
  if (typeof currentYear !== "number" || !Number.isFinite(currentYear)) return undefined;
  if (currentYear >= MODERN_ERA_START_YEAR) return undefined;
  return { exponent: UK_COMMONS_FPTP_EXPONENT };
}

/**
 * Applies the power-law winner's bonus to an allocation pool, returning
 * per-candidate EFFECTIVE vote weights (same total as the input votes).
 *
 * Shape (tickets #1276 / #1277). The boosted BLOC is chosen by VOTES alone:
 * the region's leading group and the runner-up are full members, and every
 * other group joins with weight `min(1, (v / runnerUpVotes) ^ taper)`. The
 * boost is that bloc VERSUS the rest of the pool: bloc weight ∝
 * (bloc share)^exponent against (rest share)^exponent, with the remainder
 * scaled down to conserve the total. Full members all scale by the same
 * factor, so they settle in plain proportion to their compared pooled scores;
 * a tapered group sits between the boosted and squeezed scales in proportion
 * to its membership, which is what removes the discontinuity at the runner-up
 * boundary rather than relocating it.
 *
 * Pre-#1276 the second slot was the best-ORGANIZED other party, an invisible
 * stat players moved several points per turn — it flipped between consecutive
 * turns of one count and moved 9 to 20 seats each time. Pre-#1032 the boost
 * was a re-split INSIDE the top-two by pooled votes, which let three mid-tier
 * candidates out-pool one front-runner and have that lead amplified.
 *
 * Within a group, weight is distributed across the group's candidates
 * proportional to their own votes. Feeding the effective weights through the
 * existing Largest Remainder step keeps conservation, threshold exclusion and
 * determinism exactly as before. NOTE: when the eligibility gate leaves only
 * two groups in the pool every member weighs 1, the bloc IS the pool, and the
 * allocation is exactly proportional.
 */
export function applyMajoritarianBonus(
  pool: { id: string; votes: number; group: string }[],
  config: MajoritarianBonusConfig
): MajoritarianBonusOutcome {
  const effective = new Map<string, number>(pool.map((c) => [c.id, c.votes]));

  const votesByGroup = new Map<string, number>();
  for (const c of pool) {
    votesByGroup.set(c.group, (votesByGroup.get(c.group) ?? 0) + c.votes);
  }

  // Groups ranked by pooled votes; ties broken by group key for determinism.
  const ranked = [...votesByGroup.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Fewer than two contesting groups: nothing to compare, let alone squeeze.
  if (ranked.length < 2) return { effective, applied: false };

  const total = pool.reduce((s, c) => s + c.votes, 0);
  const runnerUpVotes = ranked[1][1];
  if (total <= 0 || runnerUpVotes <= 0) return { effective, applied: false };

  // Bloc membership, tapered by votes (tickets #1276 / #1277). The leader and
  // the runner-up are full members; every other group joins in proportion to
  // how close it ran to the runner-up, raised to `taper`.
  //
  // This replaces an all-or-nothing pair whose second slot was the best
  // ORGANIZED other party. Organization is live state players move several
  // points per turn, so slot 2 flipped between turns and relocated 9 to 20
  // seats each time: LON's deciding gaps were 0.27 to 1.07 points, and SCO
  // turn 647 was an exact 24.17 vs 24.17 tie broken by party id. Keying on
  // votes makes the input legible and slow-moving; tapering removes the cliff
  // rather than relocating it, so a near-tie for the runner-up slot now splits
  // the boost instead of swinging it whole.
  const taper = config.taper ?? UK_COMMONS_BONUS_TAPER;
  const membership = new Map<string, number>();
  for (const [group, votes] of ranked) {
    const isPrincipal = group === ranked[0][0] || group === ranked[1][0];
    membership.set(group, isPrincipal ? 1 : Math.min(1, Math.pow(votes / runnerUpVotes, taper)));
  }

  // Bloc mass. With only two contesting groups every member weighs 1, so this
  // equals the pool and `rest` below is zero: the allocation stays exactly
  // proportional. That is the two-party fall-through (ticket #1032's NWE
  // shape) preserved by construction rather than by special-casing.
  const blocVotes = ranked.reduce((s, [group, votes]) => s + membership.get(group)! * votes, 0);
  const restVotes = total - blocVotes;
  if (restVotes <= 0 || blocVotes <= 0) return { effective, applied: false };

  // Power law of the bloc AGAINST the rest of the pool: bloc weight ∝
  // (bloc share)^exponent vs (rest share)^exponent, total conserved. Work on
  // the normalized share for numerical stability.
  const sBloc = blocVotes / total;
  const wBloc = Math.pow(sBloc, config.exponent);
  const wRest = Math.pow(1 - sBloc, config.exponent);
  const targetBloc = (total * wBloc) / (wBloc + wRest);
  // BOOST only: a minority bloc polling under half the pool is left at its
  // proportional share, never shrunk below it — the bonus must benefit the
  // leading parties, not punish them for a bad night.
  if (targetBloc <= blocVotes) return { effective, applied: false };

  // Full members scale by `scaleBloc`, non-members by `scaleRest`, and a
  // tapered group sits between the two in proportion to its membership. The
  // two scales are chosen so the total is conserved exactly, which keeps
  // largest remainder, seat conservation and determinism untouched.
  const scaleBloc = targetBloc / blocVotes;
  const scaleRest = (total - targetBloc) / restVotes;
  for (const c of pool) {
    const w = membership.get(c.group) ?? 0;
    effective.set(c.id, c.votes * (w * scaleBloc + (1 - w) * scaleRest));
  }
  return { effective, applied: true };
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
  majoritarianBonus?: MajoritarianBonusConfig,
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
    // the eligibility / threshold / majoritarian machinery below applies. There
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
    const minShare = getMultiSeatMinShare(electionType, {
      majoritarian: majoritarianBonus !== undefined,
    });
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
      // Sub-threshold candidates are never re-admitted alongside eligible
      // ones. The old rule (`eligible.length >= min(seats, ranked.length)`)
      // re-admitted EVERYONE whenever there were fewer candidates than seats
      // — with 12 candidates and 27-90 seats a 0.8% fringe candidate always
      // got its 0.6-seat largest remainder rounded up to a real seat. The
      // fallback survives only for the degenerate case where NO candidate
      // clears the threshold: fill in ranked order.
      const minPoolSize = Math.min(authoritativeSeats, ranked.length);
      const allocationPool = eligible.length > 0 ? eligible : ranked.slice(0, minPoolSize);
      const poolVotes = allocationPool.reduce((sum, { votes }) => sum + votes, 0);

      if (allocationPool.length === 1 || poolVotes === 0) {
        // Only give all seats to one candidate if they're truly the only option
        seatsEstimate[allocationPool[0].id] = authoritativeSeats;
      } else {
        // FPTP winner's bonus (#3244): when configured, re-weight the pool by
        // tapered bloc membership before Largest Remainder. Effective weights
        // sum to poolVotes, so the LR step below (and its exact seat
        // conservation) is untouched. No config → undefined → identical to the
        // historical proportional path.
        const effectiveVotes = majoritarianBonus
          ? applyMajoritarianBonus(
              allocationPool.map((c) => ({
                id: c.id,
                votes: c.votes,
                group: eligibilityGroupKey(c),
              })),
              majoritarianBonus
            ).effective
          : undefined;
        const raw = allocationPool.map(({ id, votes }) => ({
          id,
          exact: ((effectiveVotes?.get(id) ?? votes) / poolVotes) * authoritativeSeats,
        }));
        const assigned = raw.map(({ id, exact }) => ({
          id,
          seats: Math.floor(exact),
          remainder: exact % 1,
        }));
        const remaining = authoritativeSeats - assigned.reduce((s, a) => s + a.seats, 0);
        assigned.sort((a, b) => b.remainder - a.remainder);
        for (let i = 0; i < remaining; i++) assigned[i % assigned.length].seats++;
        for (const a of assigned) seatsEstimate[a.id] = a.seats;
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
