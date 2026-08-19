import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { GRANULAR_DIMENSIONS } from "./granularCells";
import { BUCKET_LABELS, bucketLabel, dimensionLabelFor } from "./bucketLabels";

/**
 * The Layer-1 buckets a player can aim a turnout action at, for one country.
 *
 * There is no single bucket vocabulary. The US census model has
 * `race/age/education/wealth`; every other country's model has
 * `ethnicity/age/education/income/urbanization`, and the KEYS inside those
 * dimensions are country-specific — UK education is
 * `no_qualifications … degree_plus`, Germany's is `no_degree … hochschulabschluss`,
 * Brazil's has three levels where Japan's has five. Only `age` happens to share
 * keys everywhere.
 *
 * So a targeting UI cannot offer a fixed list. It has to read the country's own
 * substrate, or it offers buckets that country does not have and the action is
 * charged for a modifier that lands on nobody — the exact failure this work
 * exists to remove.
 */

export interface TurnoutTargetSection {
  dim: string;
  dimLabel: string;
  options: Array<{ id: string; label: string }>;
}

/**
 * Target sections for a country, in the model's own dimension order.
 *
 * Non-US bucket keys have no curated label yet, so they fall back to a
 * humanized key (`no_qualifications` → "No Qualifications"). That reads as the
 * real-world term a player of that country would recognise, which is why it is
 * an acceptable default — but it is a fallback, not authored copy.
 */
export function getTurnoutTargetsForCountry(
  countryId: string,
  preset?: string | null
): TurnoutTargetSection[] {
  if (countryId.toUpperCase() === "US") {
    return GRANULAR_DIMENSIONS.map((dim) => ({
      dim,
      dimLabel: dimensionLabelFor(dim, countryId),
      options: Object.entries(BUCKET_LABELS[dim]).map(([key, label]) => ({
        id: `${dim}:${key}`,
        label,
      })),
    }));
  }

  const model = getCountryLayer1Model(
    countryId.toUpperCase(),
    eraForPreset(preset ?? DEFAULT_SEED_PRESET)
  );
  if (!model) return [];
  return model.dims.map((dim) => ({
    dim,
    dimLabel: dimensionLabelFor(dim, countryId),
    options: Object.keys(model.turnoutRates[dim] ?? {}).map((key) => ({
      id: `${dim}:${key}`,
      label: bucketLabel(`${dim}:${key}`, countryId),
    })),
  }));
}

/**
 * Every bucket target across every country, deduped by id and grouped by
 * dimension. For authoring surfaces that are not scoped to one country (the
 * admin law-type editor), where offering only one country's vocabulary would
 * make the others unauthorable.
 */
export function getAllTurnoutTargetOptions(): Array<{ id: string; label: string; dim: string }> {
  const seen = new Set<string>();
  const options: Array<{ id: string; label: string; dim: string }> = [];
  for (const countryId of ALL_COUNTRY_IDS) {
    for (const section of getTurnoutTargetsForCountry(countryId)) {
      for (const option of section.options) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        options.push({ id: option.id, label: option.label, dim: section.dim });
      }
    }
  }
  return options;
}

/** Every valid target id for a country — the server-side allowlist. */
export function turnoutTargetIdsForCountry(countryId: string, preset?: string | null): Set<string> {
  return new Set(
    getTurnoutTargetsForCountry(countryId, preset).flatMap((s) => s.options.map((o) => o.id))
  );
}

/**
 * True when `id` is a bucket this country's electorate actually has. Country-
 * aware on purpose: `race:black` is a real US target and a dead one in the UK.
 */
export function isTargetValidForCountry(
  id: string,
  countryId: string,
  preset?: string | null
): boolean {
  return turnoutTargetIdsForCountry(countryId, preset).has(id);
}
