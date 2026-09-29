import type { CountryId } from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";

// One existing national cabinet seat per country may enforce a union ban on
// behalf of the executive. Prefer the intelligence desk where it exists;
// otherwise use the country's labor or domestic-security portfolio.
const DELEGATE_POSITION_PRIORITY = [
  "director_of_intelligence",
  "labour_minister",
  "minister_of_labour",
  "secretary_of_labor",
  "minister_of_human_resources_social_security",
  "minister_for_justice",
  "internal_affairs_minister",
  "justiceSecretary",
] as const;

export function unionEnforcementDelegatePosition(countryId: CountryId): string | null {
  const available = new Set(getCabinetPositions(countryId).map((position) => position.id));
  return DELEGATE_POSITION_PRIORITY.find((positionId) => available.has(positionId)) ?? null;
}

/** Raids confiscate a bounded slice of the frozen union treasury as a fine sink. */
export function undergroundRaidFine(treasury: number): number {
  if (!Number.isFinite(treasury) || treasury <= 0) return 0;
  return Math.floor(treasury * 0.1);
}
