/**
 * Checks if a demographic is within 2 points of a party/character position on both axes.
 * Used to determine eligible demographics for party GOTV spending.
 *
 * @param partyEcon - Party economic position (-5 to +5)
 * @param partySocial - Party social position (-5 to +5)
 * @param demoEcon - Demographic economic lean (-5 to +5)
 * @param demoSocial - Demographic social lean (-5 to +5)
 * @returns true if within 2 points on BOTH axes, false otherwise
 */
export function isWithinTwoPoints(
  partyEcon: number,
  partySocial: number,
  demoEcon: number,
  demoSocial: number
): boolean {
  const econDiff = Math.abs(partyEcon - demoEcon);
  const socialDiff = Math.abs(partySocial - demoSocial);
  return econDiff <= 2 && socialDiff <= 2;
}

/**
 * Calculates alignment multiplier for canvassing effectiveness.
 * Uses Manhattan distance with 0.15 penalty per point, minimum 0.1.
 *
 * Perfect alignment (distance 0) = 1.0× effectiveness
 * Moderate misalignment (distance 3) = 0.55× effectiveness
 * Maximum misalignment (distance 6+) = 0.1× effectiveness
 *
 * @param charEcon - Character economic position (-5 to +5)
 * @param charSocial - Character social position (-5 to +5)
 * @param demoEcon - Demographic economic lean (-5 to +5)
 * @param demoSocial - Demographic social lean (-5 to +5)
 * @returns Multiplier from 0.1 to 1.0
 */
export function calculateAlignmentMultiplier(
  charEcon: number,
  charSocial: number,
  demoEcon: number,
  demoSocial: number
): number {
  const distance = Math.abs(charEcon - demoEcon) + Math.abs(charSocial - demoSocial);
  const multiplier = 1.0 - distance * 0.15;
  return Math.max(0.1, multiplier);
}

export interface DemographicGroup {
  category: string;
  group: string;
  economicLean: number;
  socialLean: number;
}

// LAYER1_DEMOGRAPHICS (US Layer-1 leans) lives in `@/lib/demographics/usDemographics`
// so the country demographics SSOT can import it without a runtime import cycle.
// Re-exported here to preserve this module's long-standing public API.
export { LAYER1_DEMOGRAPHICS } from "@/lib/demographics/usDemographics";
import { LAYER1_DEMOGRAPHICS } from "@/lib/demographics/usDemographics";

/**
 * Demographics that can be targeted by GOTV/suppression spending
 * (all Layer 1 groups except ideology, which cannot be directly targeted).
 */
export const TARGETABLE_DEMOGRAPHICS = LAYER1_DEMOGRAPHICS.filter((d) => d.category !== "ideology");

/** Unique targetable categories derived from TARGETABLE_DEMOGRAPHICS. */
export const TARGETABLE_CATEGORIES = [...new Set(TARGETABLE_DEMOGRAPHICS.map((d) => d.category))];

/** Human-readable labels for targetable demographic categories. */
export const DEMOGRAPHIC_CATEGORY_LABELS: Record<string, string> = {
  race: "Race",
  age: "Age",
  education: "Education",
  wealth: "Wealth",
};

/**
 * Human-readable labels for demographic groups.
 */
export const DEMOGRAPHIC_LABELS: Record<string, string> = {
  white: "White",
  black: "Black",
  hispanic: "Hispanic",
  asian: "Asian",
  other: "Other Races",
  young: "Young (18–29)",
  mid: "Middle-Aged (30–49)",
  mature: "Mature (50–64)",
  senior: "Senior (65+)",
  no_college: "No College Degree",
  college: "College Educated",
  graduate: "Graduate Degree",
  low: "Low Income",
  middle: "Middle Income",
  high: "High Income",
};

/**
 * Scaling constant: how many raw dollars produce 1 percentage-point of turnout boost.
 * e.g. $5,000 spent on one group → 5000 / 5000 = 1.0 pp (before alignment & diminishing returns).
 */
export const DOLLARS_PER_TURNOUT_POINT = 5000;

/**
 * Filters demographics that are within 2 points of party position (both axes).
 * Used by party GOTV system to determine which demographics receive passive spending.
 *
 * @param partyEcon - Party economic position (-5 to +5)
 * @param partySocial - Party social position (-5 to +5)
 * @param allDemographics - Array of all demographics with their leans
 * @returns Filtered array of eligible demographics
 */
export function getEligibleDemographics(
  partyEcon: number,
  partySocial: number,
  allDemographics: DemographicGroup[]
): DemographicGroup[] {
  return allDemographics.filter((demo) =>
    isWithinTwoPoints(partyEcon, partySocial, demo.economicLean, demo.socialLean)
  );
}

// ─── Country-Aware Helpers ────────────────────────────────────────────────────
//
// Country demographic categories/groups live in the SSOT
// (`@/lib/demographics/countryDemographics`), derived from each country's seed.
// These helpers adapt that SSOT to the shapes the party GOTV system expects.
// US groups/leans remain defined above (LAYER1_DEMOGRAPHICS); the SSOT imports
// them for the US profile, so this file stays the US source of truth.

import { getDemographicCategoriesForCountry } from "@/lib/demographics/countryDemographics";

/**
 * Returns the targetable demographics for a given country.
 * Ideology is excluded (matches the US TARGETABLE_DEMOGRAPHICS rule); voter-group
 * countries have no ideology category, so all their groups remain targetable.
 */
export function getTargetableDemographics(countryId: string): DemographicGroup[] {
  return getDemographicCategoriesForCountry(countryId)
    .flatMap((cat) =>
      cat.groups.map((g) => ({
        category: cat.key,
        group: g.id,
        economicLean: g.economicLean,
        socialLean: g.socialLean,
      }))
    )
    .filter((d) => d.category !== "ideology");
}

/** Returns the targetable categories for a given country. */
export function getTargetableCategories(countryId: string): string[] {
  return [...new Set(getTargetableDemographics(countryId).map((d) => d.category))];
}

/** Returns category labels (key → label) for a given country. */
export function getCategoryLabels(countryId: string): Record<string, string> {
  return Object.fromEntries(
    getDemographicCategoriesForCountry(countryId).map((c) => [c.key, c.label])
  );
}

/** Returns demographic group labels (group id → name) for a given country. */
export function getDemographicLabels(countryId: string): Record<string, string> {
  return Object.fromEntries(
    getDemographicCategoriesForCountry(countryId).flatMap((c) =>
      c.groups.map((g) => [g.id, g.name])
    )
  );
}

/** All demographic group labels (US + every voter-group country) for display lookups. */
export const ALL_DEMOGRAPHIC_LABELS: Record<string, string> = {
  ...DEMOGRAPHIC_LABELS,
  ...["UK", "JP", "DE", "IE", "CN", "BR"].reduce<Record<string, string>>(
    (acc, country) => ({ ...acc, ...getDemographicLabels(country) }),
    {}
  ),
};
