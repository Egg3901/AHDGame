/**
 * Era Checkpoints — historical-realignment gravity for demographic base leans.
 *
 * SURVEY CONTEXT (see the design writeup accompanying this change for the
 * full survey; summarized here for anyone extending the registry):
 *
 *  - Era-seed-time demographic leans (`DEMOGRAPHIC_POSITIONS` /
 *    `ERA_POSITION_OVERRIDES` / `STATE_POSITION_OVERRIDES` in
 *    `src/lib/seeds/demographicCategories.ts`) are baked into each state's
 *    `stateDemographics` document ONCE, at world-seed time, via
 *    `deriveGroupLeanFromLayer1` (`src/lib/seeds/stateDemographicsPure.ts`).
 *    They never move again on their own — a running world has no
 *    structural/historical pressure at all, only NPP behavior and whatever
 *    legislation players pass. This module is the missing structural layer.
 *
 *  - The existing RUNTIME lean-drift channel is `demographicEffects.ts`'s
 *    v2 `LegislationType.demographicEffects[]` machinery: while a law
 *    targeting a group+axis is ACTIVE, it pushes `stateDemographics.groups`
 *    away from a fixed baseline (capped ±`LEAN_MAX_DEVIATION_FROM_BASELINE`);
 *    once the law lapses, the group decays back toward that baseline at
 *    `LEAN_TURNOUT_DECAY_RATE_PER_TURN`. That baseline is the group's
 *    ORIGINAL seeded value (`demographicDefaults` collection) — legislation
 *    can only ever produce a *temporary* deviation from history, never move
 *    what "normal" means. That is correct for ordinary bills, but it is
 *    architecturally the wrong shape for a realignment: Brown v Board /
 *    the Civil Rights Acts didn't create a 1.5-point wobble that reverts the
 *    moment nobody's actively legislating on it — they permanently moved
 *    where the Southern white electorate's political center of gravity SITS.
 *
 *  - SCOTUS (`src/lib/turn/scotusDocketTurn.ts`) already decides landmark
 *    cases against the seated justices' leans and records `outcome:
 *    "affirmed" | "diverged"` + `decidedAtTurn` on `docketCases`. But NOTHING
 *    in the codebase reads an "affirmed" outcome — only a "diverged" ruling
 *    does anything (it synthesizes a scripted enacted-law effect). Whether
 *    Brown v Board affirms or diverges from history, today, has zero
 *    downstream effect on the electorate. This module is the first consumer
 *    of that field: it reads `docketCases` (read-only) to gate/pace a
 *    checkpoint, without touching the SCOTUS engine itself.
 *
 * WHAT A CHECKPOINT DOES
 * -----------------------
 * A checkpoint declares a signed, dated, historically-anchored pull on one or
 * more (state, voter archetype, axis) targets. While active it moves BOTH the
 * live `stateDemographics.groups[id].economicLean/socialLean` AND the seeded
 * `demographicDefaults` snapshot for the same field, by the same amount, every
 * turn (see `eraCheckpointTurn.ts`). Moving both together means:
 *
 *   1. it genuinely relocates the group's resting point (the literal "base
 *      value" the owner asked for), not a capped deviation from it;
 *   2. the existing v2 decay-to-baseline channel never fights it (baseline
 *      and live move in lockstep, so the distance it decays toward is ~0);
 *   3. a player's own legislation (the SAME `demographicEffects` v2 channel)
 *      still applies its normal ± overlay on top, and can out-pull the
 *      checkpoint (see `applyCounterPressure` below) — gravity, not rails.
 *
 * REACHING THE GRANULAR VOTE PATH (the only vote path
 * for fresh worlds — see `src/lib/seeds/reference/featureFlagDefaults.ts`):
 * the granular vote-distribution substrate
 * (`src/lib/demographics/granularElectorate.ts`) derives cell leans from the
 * era/state Layer-1 CENSUS POSITION TABLES
 * (`DEMOGRAPHIC_POSITIONS`/`STATE_POSITION_OVERRIDES` in
 * `demographicCategories.ts`), not from `stateDemographics.groups[id]` — so
 * archetype-level moves above are invisible to it, and that substrate's own
 * "legislation is still influential" signal (`live − demographicDefaults`,
 * used for ordinary bills) necessarily stays ~0 for a checkpoint by design
 * (point 2 above), so it can't carry a checkpoint's pull either. A checkpoint
 * therefore ALSO accumulates a separate, durable per-(dimension, bucket)
 * delta on `demographicDefaults.layer1PositionOverrides` (see
 * `Layer1PositionOverlay` in `src/lib/db/types/demographics.ts`), projected
 * from the SAME netted archetype delta via `archetypeValuesToBuckets` (the
 * shared archetype→census-bucket map that already diffuses archetype-keyed
 * turnout/approval effects onto cells) — see `eraCheckpointTurn.ts` for where
 * this is written and `granularElectorate.ts`'s `applyPositionOverlay` for
 * where it's read: applied directly to the resolved position table BEFORE
 * cell derivation, so it moves the actual base value a cell's lean is
 * averaged from, not a post-hoc fold on the derived electorate. This overlay
 * is never decayed, exactly like the archetype-level move. With the flag OFF,
 * this overlay is simply never read — the archetype-level move above is the
 * entire visible effect, unchanged.
 */
