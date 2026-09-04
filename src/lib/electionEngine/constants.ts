/**
 * Constants for the election engine.
 */

// ─── FPTP vote-splitting constants ───────────────────────────────────────────
//
// In First Past the Post states, the vote-splitting (spoiler) effect is modelled
// explicitly: a third-party candidate draws votes directly from the ideologically
// nearest major-party candidate, potentially handing the race to the opposite
// major party.  This is Duverger's Law from the major party's perspective —
// they face an existential threat whenever a third party occupies nearby
// ideological space, since that third party can bleed their coalition and flip
// the seat to the opposition.
//
// The spoiled votes are drawn from the nearest major-party candidate (Manhattan
// distance on the economic/social grid) in proportion to the third party's own
// group-level allocation.  Scaling by the third party's own vote count means
// marginal third parties cause marginal spoiling; a large, well-organised third
// party causes significant spoiling.
//
// In RCV states (state.votingSystem === "rcv") this step is skipped entirely,
// since ranked-choice voting lets voters safely express a third-party first
// preference without harming their second choice — eliminating the spoiler dynamic.

/**
 * @deprecated Use getPartyStrengthWeight(countryId, officeKey) from CountryConfig instead.
 * Kept for backward compatibility with any external references.
 * The engine itself now reads from CountryConfig via getPartyStrengthWeight().
 */
export const PARTY_STRENGTH_BY_OFFICE: Record<string, number> = {
  governor: 1.0,
  house: 0.9,
  senate: 0.8,
  stateSenate: 0.85,
  president: 1.0,
  // UK
  commons: 0.85,
  primeMinister: 1.0,
};

/**
 * @deprecated Use getMajorPartiesForRegion(countryId, parentRegionId) from CountryConfig instead.
 * Kept for backward compatibility with any external references.
 * The engine itself now reads from CountryConfig via getMajorPartiesForRegion().
 */
export const FPTP_MAJOR_PARTIES = new Set(["democrat", "republican"]);

/**
 * Fraction of a third-party candidate's own group-level allocation that the
 * ideologically nearest major-party candidate loses to them (vote-splitting /
 * spoiler effect).  Sized by the third party's strength so marginal third
 * parties cause marginal spoiling; significant third parties cause significant
 * spoiling.
 */
export const FPTP_SPOILER_RATE = 0.04;

/**
 * Spoiler rate for presidential elections — half of the state-level rate.
 * Prevents 7-way fragmented fields from producing EC landslides via winner-take-all
 * when minor parties split their own ideological cluster. Applied only when
 * passed explicitly via `DistributeVotesOptions.spoilerRate`.
 */
export const PRESIDENTIAL_SPOILER_RATE = 0.02;

/**
 * Primary-only multiplier strength for the party-fit penalty (L1).
 * Candidate weight is scaled by
 *   `partyFit = 1 − WEIGHT × (1 − rawFit)`
 * where
 *   `rawFit = max(0, 1 − manhattan(candidate, party) / 6)`.
 *
 * The `/6` normalizer reflects typical within-party Manhattan spreads on
 * the (-4,+4) grid: a "Park-style centrist" sits ~3 from a party at the
 * extreme corner (the design's canonical reference example), saturating
 * the penalty at distance 6 (across-the-party-line positions).
 *
 * Reference points at the calibrated WEIGHT = 0.3:
 *   rawFit = 1.0 (perfect party alignment)         → partyFit = 1.00
 *   rawFit = 0.5 (centrist Park-style, dist ~3)    → partyFit = 0.85
 *   rawFit = 0.0 (across-the-line, dist ≥ 6)       → partyFit = 0.70
 *
 * Calibration: 0.3 was selected over the design spec's initial 0.5 via
 * the `scripts/sim/presidential-eight-way-scenarios.ts` thresholds. At
 * 0.5 the eight-way primary (P2) over-concentrated; at 0.3 the four sim
 * scenarios pass simultaneously — clear winner emerges where stats
 * justify it (Allen 24% national vote share in P2) without flattening
 * the competitive vote-share spread (5 candidates between 10–25%).
 *
 * Increase to make party-fit a stronger filter; decrease to admit more
 * centrist/cross-pressure competitiveness.
 */
