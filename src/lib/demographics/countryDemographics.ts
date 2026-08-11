import type { DemographicCategory } from "@/lib/db/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { LAYER1_DEMOGRAPHICS } from "@/lib/demographics/usDemographics";
import {
  DEMOGRAPHIC_LABELS as US_GROUP_LABELS,
  demographicCategories as usVoterArchetypeCategories,
} from "@/lib/seeds/demographicCategories";
import {
  ukDemographicCategories,
  UK_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/uk/ukDemographicCategories";
import {
  jpDemographicCategories,
  JP_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/jp/jpDemographicCategories";
import {
  deDemographicCategories,
  DE_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/de/deDemographicCategories";
import {
  ieDemographicCategories,
  IE_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/ie/ieDemographicCategories";
import {
  cnDemographicCategories,
  CN_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/cn/cnDemographicCategories";
import {
  brDemographicCategories,
  BR_VOTER_GROUP_BASELINES,
} from "@/lib/seeds/br/brDemographicCategories";

export interface CanvassGroup {
  id: string;
  name: string;
  economicLean: number;
  socialLean: number;
}

export interface CanvassCategory {
  /** Modifier bucket key: "race"/"age"/… (US) or "<cc>_voterGroups". */
  key: string;
  /** Display label: "Race", "Age", … or "Voter Group". */
  label: string;
  groups: CanvassGroup[];
}

/** US Layer-1 category order (matches the historical canvassing/UI ordering). */
const US_CATEGORY_ORDER = ["race", "age", "education", "wealth", "ideology"] as const;

/** US ideology group labels — `seeds/demographicCategories` only labels the non-ideology dims. */
const US_IDEOLOGY_LABELS: Record<string, string> = {
  evangelicals: "Evangelicals",
  environmentalists: "Environmentalists",
  libertarians: "Libertarians",
  progressives: "Progressives",
  patriots: "Patriots",
  gunowners: "Gun Owners",
};

const US_CATEGORY_LABELS: Record<string, string> = {
  race: "Race",
  age: "Age",
  education: "Education",
  wealth: "Wealth",
  ideology: "Ideology",
};

/** Assemble the US categories from LAYER1_DEMOGRAPHICS + label maps. */
function buildUsCategories(): CanvassCategory[] {
  return US_CATEGORY_ORDER.map((category) => ({
    key: category,
    label: US_CATEGORY_LABELS[category],
    groups: LAYER1_DEMOGRAPHICS.filter((d) => d.category === category).map((d) => ({
      id: d.group,
      name: US_GROUP_LABELS[category]?.[d.group] ?? US_IDEOLOGY_LABELS[d.group] ?? d.group,
      economicLean: d.economicLean,
      socialLean: d.socialLean,
    })),
  }));
}

/** Normalize a country's seed DemographicCategory[] into CanvassCategory[]. */
function fromSeed(seed: DemographicCategory[]): CanvassCategory[] {
  return seed.map((cat) => ({
    key: cat._id,
    label: cat.groups.length > 0 ? "Voter Group" : cat.name,
    groups: cat.groups.map((g) => ({
      id: g.id,
      name: g.name,
      economicLean: g.defaultEconomicLean,
      socialLean: g.defaultSocialLean,
    })),
  }));
}

interface ProfileEntry {
  categories: CanvassCategory[];
  baselines: Record<string, number> | null;
}

/** Registry keyed by demographicProfileId. */
const PROFILE_REGISTRY: Record<string, () => ProfileEntry> = {
  uk_archetypes: () => ({
    categories: fromSeed(ukDemographicCategories),
    baselines: UK_VOTER_GROUP_BASELINES,
  }),
  jp_archetypes: () => ({
    categories: fromSeed(jpDemographicCategories),
    baselines: JP_VOTER_GROUP_BASELINES,
  }),
  de_archetypes: () => ({
    categories: fromSeed(deDemographicCategories),
    baselines: DE_VOTER_GROUP_BASELINES,
  }),
  ie_archetypes: () => ({
    categories: fromSeed(ieDemographicCategories),
    baselines: IE_VOTER_GROUP_BASELINES,
  }),
  cn_archetypes: () => ({
    categories: fromSeed(cnDemographicCategories),
    baselines: CN_VOTER_GROUP_BASELINES,
  }),
  br_archetypes: () => ({
    categories: fromSeed(brDemographicCategories),
    baselines: BR_VOTER_GROUP_BASELINES,
  }),
};

function resolveProfile(countryId: string | undefined): ProfileEntry {
  const profileId = countryId
    ? getCountryConfig(countryId as CountryId)?.demographicProfileId
    : undefined;
  const entry = profileId ? PROFILE_REGISTRY[profileId] : undefined;
  // US (us_archetypes) and any unknown/unseeded profile (incl. ng_archetypes) → US default.
  return entry ? entry() : { categories: buildUsCategories(), baselines: null };
}

/** Full category → group structure for a country (UI + validation). */
export function getDemographicCategoriesForCountry(
  countryId: string | undefined
): CanvassCategory[] {
  return resolveProfile(countryId).categories;
}

/** Validate a (category, group) pair for a country and return its leans + bucket key. */
export function resolveCanvassGroup(
  countryId: string | undefined,
  categoryKey: string,
  groupId: string
): { economicLean: number; socialLean: number; categoryKey: string } | null {
  const category = resolveProfile(countryId).categories.find((c) => c.key === categoryKey);
  const group = category?.groups.find((g) => g.id === groupId);
  if (!group) return null;
  return { economicLean: group.economicLean, socialLean: group.socialLean, categoryKey };
}

/** Voter-group baseline turnout for a single-category country (region page). null for US. */
export function getVoterGroupBaselines(
  countryId: string | undefined
): Record<string, number> | null {
  return resolveProfile(countryId).baselines;
}

// ─── Voter-archetype layer ────────────────────────────────────────────────────
//
// Distinct from the canvassing layer above: polls, the legislation policy-effect
// system, and admin tooling key off VOTER ARCHETYPES. For the US that is the
// 12-archetype `voterGroups` scheme (young_renters, evangelicals, …) — NOT the
// Layer-1 demographics (race/age/…) the canvassing UI uses. For every other
// country the archetypes are the same seed voter groups the canvassing layer
// returns, so only the US branch differs.

/** All countries that have a voter-archetype scheme (US + the six seeded countries). */
const ARCHETYPE_COUNTRY_IDS = ["US", "UK", "JP", "DE", "IE", "CN", "BR"] as const;

/**
 * Voter-archetype categories for a country. US → the 12 `voterGroups` archetypes;
 * UK/JP/DE/IE/CN/BR → their seed voter groups; unknown/NG → US archetypes.
 */
export function getVoterArchetypeCategoriesForCountry(
  countryId: string | undefined
): CanvassCategory[] {
  const profileId = countryId
    ? getCountryConfig(countryId as CountryId)?.demographicProfileId
    : undefined;
  const entry = profileId ? PROFILE_REGISTRY[profileId] : undefined;
  // US (us_archetypes) and any unknown/unseeded profile → US 12-archetype voterGroups.
  return entry ? entry().categories : fromSeed(usVoterArchetypeCategories);
}

/** Deduped {id, name} archetype options across all countries (admin dropdowns). */
export function getAllVoterArchetypeOptions(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const options: { id: string; name: string }[] = [];
  for (const countryId of ARCHETYPE_COUNTRY_IDS) {
    for (const category of getVoterArchetypeCategoriesForCountry(countryId)) {
      for (const group of category.groups) {
        if (!seen.has(group.id)) {
          seen.add(group.id);
          options.push({ id: group.id, name: group.name });
        }
      }
    }
  }
  return options;
}

/** Set of every valid archetype group id across all countries (poll-cache invalidation). */
export function getAllVoterArchetypeIds(): Set<string> {
  return new Set(getAllVoterArchetypeOptions().map((o) => o.id));
}

/**
 * Every valid demographic category (modifier-bucket) key across all countries —
 * US Layer-1 dimensions (race/age/education/wealth/ideology) plus each country's
 * `<cc>_voterGroups`. Used to validate party GOTV/suppression target categories
 * without hardcoding (which previously dropped de/ie/cn/br — bug #0700).
 */
export function getAllDemographicCategoryKeys(): string[] {
  const seen = new Set<string>();
  for (const countryId of ARCHETYPE_COUNTRY_IDS) {
    for (const category of getDemographicCategoriesForCountry(countryId)) {
      seen.add(category.key);
    }
  }
  return [...seen];
}
