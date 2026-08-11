import {
  getEraComposition,
  getEraPositions,
  demographicCategories,
} from "@/lib/seeds/demographicCategories";
import {
  deriveGroupPopulations,
  deriveGroupTurnout,
  deriveGroupLeanFromLayer1,
  type Layer1Config,
} from "@/lib/seeds/stateDemographicsPure";
import { calculateStateLean, getDisplayLean } from "@/lib/utils/demographics";
import type { StateDemographics, DemographicCategory } from "@/lib/db/types";
import type { EditorStateConfig, EditorLayer1Config, DerivedComposition, EraId } from "./types";
import type { CountryLayer1Model } from "@/lib/seeds/international/types";

const US_DIMS = ["race", "age", "education", "wealth", "ideology"] as const;

/** Build an editor config by overlaying DEMOGRAPHIC_POSITIONS + turnout rates onto a seed Layer1Config. */
export function editorConfigFromSeed(
  stateId: string,
  countryId: string,
  era: EraId,
  seed: Layer1Config
): EditorStateConfig {
  const dims: string[] = [...US_DIMS];
  const comp = getEraComposition(era);
  // State-aware: per-state era overrides (STATE_POSITION_OVERRIDES) apply so the
  // editor opens on the same positions the seed path uses for this state.
  const eraPositions = getEraPositions(era, stateId);
  // Use state-specific positions if available, falling back to era-global
  const statePositions = (seed as unknown as Record<string, unknown>).positions as
    Record<string, Record<string, { economicLean: number; socialLean: number }>> | undefined;
  const layer1 = {} as EditorLayer1Config;
  for (const dim of dims) {
    const out: Record<
      string,
      { share: number; turnout: number; economicLean: number; socialLean: number }
    > = {};
    for (const [key, share] of Object.entries(
      (seed as unknown as Record<string, Record<string, number>>)[dim] ?? {}
    )) {
      const pos = statePositions?.[dim]?.[key] ??
        (
          eraPositions as Record<
            string,
            Record<string, { economicLean: number; socialLean: number }>
          >
        )[dim]?.[key] ?? { economicLean: 0, socialLean: 0 };
      const turnout =
        (comp.turnoutRates as unknown as Record<string, Record<string, number>>)[dim]?.[key] ?? 55;
      out[key] = { share, turnout, economicLean: pos.economicLean, socialLean: pos.socialLean };
    }
    layer1[dim] = out;
  }
  const archetypes = comp.groupIds.map((id) => {
    const c = comp.voterGroupComposition[id];
    const name = demographicCategories[0].groups.find((g) => g.id === id)?.name ?? id;
    return {
      id,
      name,
      weights: (c?.weights ?? []).map((w) => ({
        dim: w.dim as string,
        key: w.key,
        w: w.w,
      })),
      civicMultiplier: c?.civicMultiplier ?? 1,
    };
  });
  return { era, countryId, stateId, dims, categoryId: "voterGroups", layer1, archetypes };
}

/** Reduce an editor config back to the engine's Layer1Config (shares only). */
export function toLayer1Config(cfg: EditorStateConfig): Layer1Config {
  const out: Record<string, Record<string, number>> = {};
  for (const dim of cfg.dims) {
    out[dim] = {};
    for (const [key, e] of Object.entries(cfg.layer1[dim])) out[dim][key] = e.share;
  }
  return out as unknown as Layer1Config;
}

export function editorPositionsTable(
  cfg: EditorStateConfig
): Record<string, Record<string, { economicLean: number; socialLean: number }>> {
  const out: Record<string, Record<string, { economicLean: number; socialLean: number }>> = {};
  for (const dim of cfg.dims) {
    out[dim] = {};
    for (const [key, e] of Object.entries(cfg.layer1[dim])) {
      out[dim][key] = { economicLean: e.economicLean, socialLean: e.socialLean };
    }
  }
  return out;
}

/** @internal alias kept for computeDerivedComposition */
const positionsFromEditor = editorPositionsTable;

/** Extract the global baseline turnout table (per dim/key) from the editor config. */
export function editorTurnoutTable(cfg: EditorStateConfig): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const dim of cfg.dims) {
    out[dim] = {};
    for (const [key, e] of Object.entries(cfg.layer1[dim])) {
      out[dim][key] = e.turnout;
    }
  }
  return out;
}

/** @internal alias kept for computeDerivedComposition */
const turnoutFromEditor = editorTurnoutTable;

/** Extract the per-archetype composition (Layer-1 weights + civic multiplier). */
export function editorCompositionTable(
  cfg: EditorStateConfig
): Record<string, { weights: { dim: string; key: string; w: number }[]; civicMultiplier: number }> {
  const out: Record<
    string,
    { weights: { dim: string; key: string; w: number }[]; civicMultiplier: number }
  > = {};
  for (const arch of cfg.archetypes) {
    out[arch.id] = {
      weights: arch.weights.map((w) => ({ dim: w.dim, key: w.key, w: w.w })),
      civicMultiplier: arch.civicMultiplier,
    };
  }
  return out;
}