export const PRIMARY_PARTY_FIT_WEIGHT = 0.3;

// ─── NPP handicap constants ───────────────────────────────────────────────────
//
// NPPs (Non-Player Politicians) are intentionally weaker than human players in
// contested races.  Two separate multipliers apply:
//
//  PRIMARY_SCORE: Applied to the score NPPs carry into primaries when at least
//    one human player is in their party's primary.  A substantial penalty because
//    NPPs in primaries were winning far too frequently relative to players.
//
//  GENERAL_WEIGHT: Applied to each NPP's per-group vote weight in general
//    elections when at least one human player is in the same race.  A moderate
//    penalty — NPPs should still be competitive but lose their structural
//    advantage over players.

/** Multiplier applied to an NPP's primary score when a player is in the same party primary. */
export const NPP_PRIMARY_SCORE_MULTIPLIER = 0.5;

/** Multiplier applied to an NPP's per-group vote weight in general elections when a player is in the race. */
export const NPP_GENERAL_WEIGHT_MULTIPLIER = 0.8;

/**
 * Additional multiplier applied to NPP vote allocations in presidential primary
 * stagger waves when a player is in the same party's primary.
 * Stacks on top of NPP_GENERAL_WEIGHT_MULTIPLIER so the combined stagger penalty
 * is 0.8 × 0.6 = 0.48, roughly matching the 0.5 score-handicap used in the
 * score-based fallback path. Keeps players competitive in their own primaries.
 */
export const NPP_STAGGER_EXTRA_MULTIPLIER = 0.6;

// ─── Primary-phase campaigning constants ─────────────────────────────────────

/**
 * Maximum ticks of in-state primary bonus a candidate can accumulate while
 * camped in one state during the primary phase. Each turn camped in the same
 * state adds +1 up to this cap. Changing `primaryCampaignState` resets to 0.
 */
export const PRIMARY_CAMPAIGN_TICK_CAP = 5;

/**
 * Home-state surge: a one-off action during the presidential primary that
 * boosts the candidate in their OWN home state.
 *
 * These lived twice: as literals in the primary page's JSX and as private
 * constants in the surge route. They had already drifted — the page advertised
 * "+10 party org" while the route granted +15% to the candidate alone. Both
 * surfaces now read these, so the price and the effect the player is shown are
 * the price and effect the action charges and grants.
 */
export const PRIMARY_HOME_SURGE_COST_FUNDS = 25_000;
export const PRIMARY_HOME_SURGE_COST_ACTIONS = 3;
/**
 * Percentage vote boost in the candidate's own home state, for the remainder of
 * the primary. Applied to this candidate only, not to the state party org, so
 * the surge advantages the surging candidate rather than scaling every
 * co-partisan in the state.
 */
export const PRIMARY_HOME_SURGE_PCT = 15;

/**
 * State attacks: acts aimed at one rival in one state during the primary.
 *
 * Sized against the national opposition-research drain, which is 0.5 points of
 * favourability per turn at level 1 and hits everywhere. A local attack is
 * deliberately weaker in absolute terms because it hits one state, so it only
 * pays when aimed at a state that decides something. The cash cost sits between
 * a canvass batch and a Presence level (STATE_ORG_COST_FUNDS = 250,000) so that
 * attacking a rival genuinely competes with building for yourself.
 *
 * First pass. Wants a balance issue filed and a cycle of play before live.
 */
export const PRIMARY_STATE_ATTACK_DURATION_TURNS = 8;
export const PRIMARY_LOCAL_ATTACK_FAV_PER_TURN = 0.4;
export const PRIMARY_LOCAL_ATTACK_COST_FUNDS = 40_000;
export const PRIMARY_LOCAL_ATTACK_COST_ACTIONS = 4;

/**
 * Vote multiplier a live home-state surge gives a candidate in one state.
 *
 * Shared by the stagger phase, which decides the real result, and the
 * projection that displays it. They apply the same multiplier from the same
 * function so the board cannot promise a lift the wave does not deliver.
 *
 * Gated on `surgeUsed` rather than on the stored rate: primary resolution
 * clears `primarySurgeUsed` at the end of the cycle and leaves
 * `primarySurgeBoost` behind, so keying off the rate would boost for ever. The
 * rate itself comes from the candidate row when present, so a surge already
 * bought keeps the rate it was bought at if this constant is ever retuned.
 */
