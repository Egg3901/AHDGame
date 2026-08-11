import { archetypeValuesToBuckets } from "./archetypeBucketMap";
import { bucketLabel } from "./bucketLabels";
import { getCountryArchetypeBuckets } from "./countryArchetypeBuckets";

/**
 * How to describe a policy's approval effects to the player.
 *
 * Bill effects are authored per ARCHETYPE, and the engine projects them onto
 * Layer-1 buckets before they touch any voter. Describing them in buckets is
 * therefore closer to what actually happens — the player reads the same groups
 * the vote engine moves.
 *
 * This now works in every country. The two things that used to block it are
 * gone: each country's buckets have authored names in its own language
 * (`bucketLabelsByCountry.ts`), and the weights needed to project live in a
 * generated client-safe table rather than in the ~460KB seed module.
 *
 * Effects are described in the country's own bucket vocabulary and language, so
 * a German bill reads "Hochschulabschluss" and a Japanese one
 * "大学卒 (University)" — the same words those players see in the demographics
 * tab and the targeting picker.
 */

export interface EffectAudienceRow {
  /** Stable key for React. */
  id: string;
  label: string;
  value: number;
}

/**
 * True where effects can be described in buckets. Every country with a Layer-1
 * model qualifies; a world without one keeps archetype names, since it has no
 * buckets to name.
 */
export function bucketsDescribeCountry(billCountry?: string): boolean {
  if (!billCountry || billCountry.toUpperCase() === "US") return true;
  return getCountryArchetypeBuckets(billCountry) !== null;
}

/**
 * Approval effects as player-facing rows, largest magnitude first.
 *
 * `archetypeName` resolves a legacy archetype id; it is only consulted on the
 * fallback path.
 */
export function describeApprovalEffects(
  approvals: Record<string, number>,
  billCountry: string | undefined,
  archetypeName: (id: string) => string
): EffectAudienceRow[] {
  const rows: EffectAudienceRow[] = bucketsDescribeCountry(billCountry)
    ? Object.entries(archetypeValuesToBuckets(approvals, billCountry)).map(([id, value]) => ({
        id,
        label: bucketLabel(id, billCountry),
        value,
      }))
    : Object.entries(approvals).map(([id, value]) => ({
        id,
        label: archetypeName(id),
        value,
      }));

  return rows
    .filter((r) => r.value !== 0 && Number.isFinite(r.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
