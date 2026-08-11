import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Era gating: a definition with `minYear`/`maxYear` bounds only fires inside
 * its inclusive year window. When the in-game year is unknown (legacy
 * callers, unit tests that don't thread it), bounds are not enforced —
 * matching pre-era-gating behavior. Admin manual triggers bypass this on
 * purpose (QA escape hatch).
 */
export function isWithinYearWindow(
  definition: Pick<EventDefinition, "minYear" | "maxYear">,
  currentYear?: number
): boolean {
  if (currentYear == null) {
    return true;
  }
  if (definition.minYear != null && currentYear < definition.minYear) {
    return false;
  }
  if (definition.maxYear != null && currentYear > definition.maxYear) {
    return false;
  }
  return true;
}