export function homeStateSurgeMultiplier(input: {
  surgeUsed?: boolean;
  surgeBoostPct?: number;
  homeState?: string | null;
  stateId: string;
}): number {
  if (!input.surgeUsed) return 1;
  if (!input.homeState || input.homeState !== input.stateId) return 1;
  return 1 + (input.surgeBoostPct ?? PRIMARY_HOME_SURGE_PCT) / 100;
}

/**
 * Per-tick projection bonus added to a candidate's primary score for their
 * `primaryCampaignState`. With TICK_CAP=5, a fully-camped candidate gets +7.5
 * score in that state's projection — meaningful relative to the ~65-point
 * max primary score, so pre-stagger camping shifts state projections visibly.
 */
export const PRIMARY_CAMPAIGN_TICK_VALUE = 1.5;

/**
 * Per-tick multiplicative bump to a candidate's in-state vote share during the
 * stagger window. 0.05 × 5-tick cap = +25% in-state bump — sustained
 * camping becomes a meaningful lever a player can spend to overcome a
 * 1-axis ideology deficit. L4 of the primary-competitiveness rework.
 */
export const PRIMARY_CAMPAIGN_STAGGER_TICK_RATE = 0.05;

/**
 * National favorability bump per turn while `primaryCampaignState` is set
 * during primary phase. Mirrors the general-election travel bonus.
 */
export const PRIMARY_CAMPAIGN_NATIONAL_FAV_BONUS = 1;

/** Momentum favorability bump for winning a stagger wave's state. */
export const PRIMARY_MOMENTUM_WIN_BONUS = 2;

/**
 * Extra momentum bump on top of WIN_BONUS when a candidate wins a state they
 * were NOT the projected leader in heading into that wave (upset).
 * Total upset reward = WIN_BONUS + UPSET_BONUS.
 */
export const PRIMARY_MOMENTUM_UPSET_BONUS = 2;

// ─── Per-character per-state Campaign Presence (regional bases) ────────────
//
// Adds a recurring per-state per-candidate weight multiplier in presidential
// primary waves AND in the general election (at reduced caps), modelling the
// Sanders/NH or Biden/SC pattern where a candidate's multi-cycle ground game
// outperforms in specific states. Paired with HOME_STATE_BONUS_PRIMARY /
// _GENERAL. The engine picks which cap to apply via `options.isGeneralElection`.
// See
// docs/plans/archive/2026-05/2026-05-27-presidential-primary-regional-bases-design.md
// docs/plans/archive/2026-05/2026-05-27-presidential-general-regional-bases-design.md

/**
 * Maximum per-state multiplier in the PRIMARY path from a fully-built state
 * organization. Applied in presidential primary waves: bonus = (level / 10) × MAX.
 *   level=5  → +12.5% in-state
 *   level=10 → +25% in-state (cap)
 *
 * Pairs with MAX_STATE_ORG_BONUS_GENERAL (smaller) which the same engine code
 * selects when options.isGeneralElection is true.
 *
 * Calibration: P5 dominance scenario (level-10 vs level-0, identical stats)
 * fails the ≥ 55% threshold at 0.20 (lands at 54.5%). 0.25 produces a clean
 * dominance margin and keeps P6/P7 (which test other levers) passing.
 */
export const MAX_STATE_ORG_BONUS_PRIMARY = 0.25;

/**
 * Flat per-state multiplier for a candidate in their own home state during a
 * PRIMARY wave. Lifetime political base — small but real. Stacks
 * multiplicatively with state-org and camping ticks.
 *
 * Pairs with HOME_STATE_BONUS_GENERAL (smaller) which the same engine code
 * selects when options.isGeneralElection is true.
 */
export const HOME_STATE_BONUS_PRIMARY = 0.1;

