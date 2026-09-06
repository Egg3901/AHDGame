/**
 * Historical realignments that shift how demographic groups vote as the eras pass
 * (Southern realignment, Civil Rights Act, Voting Rights Act, school prayer,
 * reapportionment, privacy, law and order). Each entry in ERA_CHECKPOINTS pulls
 * named census buckets in named states toward a target lean from a start year,
 * paced by Supreme Court outcomes; player legislation can push back
 * (applyCounterPressure).
 */
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
 * more (state, census bucket, axis) targets. While active it accumulates a
 * durable per-(dimension, bucket) delta on
 * `demographicDefaults.layer1PositionOverrides` every turn (see
 * `eraCheckpointTurn.ts`), which means:
 *
 *   1. it genuinely relocates the bucket's resting point (the literal "base
 *      value" the owner asked for), not a capped deviation from it;
 *   2. the existing v2 decay-to-baseline channel never fights it (the overlay
 *      is never decayed, and legislation decays toward its own baseline);
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
 * an archetype-level move is invisible to it, and that substrate's own
 * "legislation is still influential" signal (`live − demographicDefaults`,
 * used for ordinary bills) necessarily stays ~0 for a checkpoint by design
 * (point 2 above), so it can't carry a checkpoint's pull either. A checkpoint
 * therefore targets `demographicDefaults.layer1PositionOverrides` directly
 * (see `Layer1PositionOverlay` in `src/lib/db/types/demographics.ts`). See
 * `eraCheckpointTurn.ts` for where this is written and
 * `granularElectorate.ts`'s `applyPositionOverlay` for where it's read:
 * applied directly to the resolved position table BEFORE cell derivation, so
 * it moves the actual base value a cell's lean is averaged from, not a
 * post-hoc fold on the derived electorate. This overlay is never decayed.
 */
import type { CountryId } from "@/lib/constants/countries";
import { US_STATES } from "@/lib/constants";
import { yearToTurn } from "@/lib/scotus/turnConversion";
import { calendarTurn, type CalendarClock } from "@/lib/utils/gameDate";

/**
 * One (state-set, target, axis) pull of a checkpoint. `dim` + `bucket` must
 * both be set; a target that names neither is ignored at runtime by
 * `eraCheckpointTurn.ts`. Archetype (`groupId`) targets used to be the other
 * half of this union and have been converted to their bucket equivalents, so
 * a checkpoint now only ever moves Layer-1 census buckets.
 *
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
 *    archetype to carry it on the legacy live doc). `stateIds` doubles as scope: a region's state list
 *    for a REGIONAL effect, or `ALL_US_STATES` for a NATIONAL one.
 */
