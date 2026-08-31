/**
 * NPP Whip Resolution
 *
 * Determines which party whip applies to an NPP for bill or leadership votes.
 * State party whips take precedence over national; national whips only apply
 * when no state party leadership exists.
 *
 * Used by billVoting.ts to keep whip resolution in one place.
 */

import type { NPP, BillWhip, StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Optional country context for cross-country party collision prevention.
 * Required for leadership elections where party sequential IDs may collide
 * across countries. Bill voting can omit this when bills are already
 * country-scoped.
 */
export interface CountryContext {
  partyByCompositeKey: Map<string, PoliticalParty>;
  partyCountries: Map<string, CountryId[]>;
}

/**
 * Get the country ID for an NPP. All NPPs have countryId post-migration.
 */
export function getNPPCountry(npp: NPP): CountryId {
  return npp.countryId ?? "US";
}

/**
 * Get the country ID for a whip. Post-migration all whips have countryId.
 * For national party whips, fall back to party country lookup.
 */
function getWhipCountry(whip: BillWhip, countryCtx: CountryContext): CountryId | null {
  if (whip.countryId) return whip.countryId;
  if (whip.issuedBy === "stateParty") {
    return null; // Should not happen post-migration — all whips have countryId
  }
  // National party whip — look up the party's country
  const countries = countryCtx.partyCountries.get(whip.partyId);
  if (!countries || countries.length === 0) return null;
  if (countries.length === 1) return countries[0];
  // Multiple countries have parties with this sequentialId — ambiguous
  return null;
}

function compareWhipRecency(a: BillWhip, b: BillWhip): number {
  if (a.attemptNumber !== b.attemptNumber) {
    return a.attemptNumber - b.attemptNumber;
  }
  const aTime = a.createdAt?.getTime?.() ?? 0;
  const bTime = b.createdAt?.getTime?.() ?? 0;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  const aMode = a.mode ?? "hard";
  const bMode = b.mode ?? "hard";
  if (aMode !== bMode) {
    return aMode === "hard" ? 1 : -1;
  }
  return 0;
}

/**
 * Resolve the applicable party whip for an NPP in a given chamber.
 *
 * Priority:
 *   1. State party whip matching NPP's home state (highest)
 *   2. National party whip (only if no state party leadership exists)
 *
 * When `countryCtx` is provided, whips from a different country are skipped
 * to prevent cross-country party sequential ID collisions.
 */
export function resolveWhipForNPP(
  npp: NPP,
  whips: BillWhip[],
  statePartyOrgs: Map<string, StatePartyOrg>,
  chamber: string,
  countryCtx?: CountryContext
): BillWhip | null {
  const stateKey = `${npp.homeState}_${npp.party}`;
  const stateOrg = statePartyOrgs.get(stateKey);
  let applicableStateWhip: BillWhip | null = null;
  let applicableNationalWhip: BillWhip | null = null;

  const nppCountry = countryCtx ? getNPPCountry(npp) : null;

  for (const w of whips) {
    if (w.partyId !== npp.party) continue;
    if (w.chamber !== chamber) continue;

    // Country collision prevention (when context is available)
    if (countryCtx && nppCountry) {
      const whipCountry = getWhipCountry(w, countryCtx);
      if (whipCountry && whipCountry !== nppCountry) continue;
    }

    if (w.issuedBy === "stateParty" && w.stateId === npp.homeState) {
      if (!applicableStateWhip || compareWhipRecency(w, applicableStateWhip) > 0) {
        applicableStateWhip = w;
      }
      continue;
    }
    if (w.issuedBy === "nationalParty") {
      // National party only if no state party player leadership
      const hasStateLeader = stateOrg?.chairId || stateOrg?.viceChairId;
      if (!hasStateLeader) {
        if (!applicableNationalWhip || compareWhipRecency(w, applicableNationalWhip) > 0) {
          applicableNationalWhip = w;
        }
      }
    }
  }

  return applicableStateWhip ?? applicableNationalWhip;
}
