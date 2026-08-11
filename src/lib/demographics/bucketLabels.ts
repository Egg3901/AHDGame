import { GRANULAR_DIMENSIONS, type GranularDim } from "./granularCells";
import { COUNTRY_BUCKET_LABELS } from "./bucketLabelsByCountry";

/**
 * Player-facing names for the Layer-1 electorate buckets.
 *
 * The granular cell model is the vote engine, but its bucket keys are internal
 * (`no_college`, `mid`, `other`). Archetype labels — "Retirees", "Soccer Moms" —
 * are being removed from the interface entirely, so every surface that used to
 * name a voter archetype needs a name for a bucket instead.
 *
 * Naming rules, because these are read by players and not by us:
 *  - Describe the PEOPLE, not the data field. "Graduates", not "Education:
 *    graduate".
 *  - No jargon from the model. A player should not have to learn the word
 *    "bucket" or "Layer-1" to target a group.
 *  - Neutral. These are demographic facts, not judgements, and they appear next
 *    to political actions aimed at them.
 */
export const BUCKET_LABELS: Record<GranularDim, Record<string, string>> = {
  race: {
    white: "White voters",
    black: "Black voters",
    hispanic: "Hispanic voters",
    asian: "Asian voters",
    other: "Other backgrounds",
  },
  age: {
    young: "Under 30s",
    mid: "30s and 40s",
    mature: "50s and 60s",
    senior: "Over 65s",
  },
  education: {
    no_college: "No degree",
    college: "Degree holders",
    graduate: "Postgraduates",
  },
  wealth: {
    low: "Lower income",
    middle: "Middle income",
    high: "Higher income",
  },
};

/** Player-facing name for a dimension itself, for grouping headers. */
export const DIMENSION_LABELS: Record<GranularDim, string> = {
  race: "Background",
  age: "Age",
  education: "Education",
  wealth: "Income",
};

/**
 * Label for a `"dim:key"` bucket id, the form the projection and the cell
 * `bucketWeights` both use. Falls back to a readable version of the raw key
 * rather than throwing or rendering blank — an unlabelled bucket should look
 * unpolished, never break the page or silently vanish from a list.
 */
export function bucketLabel(bucketId: string, countryId?: string): string {
  const [dim, ...rest] = bucketId.split(":");
  const key = rest.join(":");
  // The country's own language first — see `bucketLabelsByCountry.ts`. Falls
  // back to the US labels, then to a humanised key, so a country with no table
  // yet renders unpolished rather than blank.
  const native = countryId
    ? COUNTRY_BUCKET_LABELS[countryId.toUpperCase()]?.buckets[dim]?.[key]
    : undefined;
  if (native) return native;
  const label = BUCKET_LABELS[dim as GranularDim]?.[key];
  if (label) return label;
  return (key || bucketId).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Player-facing dimension header, in the country's own language when known. */
export function dimensionLabelFor(dim: string, countryId?: string): string {
  const native = countryId ? COUNTRY_BUCKET_LABELS[countryId.toUpperCase()]?.dims[dim] : undefined;
  if (native) return native;
  return (
    DIMENSION_LABELS[dim as GranularDim] ??
    dim.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Every bucket id, as `"dim:key"`, in stable dimension order. */
export function allBucketIds(): string[] {
  return GRANULAR_DIMENSIONS.flatMap((dim) =>
    Object.keys(BUCKET_LABELS[dim]).map((key) => `${dim}:${key}`)
  );
}

/** Bucket ids grouped by dimension, for a sectioned picker. */
export function bucketOptionsByDimension(): Array<{
  dim: GranularDim;
  dimLabel: string;
  options: Array<{ id: string; label: string }>;
}> {
  return GRANULAR_DIMENSIONS.map((dim) => ({
    dim,
    dimLabel: DIMENSION_LABELS[dim],
    options: Object.entries(BUCKET_LABELS[dim]).map(([key, label]) => ({
      id: `${dim}:${key}`,
      label,
    })),
  }));
}
