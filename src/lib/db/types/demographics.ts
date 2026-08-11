import type { CountryId } from "../../constants/countries";

/**
 * Known US demographic category IDs. The type is widened to `string` to allow
 * country-specific categories (e.g. UK) without requiring this union to grow.
 */
export type DemographicCategoryId =
  "race" | "gender" | "education" | "wealth" | "age" | "ideology" | "voterGroups" | (string & {});

export interface DemographicGroup {
  id: string;
  name: string;
  defaultEconomicLean: number;
  defaultSocialLean: number;
  defaultTurnout?: number;
}

export interface DemographicCategory {
  _id: DemographicCategoryId;
  name: string;
  groups: DemographicGroup[];
  defaultWeight: number;
}

export interface StateDemographicGroup {
  population: number;
  economicLean: number;
  socialLean: number;
  /** Optional state-specific turnout (0-100). When set, overrides category default; derived from underlying group composition. */
  turnout?: number;
  nameRecognition?: number;
}

/** Category weights (sum to 100). For 12 archetypes, use { voterGroups: 100 }. */
export interface CategoryWeights {
  race?: number;
  gender?: number;
  education?: number;
  wealth?: number;
  age?: number;
  ideology?: number;
  voterGroups?: number;
  [key: string]: number | undefined;
}

/**
 * Durable per-(dimension, bucket) Layer-1 census-position deltas, keyed
 * `dim -> bucketKey -> delta`. Additive on top of the era/state static
 * position tables (`DEMOGRAPHIC_POSITIONS` / `STATE_POSITION_OVERRIDES` in
 * `src/lib/seeds/demographicCategories.ts`, or a `CountryLayer1Model`'s
 * `positions` for non-US worlds) BEFORE granular-cell derivation — see
 * `applyPositionOverlay` in `src/lib/demographics/granularElectorate.ts`.
 *
 * This is the ONLY channel through which an era checkpoint
 * (`src/lib/demographics/eraCheckpoints.ts`) reaches the
 * granular vote path: that substrate derives cell leans
 * from the static position tables, not from `StateDemographicGroup`
 * leans, so an archetype-level shift on `groups[id]` (below) is invisible to
 * it. Only ever written by the era-checkpoint turn, on the
 * `demographicDefaults` collection's snapshot doc (never the live
 * `stateDemographics` doc), and only ever grows — nothing decays it, matching
 * the checkpoint's "durable base-value shift, not a capped deviation" design.
 */
export type Layer1PositionOverlay = Record<
  string,
  Record<string, { economicLean: number; socialLean: number }>
>;

/**
 * Durable per-(dimension, bucket) Layer-1 TURNOUT-RATE deltas, keyed
 * `dim -> bucketKey -> delta` (percentage points). The turnout counterpart of
 * {@link Layer1PositionOverlay} — same "durable overlay applied before cell
 * derivation" shape — but NOT a drop-in reuse of it: turnout is a single
 * bounded 0-100 percentage per bucket, not a signed two-axis
 * (economicLean/socialLean) lean, so each bucket carries one plain number
 * rather than an `{ economicLean, socialLean }` pair, and the accumulator is
 * clamped to its own signed percentage-point bound (see
 * `src/lib/demographics/durableRealignment.ts`), not the lean axis's ±5.
 *
 * This is the ONLY channel through which a durable ("permanent") turnout
 * shift — legislation's `DemographicEffect.permanent && target: "turnout"`,
 * or an era checkpoint's `axis: "turnout"` target — reaches the
 * granular vote path: cell turnout is derived from
 * `DEMOGRAPHIC_TURNOUT_RATES` bucket baselines (see
 * `buildUsTurnoutRates`/`applyTurnoutRateOverlay` in
 * `src/lib/demographics/granularElectorate.ts`), not from
 * `StateDemographicGroup.turnout` — and for any state with a registered
 * Layer-1 census, the LEGACY engine's `resolveTurnout` similarly rebuilds
 * archetype turnout from those same Layer-1 baselines and ignores the stored
 * `groups[id].turnout` drift (see `src/lib/electionEngine/resolvedTurnout.ts`).
 * An archetype-level durable write to `groups[id].turnout` still happens
 * alongside this overlay (for non-Layer-1 worlds and admin/UI reads), but on
 * its own it is invisible to both vote engines for a Layer-1 US state — this
 * overlay is what actually moves the number both paths compute from.
 *
 * Only ever written by the durable-relocation channels above, on the
 * `demographicDefaults` collection's snapshot doc (never the live
 * `stateDemographics` doc — there is no live turnout-RATE-table substrate to
 * keep in sync, unlike lean's dual live+default write), and only ever grows —
 * nothing decays it.
 */
export type Layer1TurnoutOverlay = Record<string, Record<string, number>>;

export interface StateDemographics {
  _id: string;
  countryId: CountryId;
  categoryWeights: CategoryWeights;
  groups: Record<string, StateDemographicGroup>;
  cachedEconomicLean?: number;
  cachedSocialLean?: number;
  lastUpdated: Date;
  /** See {@link Layer1PositionOverlay}. Set only on `demographicDefaults` docs. */
  layer1PositionOverrides?: Layer1PositionOverlay;
  /** See {@link Layer1TurnoutOverlay}. Set only on `demographicDefaults` docs. */
  layer1TurnoutOverrides?: Layer1TurnoutOverlay;
}