import type { CountryId } from "@/lib/constants/countries";
import { US_STATES } from "@/lib/constants";
import { yearToTurn } from "@/lib/scotus/turnConversion";

/**
 * One (state-set, target, axis) pull of a checkpoint. Exactly one of `groupId`
 * or (`dim` + `bucket`) must be set — this is a loose union (both fields
 * optional, checked at runtime by `eraCheckpointTurn.ts`) rather than a
 * discriminated one so existing archetype-target object literals (no `kind`
 * field) keep compiling unchanged.
 *
 *  - `groupId` (ARCHETYPE target, the original mechanism): a voter-archetype
 *    id from `demographicCategories.ts` (e.g. "rural_traditionalists"). Moves
 *    the live `stateDemographics.groups[id]` AND `demographicDefaults.groups[id]`
 *    directly, and projects onto Layer-1 census buckets via
 *    `ARCHETYPE_BUCKET_MAP` for the granular path — see `eraCheckpointTurn.ts`.
 *    Necessarily an approximation for a bucket-shaped ask ("southern whites"
 *    is not literally the `rural_traditionalists` archetype, just correlated
 *    with it) but keeps the LEGACY (non-granular) vote path moving too, since
 *    that path only ever reads archetype-keyed leans.
 *  - `dim` + `bucket` (BUCKET target, direct Layer-1 targeting): the exact
 *    census dimension/bucket vocabulary from `DEMOGRAPHIC_POSITIONS`
 *    (`src/lib/seeds/demographicCategories.ts`) — `dim` is one of
 *    `GRANULAR_DIMENSIONS` ("race" | "age" | "education" | "wealth",
 *    `src/lib/demographics/granularCells.ts`), `bucket` one of that
 *    dimension's keys (e.g. "white", "low"). Expresses a demographic-by-
 *    geography intersection PRECISELY — "southern whites" is
 *    `{ dim: "race", bucket: "white", stateIds: DEEP_SOUTH_STATES }|
 *    "midwestern lower class" is `{ dim: "wealth", bucket: "low", stateIds:
 *    MIDWEST_STATES }` — with no archetype-proxy fuzziness. Moves ONLY the
 *    durable `layer1PositionOverrides[dim][bucket][axis]` overlay (there is no
 *    archetype to carry it on the legacy live doc); reaches the granular vote
 *    path exactly like an archetype target's projected bucket delta does, but
 *    with no approximation. `stateIds` doubles as scope: a region's state list
 *    for a REGIONAL effect, or `ALL_US_STATES` for a NATIONAL one.
 */
