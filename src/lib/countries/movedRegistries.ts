/**
 * The faithful-replacement table. Each entry pins one registry's pre-move value
 * against whatever replaces it, so the move can be proved to change nothing.
 *
 * ⚠️ `before` MUST read the committed snapshot fixture, never the live registry.
 * Once a registry forwards to the folder, reading it compares the new thing to
 * itself and the test passes vacuously. That is not hypothetical: it happened in
 * Plan C task C0, where rewiring `getPresetSeats` made its faithful-replacement
 * test tautological until it was rebuilt against the raw source arrays.
 *
 * Entries are added by the phase that does the moving. D1 ships the table empty.
 */
export interface MovedRegistry {
  readonly name: string;
  /** The value BEFORE the move, read from the committed snapshot. */
  readonly before: () => unknown;
  /** The folder's answer. */
  readonly after: () => unknown;
}

/**
 * Registries whose values are FUNCTIONS.
 *
 * ⚠️ `toEqual` compares functions by REFERENCE, so the ordinary harness is
 * silent on these. Capture the reference pre-move and a re-export passes
 * tautologically; re-declare the thunk and it fails despite identical behaviour.
 * Either way the plan's only proof is blind.
 *
 * In scope: SPAWN_ELECTIONS_REGISTRY (SpawnElectionsHandler), REGION_ROSTERS
 * (RosterThunk), PROFILE_REGISTRY in countryDemographics.ts, and NAME_GENERATORS
 * in nameGenerator.ts.
 *
 * ⚠️ REGION_ROSTERS is NESTED, not flat:
 * `Partial<Record<CountryId, Partial<Record<EraId, RosterThunk>>>>`. Paths must
 * walk country then era, which is why `paths` returns a list of segments rather
 * than a list of keys.
 *
 * Assert BEHAVIOUR, not identity: call the thunk, compare its resolved value,
 * and pin the key set so a silently dropped era fails.
 */
export interface MovedThunkRegistry {
  readonly name: string;
  /** Every path to a thunk, e.g. ["JP", "1991"]. */
  readonly paths: () => readonly (readonly string[])[];
  /** Resolved output keyed by joined path, captured before the move. */
  readonly resolved: () => Promise<Record<string, unknown>>;
}

/** Populated by D2 onward, one entry per registry as it moves. */
export const MOVED_REGISTRIES: readonly MovedRegistry[] = [];

/** Populated by D3 and D5, which own the function-valued registries. */
export const MOVED_THUNK_REGISTRIES: readonly MovedThunkRegistry[] = [];
