/**
 * Shared preset-aware bundle selector.
 *
 * Seed lanes (regions, metrics, budgets, sector weights, demographics)
 * use this to pick the correct era bundle based on the reset preset.
 * When a bundle for the requested preset is missing, falls back to the
 * `2019-default` bundle. This keeps the 2019 default behavior fixed
 * while allowing 1991-default bundles to opt in incrementally.
 */

export type EraId = "1953" | "1979" | "1991" | "1999" | "2007" | "2019" | "2023";

export type ResetPresetId =
  | "1953-default"
  | "1979-default"
  | "1991-default"
  | "1999-default"
  | "2007-default"
  | "2019-default"
  | "2023-default"
  | "empty"
  | "2019-no-parties"
  | string;

/**
 * Every 2019 fallback taken since the last reset of this list, as
 * `"label → preset"`. Module-level because seeding runs as a long batch of
 * independent lane calls and the useful artifact is the WHOLE list at the end,
 * not a line buried in the log next to each one.
 */
const fallbacksTaken: Array<{ label: string; preset: string }> = [];

/** Snapshot of the fallbacks recorded so far (most recent last). */
export function getPresetFallbacks(): ReadonlyArray<{ label: string; preset: string }> {
  return [...fallbacksTaken];
}

/**
 * Record a 2019 fallback taken OUTSIDE {@link selectPresetBundle} — for lanes
 * that resolve their bundle with a `switch` rather than a record lookup, and so
 * cannot route through it.
 *
 * `getPresetSeats` is the case this exists for: its `default:` branch hands back
 * the entire 2020 chamber roster for any preset it does not recognise, which is
 * how 1999/2007/2023 came to seed 1,004 seats identical to 2019-default without
 * anything saying so. Applies the same era guard — `empty` and
 * `2019-no-parties` ARE the 2019 era, so resolving to its data is the right
 * answer rather than a gap.
 */
export function recordPresetFallback(label: string, preset: string): void {
  if (eraForPreset(preset) !== "2019") fallbacksTaken.push({ label, preset });
}

/** Clear the record — call at the start of a seed run. */
export function resetPresetFallbacks(): void {
  fallbacksTaken.length = 0;
}

/**
 * Selects the bundle for the given preset, falling back to the `2019-default`
 * bundle when absent.
 *
 * THE FALLBACK IS RECORDED, NOT SILENT. It is often the right answer — Turkish
 * provinces are much the same in 1991 as in 2019, and several lanes map an era
 * to the modern bundle DELIBERATELY (`"1979-default": trRegions`), which is a
 * visible authoring decision. What was not fine is that an era with no bundle
 * quietly received 2019 data with nothing to notice, which is how a world set
 * in another decade ends up describing 2019 in places nobody checked. Every
 * fallback now names itself so the gaps can be counted and prioritised.
 *
 * `label` identifies the LANE (e.g. "seedTR:trRegions") — a report saying only
 * "something fell back" is no better than silence.
 *
 * @example
 *   const cfg = selectPresetBundle(preset, {
 *     "2019-default": NATIONAL_BUDGET_SEED_CONFIGS,
 *     "1991-default": NATIONAL_BUDGET_SEED_CONFIGS_1991,
 *   }, "budgets:national");
 */
export function selectPresetBundle<T>(
  preset: string,
  bundles: Partial<Record<ResetPresetId, T>>,
  label: string
): T {
  const requested = bundles[preset as ResetPresetId];
  if (requested != null) return requested;
  const fallback = bundles["2019-default"];
  if (fallback == null) {
    throw new Error(
      `selectPresetBundle: no bundle for preset "${preset}" and no 2019-default fallback (${label})`
    );
  }
  // `empty` and `2019-no-parties` ARE the 2019 era — resolving to its bundle is
  // the correct answer, not a gap, so they are not recorded.
  if (eraForPreset(preset) !== "2019") fallbacksTaken.push({ label, preset });
  return fallback;
}

/**
 * Non-throwing variant of {@link selectPresetBundle}: returns the requested
 * preset's bundle, then the `2019-default` fallback, then `undefined` when
 * neither exists. Use this on **render/read paths** (e.g. region pages) where a
 * country authored only for older eras (1953/1979, no 2019/1991 bundle) must
 * degrade to "no data" rather than crash the page render. Seeders keep the
 * strict throwing variant so a reset still surfaces genuinely missing data.
 */