export interface EraCheckpointTarget {
  /** ARCHETYPE target — see the interface doc comment. Mutually exclusive with `dim`/`bucket`. */
  groupId?: string;
  /** BUCKET target — the Layer-1 census dimension (e.g. "race", "wealth"). Paired with `bucket`. */
  dim?: string;
  /** BUCKET target — the bucket key within `dim` (e.g. "white", "low"). Paired with `dim`. */
  bucket?: string;
  /** State ids this target applies to — a region's list for REGIONAL scope, `ALL_US_STATES` for NATIONAL. */
  stateIds: readonly string[];
  /**
   * `"economicLean" | "socialLean"` — a signed shift on the shared -5..+5
   * axis (see `totalShift`'s doc comment). `"turnout"` — a durable
   * ENFRANCHISEMENT/suppression shift on the bounded 0-100 turnout scale
   * (percentage points), routed through `applyDurableGroupTurnoutShift` /
   * `applyDurableBucketTurnoutShift` in `durableRealignment.ts` rather than
   * the lean functions — see those functions' doc comments for why turnout
   * needs its own clamp semantics rather than a widened lean axis. The Voting
   * Rights Act checkpoint below is this project's worked example: its real
   * effect was letting previously-disenfranchised Black voters cast a ballot
   * at all, not shifting the politics of voters who already could.
   */
  axis: "economicLean" | "socialLean" | "turnout";
  /**
   * Total shift accumulated across the FULL window if never contested. For
   * lean axes: signed on the shared -5..+5 axis (positive = rightward /
   * Republican, negative = leftward / Democratic). For `axis: "turnout"`:
   * signed percentage points (positive = enfranchisement/higher turnout,
   * negative = suppression) — see `TURNOUT_OVERLAY_DELTA_MIN/MAX` in
   * `durableRealignment.ts` for the accumulator's own bound.
   */
  totalShift: number;
}

/** All 50 US states — use as `stateIds` for a NATIONAL-scope checkpoint target. */
export const ALL_US_STATES: readonly string[] = US_STATES;

/**
 * US Census Bureau Midwest region, as used by this project's 1953 state seed
 * data (`region: "Midwest"` in `src/lib/seeds/reference/states1953.ts`).
 * Reference geography for "midwestern" checkpoint targets.
 */
export const MIDWEST_STATES = [
  "IA",
  "IL",
  "IN",
  "KS",
  "MI",
  "MN",
  "MO",
  "ND",
  "NE",
  "OH",
  "SD",
  "WI",
] as const;

export interface EraCheckpoint {
  id: string;
  countryId: CountryId;
  title: string;
  /**
   * Optional SCOTUS docket case that gates/paces this checkpoint. When the
   * case is decided in `triggerDirection` (i.e. `outcome === "affirmed"`),
   * the checkpoint starts at the case's `decidedAtTurn` — a real ruling
   * kicking off a real shift. When the case decides the OPPOSITE way
   * (`outcome === "diverged"`), the checkpoint does not start early: it
   * falls back to `fallbackStartTurn`, modeling a differently-composed Court
   * measurably slowing history's pace rather than erasing it outright.
   */
  triggerCaseKey?: string;
  /** Turn to start on if there is no trigger case, the case hasn't decided yet, or it diverged. */
  fallbackStartTurn: number;
  /** Turns over which every target's `totalShift` is fully applied once started. */
  durationTurns: number;
  /**
   * The REAL-WORLD years this checkpoint's history occupies, used only to
   * de-duplicate it out of the interpolated era baseline (see
   * `checkpointBakedShifts.ts`). It is deliberately NOT the in-world pacing:
   * `fallbackStartTurn`/`durationTurns` say when the pull runs in a given
   * world, which shifts with the docket; this says when it happened in the
   * history the era anchor tables were authored against, which never moves.
   *
   * Required for any checkpoint whose effect is already visible in a later
   * anchor's authored values — i.e. every one of them, since the tables are
   * authored from real election results. Omit only for a checkpoint modeling
   * something the anchors do not encode.
   */
  historicalWindow?: { startYear: number; endYear: number };
  targets: readonly EraCheckpointTarget[];
}

