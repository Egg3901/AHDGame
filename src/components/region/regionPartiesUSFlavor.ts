import type { State } from "@/lib/db/types";
import type { PartyOrgDisplay } from "@/components/state/StatePageTabsTypes";
import { getStateLean } from "@/lib/utils/demographics";

/**
 * Narrative flavor for a US state party card — driven by Org% + state lean.
 * Specific to the two-party system mental model; other countries omit this
 * function entirely.
 */
export function makeUSPartyFlavor(state: State): (party: PartyOrgDisplay) => string | null {
  const stateLean = getStateLean(state);
  return (party) => {
    const isMajor = party.isDefault;
    const isLeftParty = party.partyId === "1";
    const isRightParty = party.partyId === "2";
    const isFavorable = (isLeftParty && stateLean < 0) || (isRightParty && stateLean > 0);
    const isHostile = (isLeftParty && stateLean > 2) || (isRightParty && stateLean < -2);

    if (!isMajor) {
      if (party.organization >= 20) return "Building an alternative voice in state politics.";
      return "An uphill battle against the two-party system.";
    }

    if (isHostile && party.organization >= 40)
      return "Defying the odds in hostile territory with a strong operation.";
    if (isHostile) return "Operating behind enemy lines. Every gain here is hard-fought.";
    if (isFavorable && party.organization >= 60)
      return "Leveraging home-field advantage with a formidable machine.";
    if (isFavorable) return "Favorable turf, but the organization needs strengthening.";

    if (party.organization >= 60) return "A strong operation with deep roots across the state.";
    if (party.organization >= 30) return "A functional organization with room to grow.";
    return "The party has a presence, but it needs serious investment.";
  };
}

/**
 * US-specific sort: floats Democrat/Republican to the top of the parties list
 * (matching the existing `democrat`/`republican` string IDs), then descending
 * by Org%.
 */
export function compareUSParties(a: PartyOrgDisplay, b: PartyOrgDisplay): number {
  const aMajor = a.partyId === "democrat" || a.partyId === "republican";
  const bMajor = b.partyId === "democrat" || b.partyId === "republican";
  if (aMajor && !bMajor) return -1;
  if (!aMajor && bMajor) return 1;
  return b.organization - a.organization;
}
