/** Pure jurisdiction and position eligibility for reset law families. */
import type { LawFamilyDefinition, LegislativePosition } from "../catalog";
import type { ResetCountry } from "../fundingOwner";
import { regionalLawLevel } from "../regionalCatalog";

export type LawChoice = LegislativePosition | "leave_to_states";
export type LawScope = "national" | "regional";

export interface LawChoiceEligibility {
  allowed: boolean;
  reason?:
    | "country_unavailable"
    | "leave_to_states_unavailable"
    | "regional_option_not_authored"
    | "unknown_choice"
    | "unchanged";
}

export function lawChoiceEligibility(
  law: LawFamilyDefinition,
  country: ResetCountry,
  scope: LawScope,
  choice: LawChoice,
  currentChoice: LawChoice | null
): LawChoiceEligibility {
  if (!law.availability[scope].includes(country)) {
    return { allowed: false, reason: "country_unavailable" };
  }
  if (choice !== "leave_to_states" && !law.levels.some((level) => level.position === choice)) {
    return { allowed: false, reason: "unknown_choice" };
  }
  if (
    choice === "leave_to_states" &&
    (country !== "US" || scope !== "national" || !law.leaveToStates)
  ) {
    return { allowed: false, reason: "leave_to_states_unavailable" };
  }
  if (
    scope === "regional" &&
    (choice === "leave_to_states" || !regionalLawLevel(country, law.id, choice))
  ) {
    return { allowed: false, reason: "regional_option_not_authored" };
  }
  if (choice === currentChoice) return { allowed: false, reason: "unchanged" };
  return { allowed: true };
}