/** Minimal shape this module needs from a `docketCases` document. */
export interface DocketCaseLookupEntry {
  status: "pending" | "decided";
  outcome?: "affirmed" | "diverged";
  decidedAtTurn?: number;
}

const STARTING_YEAR_1953 = 1953;

/** Deep South states carried Solid-South Democratic registration into 1953 (see
 * `STATE_POSITION_OVERRIDES["1953"]` in demographicCategories.ts) and were the
 * core of the post-Brown/Civil-Rights-Act white defection (Goldwater carried
 * five of these six in 1964). */
const DEEP_SOUTH_STATES = ["AL", "MS", "SC", "LA", "GA", "AR"] as const;

/**
 * The Southern realignment (1954-on): Brown v Board begins the fracture of
 * the Democratic Solid South; the 1964 Civil Rights Act / 1965 Voting Rights
 * Act complete the decisive break (Goldwater carries the Deep South in '64 —
 * the first Republican sweep of the region since Reconstruction). Modeled as
 * two coupled pulls: white Southern conservatives (rural_traditionalists,
 * evangelicals) drift Republican; Black voters (carried in this era's
 * union_trades archetype composition, which is the only 1953 archetype with a
 * race:black weight — see `ERA_COMPOSITIONS["1953"]` — consolidate further
 * Democratic. No named officeholders: the trigger is a docket case key, the
 * targets are archetypes/states, matching this project's seeds-are-structure
 * convention.
 */
export const SOUTHERN_REALIGNMENT_CHECKPOINT: EraCheckpoint = {
  id: "southern-realignment-1954",
  countryId: "US",
  title: "Southern Realignment",
  triggerCaseKey: "brown-v-board-1954",
  // Fallback: Brown v. Board is `historicalOutcomeLocked` (see divergence.ts)
  // so this trigger always fires at its historical date in practice — but the
  // fallback stays authored (rather than removed) as the checkpoint's own
  // documented degrade path if a case is ever missing/undecided for any other
  // reason (e.g. a preset that omits the docket entirely). If it ever did need
  // it, the Civil Rights Act (1964) / Voting Rights Act (1965) era still drags
  // the region there — just later and slower.
  fallbackStartTurn: yearToTurn(1965, STARTING_YEAR_1953),
  // 15 years: 1954 (or the fallback year) through the end of Nixon's first
  // term — the sharpest, best-documented span of the defection.
  durationTurns: 15 * 48,
  historicalWindow: { startYear: 1954, endYear: 1969 },
  targets: [
    {
      groupId: "rural_traditionalists",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: 4.0,
    },
    {
      groupId: "rural_traditionalists",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: 3.5,
    },
    { groupId: "evangelicals", stateIds: DEEP_SOUTH_STATES, axis: "economicLean", totalShift: 3.5 },
    { groupId: "evangelicals", stateIds: DEEP_SOUTH_STATES, axis: "socialLean", totalShift: 3.0 },
    {
      groupId: "union_trades",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: -1.5,
    },
    { groupId: "union_trades", stateIds: DEEP_SOUTH_STATES, axis: "socialLean", totalShift: -1.0 },
    // BUCKET targets (added alongside the archetype ones above): the owner's
    // own worked example of the (dim,bucket)-precise vocabulary — "southern
    // whites" expressed literally as race:white × the Deep South, with no
    // archetype-proxy fuzziness. `rural_traditionalists`/`evangelicals` above
    // are judgment-call CORRELATES of white Southern conservatives (see
    // ARCHETYPE_BUCKET_MAP's doc comment); this is the exact bucket itself,
    // and is what actually moves the granular electorate's race:white base
    // position in these states (the archetype targets above also reach it,
    // second-hand, via their own bucket projection — this is additive
    // precision, not a replacement).
    {
      dim: "race",
      bucket: "white",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: 3.5,
    },
    {
      dim: "race",
      bucket: "white",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: 3.0,
    },
  ],
};