export function selectPresetBundleOptional<T>(
  preset: string,
  bundles: Partial<Record<ResetPresetId, T>>,
  label?: string
): T | undefined {
  const requested = bundles[preset as ResetPresetId];
  if (requested != null) return requested;
  const fallback = bundles["2019-default"];
  if (fallback != null && label && eraForPreset(preset) !== "2019") {
    fallbacksTaken.push({ label, preset });
  }
  return fallback;
}

const ERA_MAP: Record<string, EraId> = {
  "1953-default": "1953",
  "1979-default": "1979",
  "1991-default": "1991",
  "1999-default": "1999",
  "2007-default": "2007",
  "2019-default": "2019",
  "2023-default": "2023",
  empty: "2019",
  "2019-no-parties": "2019",
};

/**
 * Map a preset to its "era family". Presets sharing an era can reuse the
 * same data bundle. `empty` and `2019-no-parties` follow the 2019 era.
 */
export function eraForPreset(preset: string): EraId {
  return ERA_MAP[preset] ?? "2019";
}

/**
 * The canonical preset id for an era — the inverse of {@link eraForPreset},
 * choosing the `<year>-default` id for each era family.
 *
 * Era-continuity callers need this because the era-keyed data bundles are
 * addressed by PRESET, not by era: a world that has drifted past its seed era
 * must look up the bundle for the era it has reached rather than the one it
 * started in. Going through this map (instead of building `${era}-default` by
 * hand) keeps the two directions provably in sync — the round-trip is asserted
 * in `presetSelector.test.ts`.
 */
const PRESET_FOR_ERA_MAP: Record<EraId, ResetPresetId> = {
  "1953": "1953-default",
  "1979": "1979-default",
  "1991": "1991-default",
  "1999": "1999-default",
  "2007": "2007-default",
  "2019": "2019-default",
  "2023": "2023-default",
};

export function presetForEra(era: EraId): ResetPresetId {
  return PRESET_FOR_ERA_MAP[era];
}

/**
 * Returns true when the preset belongs to a Cold-War era in which the Warsaw-Pact
 * one-party states (HU/PL/RO/YU/BG/CS) and the CPSU / Soviet Union still existed
 * as such — i.e. the 1953 and 1979 eras. By the 1991 era the bloc governments had
 * collapsed (Warsaw Pact dissolved July 1991) and later eras use the successor
 * democracies + the modern Russian Federation, so those structures must NOT seed
 * there (refs #3269). This mirrors the RU-regions era gate in bootstrapGameWorld.
 */
export function isEasternBlocEra(preset: string): boolean {
  const era = eraForPreset(preset);
  return era === "1953" || era === "1979";
}

/**
 * Presets whose fresh world is MEANT to start in the live pre-iteration
 * "founding" phase (`GameState.preIteration.active`), so a normal admin reset
 * produces a working founding cycle without anyone remembering to tick a flag.
 *
 * Why this is preset-scoped rather than global: the founding phase only makes
 * sense where the authored roster deliberately leaves the playable legislatures
 * EMPTY, to be filled by the cycle-0 founding election. Measured against
 * `getPresetSeats(preset)` on this branch:
 *
 *   1953-default   360 authored seats — US house 75 / senate 96 / governor 48
 *                  are the *priors* pool, and `bootstrapGameWorld` explicitly
 *                  skips the executive backfill under `preIteration`. Chambers
 *                  start vacant BY DESIGN and the founding election seats them.
 *   1979-default   138 authored seats — RU/DD structures only; the US/UK
 *                  chambers have no authored roster at all. Same shape as 1953,
 *                  but flipping its default is a separate product call, so it
 *                  stays opt-in (`--pre-iteration` / `preIteration: true`).
 *   1991/1999/     ~1004-1015 authored seats each — every chamber ships a full
 *   2007/2019/     historical roster that seats at bootstrap. Defaulting the
 *   2023           founding phase on here would blank those rosters and replace
 *                  a correct historical world with a synthetic one. Left OFF.
 *
 * Callers treat an explicit `preIteration` option as authoritative; this only
 * supplies the default when the caller says nothing.
 */
export function presetDefaultsToFoundingPhase(preset: string): boolean {
  return preset === "1953-default";
}

/**
 * Returns true when the preset is one of the canonical era presets that
 * has explicit data bundles. Use this to skip per-state overrides for
 * unknown presets without falling back to the wrong era.
 */
export function isKnownPreset(preset: string): boolean {
  return (
    preset === "1953-default" ||
    preset === "1979-default" ||
    preset === "1991-default" ||
    preset === "1999-default" ||
    preset === "2007-default" ||
    preset === "2019-default" ||
    preset === "2023-default" ||
    preset === "empty" ||
    preset === "2019-no-parties"
  );
}
