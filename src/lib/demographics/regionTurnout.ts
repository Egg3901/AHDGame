import { getStateDemographicTurnoutCollection } from "@/lib/db/collections";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import type { CountryId } from "@/lib/constants/countries";
import {
  getVoterGroupBaselines,
  getDemographicCategoriesForCountry,
} from "@/lib/demographics/countryDemographics";

/** Per-group turnout cell: national baseline, applied modifier, and their sum. */
export interface RegionTurnoutCell {
  baseline: number;
  modifier: number;
  actual: number;
}

/** Shared turnout payload consumed by the region page and the turnout API route. */
export interface RegionTurnoutResponse {
  stateId: string;
  /** category/bucket → group → cell */
  turnout: Record<string, Record<string, RegionTurnoutCell>>;
  lastUpdated: string | null;
  lastDecayApplied: string | null;
}

/** US Layer-1 modifier buckets, in canonical display order. */
const US_CATEGORIES = ["race", "age", "education", "wealth", "ideology"] as const;

function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * SSOT for a region's demographic turnout (baseline + stored modifiers → actual).
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
  countryId: CountryId
): Promise<RegionTurnoutResponse> {
  const collection = await getStateDemographicTurnoutCollection();
  // `_id` is the globally-unique key — no countryId filter (legacy US docs lack it).
  const turnoutDoc = await collection.findOne({ _id: stateId });

  const turnout: Record<string, Record<string, RegionTurnoutCell>> = {};

  // Voter-group countries (UK/JP/DE/IE/CN/BR) store turnout under a single
  // `<cc>_voterGroups` bucket; the SSOT supplies baselines + the bucket key.
  // US returns null here and falls to the Layer-1 branch below.
  const voterGroupBaselines = getVoterGroupBaselines(countryId);

  if (voterGroupBaselines) {
    const voterGroupKey = getDemographicCategoriesForCountry(countryId)[0].key;
    turnout[voterGroupKey] = {};
    const modifiers =
      (turnoutDoc?.modifiers?.[voterGroupKey] as Record<string, number> | undefined) ?? {};
    for (const [group, baseline] of Object.entries(voterGroupBaselines)) {
      const modifier = modifiers[group] ?? 0;
      turnout[voterGroupKey][group] = { baseline, modifier, actual: baseline + modifier };
    }
  } else {
    // US Layer-1 categories. Iterate the canonical baseline groups (not the
    // doc's keys) so every group renders even when a region has no document or
    // only a partial `modifiers` object — baseline shows, modifier defaults 0.
    for (const category of US_CATEGORIES) {
      turnout[category] = {};
      const baselineGroups = DEMOGRAPHIC_TURNOUT_RATES[category] as Record<string, number>;
      const docModifiers = turnoutDoc?.modifiers?.[category] as Record<string, number> | undefined;
      for (const group in baselineGroups) {
        const baseline = baselineGroups[group] ?? 55;
        const modifier = docModifiers?.[group] ?? 0;
        turnout[category][group] = { baseline, modifier, actual: baseline + modifier };
      }
    }
  }

  return {
    stateId,
    turnout,
    lastUpdated: toIsoStringOrNull(turnoutDoc?.lastUpdated),
    lastDecayApplied: toIsoStringOrNull(turnoutDoc?.lastDecayApplied),
  };
}
