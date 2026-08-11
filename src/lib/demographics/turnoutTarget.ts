import { GRANULAR_DIMENSIONS } from "./granularCells";
import { bucketLabel } from "./bucketLabels";

/**
 * Where a turnout-targeting action writes its modifier.
 *
 * A Governor's Address targets a group of voters and stores a turnout delta on
 * `stateDemographicTurnout.modifiers`. Historically the target was one of the 12
 * US voter archetypes, and the delta landed on `modifiers.voterGroups.<id>` —
 * which only the US reads per-group. On the other 16 countries the archetype had
 * no bucket mapping, so the boost was charged and then silently applied to
 * nobody (see `getUnmappedArchetypeDrops`).
 *
 * Targets are now Layer-1 buckets (`"race:black"`), stored dim-keyed as
 * `modifiers.race.black`, which every country's granular substrate reads
 * natively. Archetype ids still resolve here so addresses delivered before this
 * change expire against the field they were written to — an in-flight boost must
 * come back off the same key it went on, or it becomes permanent.
 */

/**
 * Known Layer-1 dimension names: the US four plus the three the international
 * models add. Storage only needs to tell a bucket id from an archetype id —
 * whether a given bucket EXISTS for a country is a separate, country-aware
 * question (`isTargetValidForCountry`), because the keys inside these
 * dimensions differ per country.
 */
const KNOWN_DIMS = new Set<string>([...GRANULAR_DIMENSIONS, "ethnicity", "income", "urbanization"]);

/** True when `id` has the `"dim:key"` shape of a Layer-1 bucket. */
export function isBucketTarget(id: string): boolean {
  const [dim, ...rest] = id.split(":");
  const key = rest.join(":");
  if (!key) return false;
  return KNOWN_DIMS.has(dim);
}

/**
 * Dotted field under `modifiers` for a target id. Bucket ids go to their
 * dimension; anything else is treated as a legacy archetype id and keeps the
 * `voterGroups` field so existing rows stay reversible.
 */
export function turnoutModifierField(id: string): string {
  if (isBucketTarget(id)) {
    const [dim, ...rest] = id.split(":");
    return `${dim}.${rest.join(":")}`;
  }
  return `voterGroups.${id}`;
}

/** Full `$inc`/`$set` path for a target id. */
export function turnoutModifierPath(id: string): string {
  return `modifiers.${turnoutModifierField(id)}`;
}

/** Current stored modifier for a target id, 0 when absent. */
export function readTurnoutModifier(
  modifiers: Record<string, Record<string, number> | undefined> | undefined,
  id: string
): number {
  if (isBucketTarget(id)) {
    const [dim, ...rest] = id.split(":");
    return modifiers?.[dim]?.[rest.join(":")] ?? 0;
  }
  return modifiers?.voterGroups?.[id] ?? 0;
}

/**
 * Player-facing name for a target id, for showing what an address aimed at.
 * Legacy archetype ids humanize rather than render blank — an old address in the
 * log should still read as English.
 */
export function turnoutTargetLabel(id: string, countryId?: string): string {
  if (isBucketTarget(id)) return bucketLabel(id, countryId);
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