/**
 * Nationwide Black Democratic consolidation, 1964-on: the Civil Rights Act
 * (1964) and Voting Rights Act (1965) are STATUTES, not Court rulings — this
 * checkpoint has no `triggerCaseKey` at all, which is this project's marking
 * convention for "designated" permanent statute effects (see the module doc
 * comment's DESIGNATION note). Distinct from `SOUTHERN_REALIGNMENT_CHECKPOINT`
 * above: that one is regionally Southern; this one is the NATIONAL half of
 * the same historical moment — "Black voters consolidate Democratic
 * nationally" (not just in the states targeted by the Southern defection).
 * Expressed directly in the Layer-1 vocabulary (race:black) rather than an
 * archetype proxy, at every US state.
 */
export const NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT: EraCheckpoint = {
  id: "national-civil-rights-act-1964",
  countryId: "US",
  title: "Civil Rights Act / Voting Rights Act — National Black Consolidation",
  // No triggerCaseKey: this is a STATUTE's own designated permanent effect,
  // not gated by any Docket case's outcome — see the doc comment above.
  fallbackStartTurn: yearToTurn(1964, STARTING_YEAR_1953),
  durationTurns: 10 * 48, // 1964-1974: the decisive consolidation decade
  historicalWindow: { startYear: 1964, endYear: 1974 },
  targets: [
    {
      dim: "race",
      bucket: "black",
      stateIds: ALL_US_STATES,
      axis: "economicLean",
      totalShift: -2.5,
    },
    { dim: "race", bucket: "black", stateIds: ALL_US_STATES, axis: "socialLean", totalShift: -1.5 },
  ],
};

/**
 * States covered by the Voting Rights Act's original Section 5 "coverage
 * formula" (a jurisdiction used a literacy/character test AND had under 50%
 * registration or turnout in the 1964 presidential election): Alabama,
 * Georgia, Louisiana, Mississippi, South Carolina, and Virginia (the formula
 * also covered 26 North Carolina counties, not modeled at county
 * granularity here). Source: Voting Rights Act of 1965, 42 U.S.C. § 1973b.
 */
export const VRA_SECTION5_STATES = ["AL", "GA", "LA", "MS", "SC", "VA"] as const;

/**
 * Voting Rights Act of 1965 — Black voter ENFRANCHISEMENT, modeled on the
 * TURNOUT axis rather than lean. This is deliberately separate from
 * `NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT` above, which captures a different
 * (and smaller) historical effect: Black voters who could ALREADY vote
 * consolidating further Democratic. The VRA's larger, defining effect was
 * that Black voters in these states largely could NOT vote before it —
 * federal registrars and the suspension of literacy tests moved registration
 * from token to majority in a few years, not a political-lean shift among
 * the previously-enfranchised:
 *
 *  - Mississippi:      ~6.7% (1965)  -> 59.8% (1967)  = +53.1 pts
 *  - Alabama:           ~19.3% (1965) -> 51.6% (1966)  = +32.3 pts
 *  - Louisiana:          ~31.6% (1965) -> 58.9% (1967)  = +27.3 pts
 *  - Georgia:           ~27.4% (1965) -> 52.6% (1966)  = +25.2 pts
 *  - South Carolina:    ~37.3% (1965) -> 51.2% (1966)  = +13.9 pts
 *  - Virginia:          ~38.3% (1964) -> 46.9% (1966)  =  +8.6 pts (least
 *    restrictive of the six pre-Act, so the smallest jump)
 *  (Source: U.S. Commission on Civil Rights, "Political Participation" 1968
 *  report — the standard citation for these registration figures.)
 *
 * These are REGISTRATION figures, the best-documented contemporaneous proxy
 * for enfranchisement scale; turnout among the newly-registered in the
 * elections that immediately followed tracked closely with them. Modeled as
 * two tiers rather than one flat number across all six states: Mississippi
 * and Alabama (the two most extreme pre-Act suppression cases) get the full
 * `totalShift`, the remaining four (still severe, but starting from a higher
 * base) get roughly half. `dim: "race", bucket: "black"` is the exact
 * Layer-1 bucket (no archetype-proxy approximation, matching
 * `SOUTHERN_REALIGNMENT_CHECKPOINT`'s bucket-target precedent). No
 * `triggerCaseKey`: like the national consolidation checkpoint above, this is
 * a STATUTE's own designated effect, not gated by a docket case. A shorter
 * window than the lean checkpoints (registration drives moved fast, most of
 * the jump landed within 2-3 years) and still "gravity, not rails": a
 * sustained voter-suppression counter-effort (a `target: "turnout"` law
 * pushing the opposite direction on the same bucket) nets against it every
 * turn exactly like any other durable channel.
 */
