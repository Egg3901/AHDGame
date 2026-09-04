/**
 * Per-state presidential primary projection.
 *
 * Works exactly like a general election simulated inside each state — the same
 * `distributeVotesByGroupLevelAllocation` pipeline the stagger phase uses,
 * just filtered to the intra-party candidates. That means primaries ARE
 * per-state elections: demographic blocs compete candidate-by-candidate via
 * (appeal × reach × approval × partyOrg × partyInfluence), with party org acting
 * as a shared mobilization scalar (it does not differentiate same-party
 * candidates, which is correct — differentiation comes from appeal, reach,
 * favorability, party influence, and the explicit campaign bonuses below).
 *
 * On top of the vote distribution we apply:
 *   - In-state campaigning tick multiplier (matches stagger behavior)
 *   - Home-state surge multiplier (matches stagger behavior)
 *   - Extra NPP penalty when a player is in the race (matches stagger)
 *
 * Home-state boost lives inside `distributeVotesByGroupLevelAllocation`
 * (`HOME_STATE_BONUS_PRIMARY`) via `homeStateByCandidate` — do not double-apply
 * it here or projection over-favors home-state candidates vs live results.
 *
 * Used to color the per-party primary map pre-stagger and on the per-state
 * detail page for candidates who haven't voted yet.
 */

import type { DemographicCategory, StateDemographics, State } from "@/lib/db/types";
import {
  distributeVotesByGroupLevelAllocation,
  type EnrichedCandidate,
} from "@/lib/electionEngine";
import {
  PRIMARY_CAMPAIGN_STAGGER_TICK_RATE,
  homeStateSurgeMultiplier,
  NPP_STAGGER_EXTRA_MULTIPLIER,
} from "@/lib/electionEngine/constants";
import { supportMoodMultiplier } from "@/lib/electionEngine/electionFormulaFactors";
import { shiftDemographicsForPrimary } from "@/lib/campaigns/shiftPrimaryElectorate";

/**
 * Primary turnout as a fraction of general-election turnout. Real-world Dem/GOP
 * primaries draw ~12–18% of the state's general turnout, so 0.13 gives realistic
 * volumes (CA 2020 Dem primary = ~5.8M votes of ~17M general). Shares and
 * delegate allocation are unchanged by this factor — only displayed magnitudes.
 */
const PRIMARY_TURNOUT_FACTOR = 0.13;

export interface PartyPosition {
  economicPosition: number;
  socialPosition: number;
}

export interface ProjectionResult {
  /** stateId -> candidateId -> projected votes */
  byState: Record<string, Record<string, number>>;
  /** stateId -> winning candidateId (null if no candidates scored > 0) */
  stateWinners: Record<string, string | null>;
}

export interface ProjectPrimaryInput {
  /** Intra-party candidates (already enriched: policies, fav, NPI, etc.) */
  candidates: EnrichedCandidate[];
  /** Raw ElectionCandidate data for primaryCampaignState / primaryCampaignTicks / home state */
  candidateMeta: {
    candidateId: string;
    isNPP: boolean;
    homeState?: string | null;
    primaryCampaignState?: string | null;
    primaryCampaignTicks?: number;
    /** ElectionCandidate.support — rally mood (undefined → neutral 1.0×). */
    support?: number;
    /**
     * True while a home-state surge is live. Primary resolution clears this at
     * the end of the cycle, which is what ends the boost — the stored rate
     * below is left behind, so reading that alone would boost for ever.
     */
    primarySurgeUsed?: boolean;
    /** Percentage points the surge was bought at, from the candidate row. */
    primarySurgeBoost?: number;
  }[];
  /** Target states to project — any that have missing demographics are skipped */
  stateIds: string[];
  /** State meta + demographics keyed by stateId */
  stateMap: Map<string, State>;
  demographicsMap: Map<string, StateDemographics>;
  /** Demographic category dictionary (state-independent) */
  categories: DemographicCategory[];
  /** Per-state party-org lookup: key = `${stateId}_${partyId}` -> organization */
  statePartyOrgs: Map<string, number>;
  /** Party position — unused for intra-party math but kept for symmetry with stagger */
  partyPosition: PartyPosition;
  /**
   * Regional bases L1: per-state per-candidate org levels. Outer key is
   * stateId; inner map is `candidateId → level`. Mirrors the same map the
   * live stagger builds — passing it through projection keeps the two
   * engines in sync so non-zero levels don't surface as spurious upsets.
   * Optional: callers without state-org context can omit (legacy behavior).
   */
  stateOrgByStateAndCandidate?: Map<string, Map<string, number>>;
  /**
   * Regional bases C: per-candidate home state map (candidateId → stateId).
   * Mirrors the live stagger map. Optional for the same back-compat reason.
   */
  homeStateByCandidate?: Map<string, string>;
  /** Country for adjacency-aware state-chair boosts. Defaults to US. */
  countryId?: import("@/lib/constants/countries").CountryId;
}

/**
 * Project per-state votes for a single party's primary using the GE-style
 * demographic allocation. All candidates must be of the same party.
 */
