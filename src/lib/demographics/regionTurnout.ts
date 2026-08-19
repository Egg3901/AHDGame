import { getStateDemographicTurnoutCollection } from "@/lib/db/collections";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";

/** Per-group turnout cell: national baseline, applied modifier, and their sum. */
export interface RegionTurnoutCell {
  baseline: number;
  modifier: number;
  actual: number;
}

/** Shared turnout payload consumed by the region page and the turnout API route. */
export interface RegionTurnoutResponse {
  stateId: string;
  /** census dimension → bucket → cell */
  turnout: Record<string, Record<string, RegionTurnoutCell>>;
  lastUpdated: string | null;
  lastDecayApplied: string | null;
}

/** US Layer-1 modifier dimensions, in canonical display order. */
const US_CATEGORIES = ["race", "age", "education", "wealth", "ideology"] as const;

function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * SSOT for a region's demographic turnout (baseline + stored modifiers → actual).
 *
 * Keyed by CENSUS DIMENSION and bucket for every country. Non-US regions used
 * to report a single `<cc>_voterGroups` archetype block, which the display
 * layer then had to convert back into census buckets through a hand-authored
 * per-country map. Reading the country's own Layer-1 `turnoutRates` removes
 * that round trip, and matches the vocabulary GOTV targeting already writes
 * modifiers in (`modifiers.<dim>.<bucket>`).
 *
 * Single source of truth for both the server-rendered region page
 * (`getRegionTurnout`) and `GET /api/country/[code]/region/[id]/turnout`. They
 * previously carried two copies of this logic that drifted: the page query
 * filtered on `{ _id, countryId }` while the route filtered on `{ _id }` only.
 * Because `_id` is the globally-unique primary key, the `countryId` predicate was
 * redundant — and it silently excluded legacy US documents seeded before the
 * `countryId` field existed, blanking the whole turnout tab. This helper queries
 * by `_id` alone and falls back to national baselines (zero modifier) when a
 * region has no document yet, so the tab always populates.
 */
export async function buildRegionTurnoutResponse(
  stateId: string,
  countryId: CountryId,
  /** Seed preset, for resolving a non-US country's era. Read from gameState when omitted. */
  preset?: string | null
): Promise<RegionTurnoutResponse> {
  const collection = await getStateDemographicTurnoutCollection();
  // `_id` is the globally-unique key — no countryId filter (legacy US docs lack it).
  const turnoutDoc = await collection.findOne({ _id: stateId });

  const turnout: Record<string, Record<string, RegionTurnoutCell>> = {};

  // Iterate the canonical baseline buckets (not the doc's keys) so every bucket
  // renders even when a region has no document or only a partial `modifiers`
  // object: baseline shows, modifier defaults 0.
  const addBuckets = (dim: string, baselines: Record<string, number>) => {
    turnout[dim] = {};
    const docModifiers = turnoutDoc?.modifiers?.[dim] as Record<string, number> | undefined;
    for (const bucket in baselines) {
      const baseline = baselines[bucket] ?? 55;
      const modifier = docModifiers?.[bucket] ?? 0;
      turnout[dim][bucket] = { baseline, modifier, actual: baseline + modifier };
    }
  };

  // Same gate as `getTurnoutTargetsForCountry`: the US census model is the one
  // that lives in `DEMOGRAPHIC_TURNOUT_RATES`; every other country's lives on
  // its own Layer-1 model.
  if (countryId.toUpperCase() === "US") {
    for (const dim of US_CATEGORIES) {
      addBuckets(dim, DEMOGRAPHIC_TURNOUT_RATES[dim] as Record<string, number>);
    }
  } else {
    // Every other country's baselines come off its own Layer-1 model, in the
    // model's own dimension vocabulary (`ethnicity/age/education/income/
    // urbanization`, with country-specific keys). A country with no model
    // returns an empty payload rather than a bucket list its electorate does
    // not have.
    const model = getCountryLayer1Model(
      countryId,
      eraForPreset(preset ?? (await getGameStatePresetOrDefault()))
    );
    for (const dim of model?.dims ?? []) {
      addBuckets(dim, (model!.turnoutRates[dim] ?? {}) as Record<string, number>);
    }
  }

  return {
    stateId,
    turnout,
    lastUpdated: toIsoStringOrNull(turnoutDoc?.lastUpdated),
    lastDecayApplied: toIsoStringOrNull(turnoutDoc?.lastDecayApplied),
  };
}