export const VOTING_RIGHTS_ACT_ENFRANCHISEMENT_CHECKPOINT: EraCheckpoint = {
  id: "voting-rights-act-enfranchisement-1965",
  countryId: "US",
  title: "Voting Rights Act — Black Voter Enfranchisement",
  fallbackStartTurn: yearToTurn(1965, STARTING_YEAR_1953),
  durationTurns: 3 * 48, // 1965-1968: registration drives moved fast
  historicalWindow: { startYear: 1965, endYear: 1968 },
  targets: [
    // Mississippi, Alabama: the two steepest pre-Act suppression cases.
    {
      dim: "race",
      bucket: "black",
      stateIds: ["MS", "AL"],
      axis: "turnout",
      totalShift: 40,
    },
    // Louisiana, Georgia, South Carolina, Virginia: severe but starting from
    // a higher pre-Act base, so a smaller (but still historic) jump.
    {
      dim: "race",
      bucket: "black",
      stateIds: ["LA", "GA", "SC", "VA"],
      axis: "turnout",
      totalShift: 20,
    },
  ],
};

/**
 * Engel v. Vitale (1962, banned state-composed school prayer): a national
 * religious-conservative reaction, strongest in the South and Midwest (see
 * the historical-grounding note this ticket was scoped against). Modeled as
 * a national `evangelicals`-archetype nudge PLUS an additional regional
 * (Deep South + Midwest) top-up on the same archetype/axis — demonstrating a
 * SCOTUS ruling with BOTH national and regional components in one case. Not
 * a race/equal-protection case — genuinely composition-driven (see
 * divergence.ts): a differently-composed Court that upheld school prayer
 * delays this checkpoint to its fallback, same mechanism as the Southern
 * realignment above.
 */
export const ENGEL_SCHOOL_PRAYER_CHECKPOINT: EraCheckpoint = {
  id: "engel-school-prayer-1962",
  countryId: "US",
  title: "Engel v. Vitale — Religious-Conservative Reaction",
  triggerCaseKey: "engel-v-vitale-1962",
  fallbackStartTurn: yearToTurn(1963, STARTING_YEAR_1953),
  durationTurns: 8 * 48,
  historicalWindow: { startYear: 1963, endYear: 1971 },
  targets: [
    // National baseline (all US states).
    { groupId: "evangelicals", stateIds: ALL_US_STATES, axis: "socialLean", totalShift: 1.0 },
    // Regional top-up: strongest in the South and Midwest.
    {
      groupId: "evangelicals",
      stateIds: [...DEEP_SOUTH_STATES, ...MIDWEST_STATES],
      axis: "socialLean",
      totalShift: 1.0,
    },
  ],
};