export function projectPrimaryByState(input: ProjectPrimaryInput): ProjectionResult {
  const {
    candidates,
    candidateMeta,
    stateIds,
    stateMap,
    demographicsMap,
    categories,
    statePartyOrgs,
    stateOrgByStateAndCandidate,
    homeStateByCandidate,
  } = input;

  const byState: Record<string, Record<string, number>> = {};
  const stateWinners: Record<string, string | null> = {};

  if (candidates.length === 0) {
    for (const stateId of stateIds) {
      byState[stateId] = {};
      stateWinners[stateId] = null;
    }
    return { byState, stateWinners };
  }

  const metaById = new Map(candidateMeta.map((m) => [m.candidateId, m]));
  const hasPlayerInPartyPrimary = candidates.some((c) => !c.isNPP);
  const partyPosition = input.partyPosition;
  const countryId = input.countryId ?? "US";
  // Prefer the explicit regional-bonus map (stagger / UI loaders). Fall back to
  // candidateMeta.homeState so callers that only pass meta still get the
  // in-engine HOME_STATE_BONUS_PRIMARY — without a second post-hoc multiplier.
  const resolvedHomeStateByCandidate =
    homeStateByCandidate ??
    new Map(
      candidateMeta
        .filter((m): m is typeof m & { homeState: string } => Boolean(m.homeState))
        .map((m) => [m.candidateId, m.homeState])
    );

  // Reach is driven by national NPI via `presidentialPrimaryNationalReach`
  // (diminishing 0–1 curve, not the general-election log multiplier). NPPs lack
  // native NPI — enrichment proxies PI; NPP_STAGGER_EXTRA_MULTIPLIER scales
  // NPPs down when a player is in the same primary (~0.48× with general 0.8×).

  for (const stateId of stateIds) {
    const state = stateMap.get(stateId);
    const rawDemographics = demographicsMap.get(stateId);
    if (!state || !rawDemographics) {
      byState[stateId] = {};
      stateWinners[stateId] = null;
      continue;
    }

    // Shift the electorate toward the party's ideological position — primary
    // voters are more ideologically extreme than the general electorate.
    const demographics = shiftDemographicsForPrimary(rawDemographics, partyPosition);

    // Party-org map for this state — all intra-party candidates see the same
    // value for their party (mobilization scalar, not a differentiator).
    const partyOrgForState = new Map<string, number>();
    for (const [key, org] of statePartyOrgs.entries()) {
      if (key.startsWith(`${stateId}_`)) {
        const partyId = key.slice(stateId.length + 1);
        partyOrgForState.set(partyId, org);
      }
    }

    // Rough turnout pool for this state's primary-eligible voters.
    const totalPool = state.population * PRIMARY_TURNOUT_FACTOR;
    const effectivePool = totalPool;

    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      effectivePool,
      totalPool,
      state.population,
      demographics,
      categories,
      partyOrgForState,
      {
        // Intra-party primary: every candidate is in the same party so the
        // party position is a shared constant. Averaging it into each
        // candidate's effective ideology only pulls them all toward the
        // party center, compressing the relative differences that the
        // demographic-distance math then turns into vote share. Use the
        // candidate's raw ideology — that's the only thing that actually
        // varies between same-party rivals. (General elections still use
        // averaged positions; see presidentialElectionEngine.)
        useAveragedPositions: false,
        usePresidentialPartyOrg: true,
        includeInfluenceInAppeal: false,
        useNationalInfluenceForReach: true,
        presidentialPrimaryNationalReach: true,
        // L1 — must match `primaryStaggerPhase.ts` so the projection
        // converges with the live wave result. Without this, every
        // party-aligned win would count as an "upset" against the old-math
        // projected centrist winner, and UI projections would mislead
        // players about who is favored.
        applyPartyFit: true,
        // Regional bases L1+C — mirror primaryStaggerPhase wiring so the
        // projection stays in sync with the live stagger.
        currentStateId: stateId,
        countryId,
        stateOrgByCandidate: stateOrgByStateAndCandidate?.get(stateId),
        homeStateByCandidate: resolvedHomeStateByCandidate,
        hasPlayerInRace: hasPlayerInPartyPrimary,
      }
    );

    // Post-distribution adjustments (same shape as the stagger):
    //   - In-state tick multiplier (up to +15% at cap)
    //   - Extra NPP penalty when a player is in the primary (matches stagger)
    // Home-state is already applied inside distribution via homeStateByCandidate.
    const adjusted: Record<string, number> = {};
    for (const ec of candidates) {
      const meta = metaById.get(ec.candidateId);
      let votes = votesPerCandidate[ec.candidateId] ?? 0;
      if (meta?.primaryCampaignState === stateId && (meta.primaryCampaignTicks ?? 0) > 0) {
        const ticks = Math.min(meta.primaryCampaignTicks ?? 0, 5);
        votes *= 1 + ticks * PRIMARY_CAMPAIGN_STAGGER_TICK_RATE;
      }
      // Home-state surge: the one-off paid boost in the candidate's own home
      // state, live until primary resolution clears the flag. Same
      // multiplicative shape as the tick bonus above, and read from the same
      // home-state map that drives HOME_STATE_BONUS_PRIMARY so the two can
      // never disagree about which state is home.
      votes *= homeStateSurgeMultiplier({
        surgeUsed: meta?.primarySurgeUsed,
        surgeBoostPct: meta?.primarySurgeBoost,
        homeState: resolvedHomeStateByCandidate.get(ec.candidateId),
        stateId,
      });
      // Rally support (matches stagger). Undefined → 1.0×.
      votes *= supportMoodMultiplier(meta?.support);
      if (hasPlayerInPartyPrimary && ec.isNPP) {
        votes *= NPP_STAGGER_EXTRA_MULTIPLIER;
      }
      adjusted[ec.candidateId] = Math.round(votes);
    }

    byState[stateId] = adjusted;

    const ranked = Object.entries(adjusted)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    stateWinners[stateId] = ranked[0]?.[0] ?? null;
  }

  return { byState, stateWinners };
}
