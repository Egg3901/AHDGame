import type { EventDefinition } from "@/lib/db/types/events";
import type { CharacterEventContext } from "./eligibility";
import { matchesEligibility, isPerKindCooldownSatisfied } from "./eligibility";
import { isWithinYearWindow } from "../substrate/yearWindow";

export interface WeightedEventTemplate {
  definition: EventDefinition;
  weight: number;
}

export function filterEligibleTemplates(
  definitions: EventDefinition[],
  characterCtx: CharacterEventContext,
  ledger: { perKindCooldowns: Record<string, number> } | null,
  currentTurn: number,
  currentYear?: number
): WeightedEventTemplate[] {
  const eligible: WeightedEventTemplate[] = [];

  for (const definition of definitions) {
    if (definition.status !== "approved") {
      continue;
    }
    // Broadcast definitions are offered to everyone at once by the driver's
    // broadcast path — they never enter the per-character weighted pool.
    if (definition.broadcast) {
      continue;
    }
    if (definition.baseWeight <= 0) {
      continue;
    }
    if (
      definition.requiresCountryIds &&
      !definition.requiresCountryIds.includes(characterCtx.countryId)
    ) {
      continue;
    }
    // Era gating: year-bounded definitions only fire inside their window.
    if (!isWithinYearWindow(definition, currentYear)) {
      continue;
    }
    if (!matchesEligibility(characterCtx, definition.eligibility)) {
      continue;
    }
    // Exclude role mismatches (e.g. a sitting president is not called for jury
    // duty). An empty/absent list excludes nobody.
    if (
      definition.excludeEligibility &&
      definition.excludeEligibility.length > 0 &&
      matchesEligibility(characterCtx, definition.excludeEligibility)
    ) {
      continue;
    }
    if (!isPerKindCooldownSatisfied(ledger, definition.kind, currentTurn)) {
      continue;
    }
    eligible.push({ definition, weight: definition.baseWeight });
  }

  return eligible;
}