/**
 * Reynolds v. Sims (1964, "one person, one vote" for state legislatures) —
 * the owner-flagged highest-value reapportionment case: forced reapportionment
 * shifts POWER from rural to urban/suburban voters. That is fundamentally a
 * WEIGHT/representation shift (district lines, seat counts), which this
 * lean-based mechanism does not model — see `demographicSignal` on the
 * docket entry and the file header of `src/lib/scotus/presetData/1953.ts`.
 * This checkpoint models only the LEAN-shaped ECHO of that shift: newly-
 * empowered urban/working-class Midwest voters (proxied here by the
 * `wealth:low` bucket, since "urban working class" has no single Layer-1
 * bucket) drift modestly Democratic once their votes carry proportionate
 * weight. Explicitly a small, approximate proxy — the real effect this case
 * had on American politics is not fully captured by a lean nudge, and no
 * attempt is made here to pretend otherwise. Composition-driven (not a
 * race/equality case): see `divergence.ts` and `1953.test.ts`'s
 * "branch that fires depends on composition" case for Reynolds specifically.
 */
export const REYNOLDS_REAPPORTIONMENT_CHECKPOINT: EraCheckpoint = {
  id: "reynolds-reapportionment-1964",
  countryId: "US",
  title: "Reynolds v. Sims — Reapportionment (lean proxy)",
  triggerCaseKey: "reynolds-v-sims-1964",
  fallbackStartTurn: yearToTurn(1966, STARTING_YEAR_1953),
  durationTurns: 8 * 48,
  historicalWindow: { startYear: 1966, endYear: 1974 },
  targets: [
    {
      dim: "wealth",
      bucket: "low",
      stateIds: MIDWEST_STATES,
      axis: "economicLean",
      totalShift: -1.0,
    },
  ],
};

/**
 * Griswold v. Connecticut (1965, marital-privacy right): younger and urban
 * voters nationally (Catholic cross-pressure noted in the historical
 * grounding is not modeled — there is no religion dimension in the Layer-1
 * cell vocabulary, race/age/education/wealth only; see `GRANULAR_DIMENSIONS`).
 * Modeled as a national `age:young` bucket target. Composition-driven.
 */
export const GRISWOLD_PRIVACY_CHECKPOINT: EraCheckpoint = {
  id: "griswold-privacy-1965",
  countryId: "US",
  title: "Griswold v. Connecticut — Privacy Realignment",
  triggerCaseKey: "griswold-v-connecticut-1965",
  fallbackStartTurn: yearToTurn(1966, STARTING_YEAR_1953),
  durationTurns: 8 * 48,
  historicalWindow: { startYear: 1966, endYear: 1974 },
  targets: [
    { dim: "age", bucket: "young", stateIds: ALL_US_STATES, axis: "socialLean", totalShift: -1.0 },
  ],
};

/**
 * Miranda v. Arizona (1966, mandated custodial-interrogation warnings):
 * law-and-order salience rising among suburban and working-class voters
 * nationally (per the historical grounding note). `wealth:middle` is the
 * closest single Layer-1 bucket proxy for "suburban"; `education:no_college`
 * for "working class" — both nudged modestly toward order/security. Bundles
 * Mapp v. Ohio's (1961) same criminal-procedure salience rather than
 * authoring a near-duplicate second checkpoint keyed to a different case.
 * Composition-driven.
 */
export const MIRANDA_LAW_AND_ORDER_CHECKPOINT: EraCheckpoint = {
  id: "miranda-law-and-order-1966",
  countryId: "US",
  title: "Miranda v. Arizona — Law-and-Order Salience",
  triggerCaseKey: "miranda-v-arizona-1966",
  fallbackStartTurn: yearToTurn(1967, STARTING_YEAR_1953),
  durationTurns: 8 * 48,
  historicalWindow: { startYear: 1967, endYear: 1975 },
  targets: [
    {
      dim: "wealth",
      bucket: "middle",
      stateIds: ALL_US_STATES,
      axis: "socialLean",
      totalShift: 0.75,
    },
    {
      dim: "education",
      bucket: "no_college",
      stateIds: ALL_US_STATES,
      axis: "socialLean",
      totalShift: 0.75,
    },
  ],
};

