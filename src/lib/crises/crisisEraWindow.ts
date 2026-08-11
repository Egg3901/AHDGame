import type { CrisisTemplate } from "@/lib/db/types/crisis";

/**
 * Whether a crisis template's era window is open in the given in-game year.
 *
 * Lives in its own module because both spawners need it and they already import
 * from each other (`autoCrisisSpawn` pulls `buildRegionalDisasterEffects` from
 * `autoDisasterSpawn`), so putting it in either one would close a cycle.
 *
 * This replaces a gate keyed on the seed PRESET. A preset never changes, so
 * that gate was permanent: a 1991-seeded world that had advanced to 2008 still
 * blocked the cyber, tech-bubble and disinformation templates forever, decades
 * after they became apt. Resolving against `gameState.currentYear` makes the
 * window open when the world actually reaches it.
 *
 * Fails OPEN on a missing year. Getting it wrong that way risks one mildly
 * anachronistic crisis; failing closed would silently suppress the entire
 * auto-spawn catalogue, which is far harder to notice.
 */
export function isTemplateAllowedInYear(
  template: CrisisTemplate,
  currentYear: number | null | undefined
): boolean {
  if (typeof currentYear !== "number" || !Number.isFinite(currentYear)) return true;
  if (typeof template.fromYear === "number" && currentYear < template.fromYear) return false;
  if (typeof template.untilYear === "number" && currentYear > template.untilYear) return false;
  return true;
}
