import { getDemographicCategoriesForCountry, resolveCanvassGroup } from "./countryDemographics";
import { bucketLabel } from "./bucketLabels";
import type { PartyTurnoutTarget, TurnoutTargetSection } from "./turnoutTargets";

export interface PartyTurnoutTargetCategory {
  id: string;
  label: string;
}

/**
 * Player-facing party target catalog.
 *
 * Layer-1 buckets come first so the picker matches the region Demographics
 * tabs. Existing voter groups remain available afterward for countries that
 * have them, giving officers the broader choice requested without invalidating
 * a live budget.
 */
export function buildPartyTurnoutTargetCatalog(
  countryId: string,
  sections: TurnoutTargetSection[]
): { categories: PartyTurnoutTargetCategory[]; targets: PartyTurnoutTarget[] } {
  // Keep this flattening client-local. Importing the server resolver here would
  // drag every international Layer-1 model into the party page's browser graph.
  const targets = sections
    .flatMap((section) =>
      section.options.map((option) => ({
        category: section.dim,
        group: option.id.startsWith(`${section.dim}:`)
          ? option.id.slice(section.dim.length + 1)
          : option.id,
        label: option.label,
        economicLean: option.economicLean,
        socialLean: option.socialLean,
      }))
    )
    .map((target) => {
      // A handful of US Layer-1 ids were already valid party targets before the
      // expanded catalog. Keep their established balance leans in both the UI
      // estimate and the turn resolver instead of showing a different estimate
      // sourced from the current-era census model.
      const established = resolveCanvassGroup(countryId, target.category, target.group);
      return established
        ? {
            ...target,
            economicLean: established.economicLean,
            socialLean: established.socialLean,
          }
        : target;
    });
  const seenTargets = new Set(targets.map((target) => `${target.category}:${target.group}`));
  const categories: PartyTurnoutTargetCategory[] = sections.map((section) => ({
    id: section.dim,
    label: section.dimLabel,
  }));
  const seenCategories = new Set(categories.map((category) => category.id));

  for (const category of getDemographicCategoriesForCountry(countryId)) {
    // Ideology is descriptive only and has never been a directly targetable
    // party-spending category.
    if (category.key === "ideology") continue;
    if (!seenCategories.has(category.key)) {
      seenCategories.add(category.key);
      categories.push({ id: category.key, label: category.label });
    }
    for (const group of category.groups) {
      const key = `${category.key}:${group.id}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      targets.push({
        category: category.key,
        group: group.id,
        label: group.name,
        economicLean: group.economicLean,
        socialLean: group.socialLean,
      });
    }
  }

  return { categories, targets };
}

/** Display a saved party target with its authored legacy label when one exists. */
export function partyTurnoutTargetLabel(
  countryId: string,
  category: string,
  group: string
): string {
  const legacyGroup = getDemographicCategoriesForCountry(countryId)
    .find((entry) => entry.key === category)
    ?.groups.find((entry) => entry.id === group);
  return legacyGroup?.name ?? bucketLabel(`${category}:${group}`, countryId);
}
