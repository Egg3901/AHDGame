import type { EraId } from "@/lib/seeds/presetSelector";

/** A single Layer-1 → archetype composition weight. */
export interface DemographicCompositionWeight {
  dim: string;
  key: string;
  w: number;
}

/** Per-archetype composition override: which Layer-1 keys feed it and its civic multiplier. */
export interface DemographicCompositionOverride {
  weights: DemographicCompositionWeight[];
  civicMultiplier: number;
}

/** Per-country-per-era runtime override of the global Layer-1 demographic model,
 *  authored via the Position Editor and consumed by the gated seed path.
 *
 *  All fields except `positions` are optional so older docs (positions-only)
 *  keep loading. The global fields below are the ones that are genuinely shared
 *  across regions for a country+era (the composition + position + baseline
 *  turnout tables). Per-state Layer-1 `share` stays census-driven and is NOT
 *  persisted here — the editor edits it as a per-state preview only.
 *
 *  _id is a composite key: `${countryId}:${era}` e.g. "US:2019", "UK:1979" */
export interface DemographicConfigOverride {
  _id: string; // `${countryId}:${era}`
  countryId: string;
  era: EraId;
  /** Econ/social positions per Layer-1 dimension/key. */
  positions: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
  /** Global baseline turnout rates per Layer-1 dimension/key (%). */
  turnout?: Record<string, Record<string, number>>;
  /** Per-archetype composition (Layer-1 weights + civic multiplier). */
  composition?: Record<string, DemographicCompositionOverride>;
  updatedAt: Date;
  updatedBy?: string;
}