/**
 * Apply a stored override (positions + global turnout + composition) onto an
 * editor config in place, so the editor reloads authored values. Per-state
 * Layer-1 `share` is left as census data.
 */
export function applyOverrideToEditorConfig(
  cfg: EditorStateConfig,
  override: {
    positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
    turnout?: Record<string, Record<string, number>>;
    composition?: Record<
      string,
      { weights: { dim: string; key: string; w: number }[]; civicMultiplier: number }
    >;
  }
): void {
  if (override.positions || override.turnout) {
    for (const dim of cfg.dims) {
      const pos = override.positions?.[dim];
      const tr = override.turnout?.[dim];
      for (const key of Object.keys(cfg.layer1[dim] ?? {})) {
        if (pos?.[key]) {
          cfg.layer1[dim][key].economicLean = pos[key].economicLean;
          cfg.layer1[dim][key].socialLean = pos[key].socialLean;
        }
        if (tr?.[key] !== undefined) cfg.layer1[dim][key].turnout = tr[key];
      }
    }
  }
  if (override.composition) {
    for (const arch of cfg.archetypes) {
      const c = override.composition[arch.id];
      if (!c) continue;
      arch.weights = c.weights.map((w) => ({ dim: w.dim, key: w.key, w: w.w }));
      arch.civicMultiplier = c.civicMultiplier;
    }
  }
}

/**
 * Build an EditorStateConfig from a CountryLayer1Model for a specific region.
 * Works for any country (UK/DE/JP/IE/BR/CN) by reading the model's census,
 * turnoutRates, positions, and composition tables.
 */
export function editorConfigFromCountryModel(
  model: CountryLayer1Model,
  regionId: string,
  era: EraId,
  archetypeNames: Record<string, string>
): EditorStateConfig {
  const layer1 = {} as EditorLayer1Config;
  const regionCensus = model.census[regionId] ?? {};
  for (const dim of model.dims) {
    const out: Record<
      string,
      { share: number; turnout: number; economicLean: number; socialLean: number }
    > = {};
    for (const [key, share] of Object.entries(regionCensus[dim] ?? {})) {
      const turnout = model.turnoutRates[dim]?.[key] ?? 55;
      const pos = model.positions[dim]?.[key] ?? { economicLean: 0, socialLean: 0 };
      out[key] = { share, turnout, economicLean: pos.economicLean, socialLean: pos.socialLean };
    }
    layer1[dim] = out;
  }
  const archetypes = model.groupIds.map((id) => ({
    id,
    name: archetypeNames[id] ?? id,
    weights: (model.composition[id]?.weights ?? []).map((w) => ({
      dim: w.dim,
      key: w.key,
      w: w.w,
    })),
    civicMultiplier: model.composition[id]?.civicMultiplier ?? 1,
  }));
  return {
    era,
    countryId: model.countryId,
    stateId: regionId,
    dims: model.dims,
    categoryId: model.categoryId,
    layer1,
    archetypes,
  };
}

/**
 * Generic compute that works for any country/dims by reading only from cfg.
 * Mirrors the logic of deriveCountryGroupPopulations/Lean/Turnout but reads
 * from cfg.layer1 entries (share, turnout, economicLean, socialLean).
 *
 * The `categories` parameter is accepted for backward compatibility but is no
 * longer used — state lean is computed inline from the derived archetype rows
 * (turnout-weighted average), so no DemographicCategory[] is needed.
 */