/**
 * Multiplicative party-influence bonus per reference scale of party influence in
 * the presidential-primary state-by-state vote weight. Applied only when
 * `presidentialPrimaryNationalReach` is set (the presidential primary path).
 * Since `normalizePartyInfluencePresidentialPrimary` is now linear + uncapped
 * (normalized = partyInfluence / 150), this is the bonus at the reference scale
 * (partyInfluence == 150) and it scales linearly beyond it — it is NOT a ceiling:
 *   partyInfluence=0   → 1.00×
 *   partyInfluence=75  → 1.20×
 *   partyInfluence=150 → 1.40× (reference scale)
 *   partyInfluence=300 → 1.80×  (uncapped: keeps scaling)
 *
 * Raised 0.2 → 0.4 (2026-07-18) to make party standing a decisive primary lever
 * — a candidate with substantially higher accumulated party influence can now
 * overcome a modest ideological disadvantage. NOTE: because many GOP primary
 * states are winner-take-all, this lever is non-linear near the 50% per-state
 * threshold — small changes here can swing delegate totals sharply. Uses the
 * same linear normalization as the snapshot score
 * (`normalizePartyInfluencePresidentialPrimary`).
 */
export const MAX_PARTY_INFLUENCE_BONUS_PRIMARY = 0.4;

/**
 * Maximum per-state multiplier in the GENERAL path. Smaller than the primary
 * cap so multi-cycle investment carries forward without dominating state-lean
 * × party-position (the main driver of general-election results).
 *
 *   level=5  → +7.5% in-state
 *   level=10 → +15% in-state (cap)
 *
 * Calibration discovery: the engine's per-group share normalization with
 * polarized Dem/Rep group appeals dampens weight multipliers much more in the
 * general path than in primaries. At 0.10 the P8 share lift (level-10 + home
 * Dem vs unfunded baseline in PA) was only 1.9pp; the spec's original
 * ≥3pp threshold would have required a 0.20 cap, defeating the design intent
 * of "general is meaningfully smaller than primary." 0.15 (60% of the
 * primary's 0.25 cap) lands at a 2.5pp lift — clearly distinguishable as
 * weaker than primary while still registering visibly for invested players.
 *
 * Combined with HOME_STATE_BONUS_GENERAL at home: 1.15 × 1.05 = 1.2075×.
 * Compared to primary's 1.25 × 1.10 = 1.375×, the general weight lift is
 * about half the primary's — meaningful in invested swing states without
 * overwhelming the partisanship math.
 */
export const MAX_STATE_ORG_BONUS_GENERAL = 0.15;

/**
 * Flat per-state multiplier for a candidate in their own home state during a
 * GENERAL election. Halved from the primary version so the bump is visible
 * but doesn't compete with VP home-state and ground-game swing-state effects
 * the general engine already applies.
 */
export const HOME_STATE_BONUS_GENERAL = 0.05;

/**
 * Campaign-action cost per +1 Campaign Presence level.
 *
 * Spent from the CAMPAIGN's action pool, not the player's personal one (moved
 * 2026-08-19). Building presence is campaign work and should compete with the
 * media / ground-game / opposition-research trees for the same budget, rather
 * than being funded out of a player's personal turn allowance.
 */
export const STATE_ORG_COST_ACTIONS = 3;

/**
 * Base cash cost of the FIRST Campaign Presence level (anchor-denominated
 * internally; the forex helper converts to the character's home currency at the
 * API boundary so the player-facing UI never displays anchor units).
 *
 * Raised from a flat 50,000 (2026-08-19). At 50k, maxing a state cost $500K
 * against live presidential treasuries of $196M–$284M — roughly 0.2% of budget
 * for the whole map, which is why campaign funds visibly "didn't matter".
 * Presence is now the main thing a campaign treasury is FOR, so it is priced
 * like it.
 *
 * @see stateOrgLevelCost for the per-level escalation.
 */
export const STATE_ORG_COST_FUNDS = 250_000;

/**
 * Growth factor applied per existing level, so presence escalates instead of
 * being a flat toll. Cost of the Nth level is
 * `STATE_ORG_COST_FUNDS × STATE_ORG_COST_GROWTH^(N-1)`.
 *
 * At 1.35: L1 $250K, L5 ~$820K, L10 ~$3.7M, L15 ~$16.5M, L20 ~$74M. Combined
 * with the uncapped-but-diminishing bonus this is what keeps an unlimited
 * ladder from becoming "richest campaign buys unbounded vote share": the bonus
 * curve flattens while the price compounds, so the marginal level gets rapidly
 * worse value. A $271M treasury can dominate a handful of chosen states, not
 * all 50.
 */