/**
 * Era-agnostic checkpoint registry. Declaring a new era's checkpoints (a 1979
 * or 1991 world's own realignments) means adding entries here — no new
 * engine code required; `eraCheckpointTurn.ts` reads this list generically.
 */
export const ERA_CHECKPOINTS: readonly EraCheckpoint[] = [
  SOUTHERN_REALIGNMENT_CHECKPOINT,
  NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT,
  VOTING_RIGHTS_ACT_ENFRANCHISEMENT_CHECKPOINT,
  ENGEL_SCHOOL_PRAYER_CHECKPOINT,
  REYNOLDS_REAPPORTIONMENT_CHECKPOINT,
  GRISWOLD_PRIVACY_CHECKPOINT,
  MIRANDA_LAW_AND_ORDER_CHECKPOINT,
];

/**
 * Resolve the turn a checkpoint actually starts on, given the (optional)
 * decided state of its trigger docket case. Pure — the caller fetches the
 * docket case.
 */
export function resolveCheckpointStartTurn(
  checkpoint: EraCheckpoint,
  docketCase: DocketCaseLookupEntry | undefined
): number {
  if (!checkpoint.triggerCaseKey) return checkpoint.fallbackStartTurn;
  if (!docketCase || docketCase.status !== "decided") return checkpoint.fallbackStartTurn;
  if (docketCase.outcome === "affirmed" && typeof docketCase.decidedAtTurn === "number") {
    return docketCase.decidedAtTurn;
  }
  // Diverged (or a decided case missing decidedAtTurn, defensively): the
  // Court-driven trigger didn't fire this time — use the slower fallback.
  return checkpoint.fallbackStartTurn;
}

/** Whether a checkpoint is currently inside its active window. */
export function isCheckpointActive(
  checkpoint: EraCheckpoint,
  startTurn: number,
  currentTurn: number
): boolean {
  return currentTurn >= startTurn && currentTurn < startTurn + checkpoint.durationTurns;
}

/** Flat per-turn magnitude a target contributes while its checkpoint is active. */
export function computeCheckpointRawDelta(
  target: EraCheckpointTarget,
  checkpoint: EraCheckpoint
): number {
  if (checkpoint.durationTurns <= 0) return 0;
  return target.totalShift / checkpoint.durationTurns;
}

/**
 * How strongly an opposing per-turn legislative shift (the SAME
 * `calculateDemographicShiftsByTarget` output real laws already produce)
 * cancels a checkpoint's pull. 1.0 = a countervailing law fighting the
 * checkpoint 1-for-1 fully cancels it, and a strong enough sustained law can
 * outright reverse it for that turn — this is the "beatable" half of gravity,
 * not rails: a player campaigning hard enough against the tide can hold a
 * targeted state.
 */
export const COUNTER_PRESSURE_MULTIPLIER = 1;

/**
 * Net a checkpoint's raw per-turn delta against an opposing legislative shift
 * already being applied to the SAME group+axis this turn. Same-direction
 * pressure (legislation reinforcing the checkpoint) is not counted — only
 * pressure pushing the OPPOSITE way offsets it, and it can fully cancel or
 * reverse the raw delta.
 */
export function applyCounterPressure(rawDelta: number, counterShiftPerTurn: number): number {
  if (rawDelta === 0 || counterShiftPerTurn === 0) return rawDelta;
  const opposes = Math.sign(rawDelta) !== Math.sign(counterShiftPerTurn);
  if (!opposes) return rawDelta;
  return rawDelta + counterShiftPerTurn * COUNTER_PRESSURE_MULTIPLIER;
}

/**
 * Apply one turn's net delta to a lean value, clamped to the shared axis.
 * Re-exported from `durableRealignment.ts` (kept under this name here for
 * every existing import of the checkpoint engine): checkpoints are one of
 * three durable-relocation channels now (alongside designated legislation and
 * the SCOTUS demographic-signal consumer) sharing this exact clamp step.
 */
export { applyDurableStep as applyCheckpointStep } from "./durableRealignment";
