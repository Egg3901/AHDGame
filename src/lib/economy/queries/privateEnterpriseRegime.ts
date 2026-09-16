/**
 * The PURE half of the private-enterprise regime question: no database, no
 * driver, safe to import from a client component.
 *
 * Split out of `privateEnterpriseGate` deliberately. That module reaches
 * `@/lib/bonds/sovereign` for `getNationalBudgetId`, which value-imports
 * `ObjectId` from `mongodb` - so importing the gate from a client component
 * would ship the Mongo driver into the browser bundle. Anything rendered on the
 * client imports from HERE.
 *
 * Schedule-only, so it ignores persisted marketization drift and can disagree
 * with the live value near the threshold. That is acceptable for a UI
 * affordance: the server route re-checks against the live dial and is the
 * authority. It is NOT acceptable as a write-path gate.
 */

import { COMMAND_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";

/** Dual-track and above permits private enterprise; fully command does not. */
export function isPrivateEnterprisePermittedAtLevel(level: number): boolean {
  return level >= COMMAND_CEILING;
}

/**
 * Is private enterprise blocked in this country in this year, by the era
 * schedule alone? Unknown country or year reads as permitted.
 */
export function privateEnterpriseBlockedByYear(
  countryId: string | null | undefined,
  currentYear: number | null | undefined
): boolean {
  return !isPrivateEnterprisePermittedAtLevel(scheduledMarketizationLevel(countryId, currentYear));
}
