import { getCountryConfig, type CountryId, isDirectElection } from "@/lib/constants/countries";
import type { Election } from "@/lib/db/types";

/**
 * Campaign Manager (Campaign doc, fundraising / ads / ground-game upgrades,
 * contribution UI) eligibility.
 *
 * Phase 5.5 extension: previously president-only, now also enables US
 * statewide (senate / governor) and US district (house / state senate)
 * races. Non-US races remain explicitly ineligible per Phase 5.5 D4 — UK /
 * JP / DE / IE all have country-specific campaign-finance models that
 * don't map cleanly to the per-candidate fundraising loop, so they need a
 * separate audit + adaptation pass before turning Campaign Manager on.
 *
 * The presidential path stays future-proof: any country whose
 * `isDirectElection(config)` automatically qualifies for
 * president-tier Campaign Manager, even if the country itself isn't
 * currently in the active set.
 *
 * See plan §"Phase 5.5 — Decisions Recorded During Execution" D2 + D4.
 */

/**
 * Race families enabled when a country opts in via
 * `CountryConfig.campaignManagerNonPresidentialEnabled`. Keyed off the
 * canonical `Election.electionType` discriminator. Phase 5.5 enables
 * these for the US; future countries can flip the flag once their
 * campaign-finance models are audited.
 */
const NON_PRESIDENTIAL_RACE_FAMILIES = new Set<string>([
  "senate",
  "governor",
  "house",
  "stateSenate",
]);

export function isCampaignEligibleElection(
  election: Pick<Partial<Election>, "countryId" | "electionType">
): boolean {
  const countryId = election.countryId;
  const electionType = election.electionType;
  if (!countryId || !electionType) return false;

  // Presidential path — any country with direct election of the executive.
  // Future-proof: kept identical to the pre-Phase-5.5 gate so behavior
  // stays the same for direct-election presidents.
  if (electionType === "president") {
    return isDirectElection(getCountryConfig(countryId as CountryId));
  }

  // Non-presidential races — gated by the country's
  // `campaignManagerNonPresidentialEnabled` flag (Phase 5.5 D2 / D4).
  // Currently only US has this flag set to true; UK / JP / DE / IE keep
  // it unset until their campaign-finance models are adapted.
  const config = getCountryConfig(countryId as CountryId);
  if (
    config.campaignManagerNonPresidentialEnabled === true &&
    NON_PRESIDENTIAL_RACE_FAMILIES.has(electionType)
  ) {
    return true;
  }

  // Non-US deferred per Phase 5.5 D4 — UK statutory expense limits,
  // JP mixed FPTP/PR, DE party-list PR, IE STV all need separate audit.
  // Falling through to `false` is intentional and documented.
  return false;
}