export const STATE_ORG_COST_GROWTH = 1.35;

/**
 * Cash cost to buy the level that takes a state from `currentLevel` to
 * `currentLevel + 1`, anchor-denominated.
 */
export function stateOrgLevelCost(currentLevel: number): number {
  const safeLevel = Math.max(0, Math.floor(currentLevel));
  return Math.round(STATE_ORG_COST_FUNDS * Math.pow(STATE_ORG_COST_GROWTH, safeLevel));
}

/**
 * Action throttle: at most +1 to the same state's org level per turn.
 * Players can still build in *different* states the same turn — this just
 * prevents same-turn stacking via action-refresh exploits. Enforced
 * server-side via the time-window on `updatedAt`.
 */
export const STATE_ORG_PER_STATE_TURN_CAP = 1;

/**
 * Reference level for the Campaign Presence bonus curve.
 *
 * NOT a cap — the level ladder is unbounded (2026-08-19). This is the level at
 * which the curve reaches {@link STATE_ORG_REFERENCE_FRACTION} of the maximum
 * bonus, i.e. the old "maxed" feel is preserved at the level players already
 * knew. Retained under the old name so the many UI and engine call sites that
 * used it as a normaliser keep working.
 */
export const STATE_ORG_MAX_LEVEL = 10;

/**
 * Fraction of the maximum bonus delivered at {@link STATE_ORG_MAX_LEVEL}.
 * 0.75 means level 10 buys three quarters of what is theoretically available,
 * leaving a real but sharply diminishing tail above it.
 */
export const STATE_ORG_REFERENCE_FRACTION = 0.75;

/**
 * Campaign Presence bonus as a fraction of the applicable maximum
 * (`MAX_STATE_ORG_BONUS_PRIMARY` / `..._GENERAL`), for an unbounded level.
 *
 * Replaces the old linear `level / STATE_ORG_MAX_LEVEL` ratio, which was only
 * coherent because the level was capped at 10. Uncapping that ratio would have
 * made vote weight grow without limit — level 40 would have been +100% primary
 * weight — turning presence into a pure "richest campaign wins" lever. Given
 * live treasuries span $271.8M (DEM) to $80K (MCPUS), that would have made the
 * minor-party lockout dramatically worse.
 *
 * Curve: `1 − (1 − f)^(level / L)` with `f = STATE_ORG_REFERENCE_FRACTION` and
 * `L = STATE_ORG_MAX_LEVEL`. Exponential approach to 1.0, never reaching it:
 *
 *   L0 → 0%      L5 → 50%     L10 → 75%    L15 → 87.5%
 *   L20 → 93.8%  L30 → 98.4%  L40 → 99.6%
 *
 * Every level still helps, so investment is never wasted and there is no wall
 * to hit. But the 20th level buys ~1/12th of what the 2nd did, while
 * {@link STATE_ORG_COST_GROWTH} makes it ~15x more expensive — so the ladder
 * self-limits on value rather than on a rule.
 */
export function stateOrgBonusFraction(level: number): number {
  const safeLevel = Math.max(0, level);
  if (safeLevel === 0) return 0;
  return 1 - Math.pow(1 - STATE_ORG_REFERENCE_FRACTION, safeLevel / STATE_ORG_MAX_LEVEL);
}

// ─── Governor coattail (§7.3.2 govModifier term) ────────────────────────────

/**
 * Maximum nominal-share bonus/drag a sitting regional executive's party gets in
 * its own state's down-ballot generals, at full approval swing (±25 points from
 * the neutral baseline). Preserves the prior tenure band-3 ceiling (±9%).
 * Approval-based per the 2026-06-02 coattails design. Tune-later.
 */
export const COATTAIL_MAX_BONUS = 0.09;

/** Approval points (from the neutral baseline) at which the bonus saturates. */
export const COATTAIL_APPROVAL_SATURATION = 25;