export function computeDerivedCompositionGeneric(
  cfg: EditorStateConfig,

  _categories?: DemographicCategory[]
): DerivedComposition {
  // Round to 1 decimal to match the seed path (international/derive.ts clampLean
  // and stateDemographics.ts clampLean both use 1dp). Keeping 2dp here made the
  // editor preview/CSV disagree with what a reseed actually writes.
  function clampLean(v: number): number {
    return Math.max(-5, Math.min(5, Math.round(v * 10) / 10));
  }

  // Population (voting-pool-weighted, then normalized)
  const rawPop: Record<string, number> = {};
  for (const arch of cfg.archetypes) {
    let score = 0;
    for (const { dim, key, w } of arch.weights) {
      const entry = cfg.layer1[dim]?.[key];
      if (!entry) continue;
      score += w * (entry.share / 100) * (entry.turnout / 100);
    }
    score *= arch.civicMultiplier;
    rawPop[arch.id] = score;
  }
  const popTotal = Object.values(rawPop).reduce((a, b) => a + b, 0) || 1;

  // Economic/Social lean + turnout per archetype
  const rows = cfg.archetypes.map((arch) => {
    const populationShare = Math.round((rawPop[arch.id] / popTotal) * 10000) / 100;

    // lean: Σ(w × share/100 × lean) / Σ(w × share/100)
    let wSum = 0,
      eSum = 0,
      sSum = 0;
    for (const { dim, key, w } of arch.weights) {
      const entry = cfg.layer1[dim]?.[key];
      if (!entry) continue;
      const weight = w * (entry.share / 100);
      wSum += weight;
      eSum += weight * entry.economicLean;
      sSum += weight * entry.socialLean;
    }
    const economicLean = wSum > 0 ? clampLean(eSum / wSum) : 0;
    const socialLean = wSum > 0 ? clampLean(sSum / wSum) : 0;

    // turnout: weighted average of entry.turnout by w, × civicMultiplier
    const tw = arch.weights.reduce((a, c) => a + c.w, 0) || 1;
    let baseTurnout = 0;
    for (const { dim, key, w } of arch.weights) {
      const entry = cfg.layer1[dim]?.[key];
      if (!entry) continue;
      baseTurnout += entry.turnout * (w / tw);
    }
    const turnout = Math.round(Math.max(25, Math.min(85, baseTurnout * arch.civicMultiplier)));

    return { id: arch.id, name: arch.name, populationShare, economicLean, socialLean, turnout };
  });

  const poolTotal =
    rows.reduce((s, r) => s + (r.populationShare / 100) * (r.turnout / 100), 0) || 1;
  const archetypes = rows.map((r) => ({
    id: r.id,
    name: r.name,
    populationShare: r.populationShare,
    votingPoolShare:
      Math.round((((r.populationShare / 100) * (r.turnout / 100)) / poolTotal) * 10000) / 100,
    economicLean: r.economicLean,
    socialLean: r.socialLean,
    turnout: r.turnout,
  }));

  // State lean: turnout-weighted average across archetypes (no DemographicCategory[] needed)
  let weightSum = 0,
    econSum = 0,
    socialSum = 0;
  for (const r of rows) {
    const w = (r.populationShare / 100) * (r.turnout / 100);
    weightSum += w;
    econSum += w * r.economicLean;
    socialSum += w * r.socialLean;
  }
  const stateEconomicLean = weightSum > 0 ? clampLean(econSum / weightSum) : 0;
  const stateSocialLean = weightSum > 0 ? clampLean(socialSum / weightSum) : 0;

  return {
    archetypes,
    stateEconomicLean,
    stateSocialLean,
    stateDisplayLean: getDisplayLean(stateEconomicLean, stateSocialLean),
  };
}

/**
 * Compute the full derived composition for the editor, using the SAME engine
 * functions as seed time. Archetype leans use deriveGroupLeanFromLayer1; population
 * and turnout use deriveGroupPopulations/deriveGroupTurnout; the state lean uses
 * the canonical calculateStateLean (turnout-weighted).
 *
 * For US (cfg.countryId === "US"): uses the US engine path (unchanged).
 * For non-US: calls computeDerivedCompositionGeneric with the provided categories.
 */
export function computeDerivedComposition(
  cfg: EditorStateConfig,
  _categories?: DemographicCategory[]
): DerivedComposition {
  if (cfg.countryId !== "US") {
    return computeDerivedCompositionGeneric(cfg);
  }
  const era = cfg.era;
  const seed = toLayer1Config(cfg);
  const comp = getEraComposition(era);
  const positionsOverride = positionsFromEditor(cfg);
  const turnoutOverride = turnoutFromEditor(cfg);
  // Feed the editor's turnout + composition edits into the engine so the US
  // preview reflects them (and matches what a reseed with these overrides
  // writes). Unedited configs reproduce the static composition, so this is a
  // no-op until the admin actually changes weights/civic/turnout.
  const override = {
    positions: positionsOverride,
    turnout: turnoutOverride,
    composition: editorCompositionTable(cfg),
  };
  const populations = deriveGroupPopulations(seed, era, override);

  const groups: StateDemographics["groups"] = {};
  const rows = comp.groupIds.map((id) => {
    const lean = deriveGroupLeanFromLayer1(id, seed, era, positionsOverride, override, cfg.stateId);
    const turnout = deriveGroupTurnout(
      id,
      seed,
      comp.defaultTurnouts[id] ?? 55,
      era,
      turnoutOverride as Parameters<typeof deriveGroupTurnout>[4],
      override
    );
    const populationShare = Math.round((populations[id] ?? 0) * 100) / 100;
    groups[id] = {
      population: populationShare,
      economicLean: lean.economicLean,
      socialLean: lean.socialLean,
      turnout,
    };
    return {
      id,
      name: cfg.archetypes.find((a) => a.id === id)?.name ?? id,
      populationShare,
      economicLean: lean.economicLean,
      socialLean: lean.socialLean,
      turnout,
      _poolWeight: (populationShare / 100) * (turnout / 100),
    };
  });

  const poolTotal = rows.reduce((s, r) => s + r._poolWeight, 0) || 1;
  const archetypes = rows.map((r) => ({
    id: r.id,
    name: r.name,
    populationShare: r.populationShare,
    votingPoolShare: Math.round((r._poolWeight / poolTotal) * 10000) / 100,
    economicLean: r.economicLean,
    socialLean: r.socialLean,
    turnout: r.turnout,
  }));

  const stateDemo: StateDemographics = {
    _id: cfg.stateId,
    countryId: cfg.countryId as StateDemographics["countryId"],
    categoryWeights: { voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };
  const lean = calculateStateLean(stateDemo, demographicCategories);
  return {
    archetypes,
    stateEconomicLean: lean.economicLean,
    stateSocialLean: lean.socialLean,
    stateDisplayLean: getDisplayLean(lean.economicLean, lean.socialLean),
  };
}