export interface EraCheckpointTarget {
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
 * two coupled pulls: white Southern conservatives (race:white,
 * education:no_college, age:mature) drift Republican; Black and low-income
 * Southern voters (race:black, wealth:low) consolidate further Democratic.
 * No named officeholders: the trigger is a docket case key, the targets are
 * census buckets and states, matching this project's seeds-are-structure
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
  // BUCKET targets only. These were authored as three archetype targets
  // (`rural_traditionalists`, `evangelicals`, `union_trades`) plus an
  // additive `race:white` pair; the archetype halves have been folded into
  // the buckets they already projected onto at runtime, using the same
  // ARCHETYPE_BUCKET_MAP weights the engine applied:
  //   rural_traditionalists = education:no_college .5, race:white .3, age:mature .2
  //   evangelicals          = race:white .6, education:no_college .4
  //   union_trades          = education:no_college .4, wealth:low .35, race:black .25
  // so, per axis, economicLean:
  //   race:white          3.5 + .3(4.0) + .6(3.5)          = 6.8
  //   education:no_college     .5(4.0) + .4(3.5) + .4(-1.5) = 2.8
  //   age:mature               .2(4.0)                      = 0.8
  //   wealth:low                        .35(-1.5)           = -0.525
  //   race:black                        .25(-1.5)           = -0.375
  // and socialLean:
  //   race:white          3.0 + .3(3.5) + .6(3.0)          = 5.85
  //   education:no_college     .5(3.5) + .4(3.0) + .4(-1.0) = 2.55
  //   age:mature               .2(3.5)                      = 0.7
  //   wealth:low                        .35(-1.0)           = -0.35
  //   race:black                        .25(-1.0)           = -0.25
  // Contributions landing on the same (dim, bucket, axis) are summed into one
  // target rather than emitted as duplicates; the engine adds them either way
  // (see `applyDurableBucketShift`'s accumulator), one row per bucket just
  // keeps the table readable.
  targets: [
    {
      dim: "race",
      bucket: "white",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: 6.8,
    },
    {
      dim: "race",
      bucket: "white",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: 5.85,
    },
    {
      dim: "education",
      bucket: "no_college",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: 2.8,
    },
    {
      dim: "education",
      bucket: "no_college",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: 2.55,
    },
    {
      dim: "age",
      bucket: "mature",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: 0.8,
    },
    {
      dim: "age",
      bucket: "mature",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: 0.7,
    },
    // Black Southern voters consolidate Democratic: the negative half of the
    // original coupled pull, carried by `union_trades` (the only 1953
    // archetype with a race:black weight) before the conversion.
    {
      dim: "wealth",
      bucket: "low",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: -0.525,
    },
    {
      dim: "wealth",
      bucket: "low",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: -0.35,
    },
    {
      dim: "race",
      bucket: "black",
      stateIds: DEEP_SOUTH_STATES,
      axis: "economicLean",
      totalShift: -0.375,
    },
    {
      dim: "race",
      bucket: "black",
      stateIds: DEEP_SOUTH_STATES,
      axis: "socialLean",
      totalShift: -0.25,
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
/** Great Migration destinations: the northern/western industrial states whose
 * Black electorates were free to register and vote in the late 1950s, unlike
 * the VRA-era South (whose enfranchisement is the 1965 checkpoint's job). */
const NORTHERN_BLACK_ELECTORATE_STATES = [
  "NY",
  "NJ",
  "PA",
  "OH",
  "IL",
  "MI",
  "IN",
  "MO",
  "CA",
  "MD",
  "DE",
  "CT",
  "MA",
  "RI",
  "WI",
  "MN",
] as const;

/** Yankee New England: the old rock-ribbed Republican belt whose slow
 * Democratic drift begins in the late 1950s (the 1958 wave elections). */
const YANKEE_STATES = ["ME", "NH", "VT", "MA", "RI", "CT"] as const;

/**
 * The road to 1960: the pre-civil-rights-era drift between the 1953 seed and
 * the Kennedy-Nixon dead heat. No single statute or ruling drives it (hence no
 * trigger case); it is the compound of four documented late-1950s movements:
 *
 *  - NORTHERN Black Democratic consolidation (Little Rock 1957 through the
 *    1960 sit-ins): Eisenhower took ~39% of the Black vote in 1956; Kennedy
 *    held ~70%+ in 1960. Northern-only — Southern Black voters largely could
 *    not vote until the VRA checkpoint enfranchises them.
 *  - The 1958 recession labor swing: the sharpest postwar downturn to date
 *    plus peak union density produced the 1958 Democratic wave (House D+12);
 *    working-class economics move left everywhere.
 *  - Suburbanization: the growing middle class trends mildly Republican on
 *    economics (Levittown-era homeownership), the counterweight that kept the
 *    1960 presidential result a coin flip despite the congressional wave.
 *  - Yankee New England's Democratic drift: ME/NH/VT and southern New England
 *    begin leaving the old Republican column (1958: Muskie's Maine).
 *
 * Validation anchor: the endpoint world state should rank-correlate with the
 * real 1960 state margins (MARGINS_1960 in
 * `src/lib/data/historicalPresidentialMargins.ts`) outside the org-dominated
 * South, with a near-even national mean (1960 two-party margin D+0.2; House
 * 1958 D+12 fading to 1960 D+5.5).
 */
export const ROAD_TO_1960_CHECKPOINT: EraCheckpoint = {
  id: "road-to-1960",
  countryId: "US",
  title: "The Road to 1960 — Late-Fifties Realignments",
  fallbackStartTurn: yearToTurn(1957, STARTING_YEAR_1953),
  durationTurns: 4 * 48, // 1957-1960 inclusive: Little Rock to the Kennedy-Nixon election
  historicalWindow: { startYear: 1957, endYear: 1961 },
  // Targets are (dim,bucket)-precise only: this checkpoint moves the granular
  // electorate directly, no archetype proxies.
  targets: [
    // Northern Black consolidation: position and (urban-machine registration)
    // turnout, both modest against the VRA-era shifts that follow.
    {
      dim: "race",
      bucket: "black",
      stateIds: NORTHERN_BLACK_ELECTORATE_STATES,
      axis: "economicLean",
      totalShift: -1.0,
    },
    {
      dim: "race",
      bucket: "black",
      stateIds: NORTHERN_BLACK_ELECTORATE_STATES,
      axis: "socialLean",
      totalShift: -0.5,
    },
    {
      dim: "race",
      bucket: "black",
      stateIds: NORTHERN_BLACK_ELECTORATE_STATES,
      axis: "turnout",
      totalShift: 5,
    },
    // 1958 recession labor swing.
    {
      dim: "education",
      bucket: "no_college",
      stateIds: ALL_US_STATES,
      axis: "economicLean",
      totalShift: -0.75,
    },
    // Suburbanization counterweight: middle-class economics drift right.
    {
      dim: "wealth",
      bucket: "middle",
      stateIds: ALL_US_STATES,
      axis: "economicLean",
      totalShift: 0.6,
    },
    // Yankee New England leaves the Republican column, slowly.
    {
      dim: "race",
      bucket: "white",
      stateIds: YANKEE_STATES,
      axis: "economicLean",
      totalShift: -0.75,
    },
    {
      dim: "race",
      bucket: "white",
      stateIds: YANKEE_STATES,
      axis: "socialLean",
      totalShift: -0.25,
    },
  ],
};

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
 * a national religious-conservative bucket nudge (race:white,
 * education:no_college) PLUS an additional regional (Deep South + Midwest)
 * top-up on the same buckets and axis, demonstrating a
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
  // Converted from two `evangelicals` archetype targets (national +1.0, South
  // and Midwest top-up +1.0) to the buckets they already projected onto:
  // ARCHETYPE_BUCKET_MAP.evangelicals = race:white .6, education:no_college .4.
  targets: [
    // National baseline (all US states).
    { dim: "race", bucket: "white", stateIds: ALL_US_STATES, axis: "socialLean", totalShift: 0.6 },
    {
      dim: "education",
      bucket: "no_college",
      stateIds: ALL_US_STATES,
      axis: "socialLean",
      totalShift: 0.4,
    },
    // Regional top-up: strongest in the South and Midwest.
    {
      dim: "race",
      bucket: "white",
      stateIds: [...DEEP_SOUTH_STATES, ...MIDWEST_STATES],
      axis: "socialLean",
      totalShift: 0.6,
    },
    {
      dim: "education",
      bucket: "no_college",
      stateIds: [...DEEP_SOUTH_STATES, ...MIDWEST_STATES],
      axis: "socialLean",
      totalShift: 0.4,
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
  ROAD_TO_1960_CHECKPOINT,
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
  docketCase: DocketCaseLookupEntry | undefined,
  /**
   * Pre-iteration clock, so both branches below return a turn in the SAME
   * space. `fallbackStartTurn` is authored as `yearToTurn(...)`, a CALENDAR
   * turn, but `decidedAtTurn` is stamped with the raw `currentTurn`; on a world
   * with a founding phase those are a game year apart, so the window used to
   * open a year early or late depending on which branch resolved (#1208).
   * Omitted (or empty) on worlds with no founding phase, where it is identity.
   */
  clock?: CalendarClock
): number {
  if (!checkpoint.triggerCaseKey) return checkpoint.fallbackStartTurn;
  if (!docketCase || docketCase.status !== "decided") return checkpoint.fallbackStartTurn;
  if (docketCase.outcome === "affirmed" && typeof docketCase.decidedAtTurn === "number") {
    return calendarTurn(docketCase.decidedAtTurn, clock);
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
