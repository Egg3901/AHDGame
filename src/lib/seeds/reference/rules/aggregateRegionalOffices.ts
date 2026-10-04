import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import { IE_LOCAL_COUNCIL_SEATS } from "@/lib/countries/ie/data/ieLocalCouncilSeats";
import {
  IE_REGION_VOTE_SHARES_1989,
  IE_REGION_VOTE_SHARES_2024,
} from "@/lib/countries/ie/data/ieRegionVoteShares";
import {
  BR_REGION_VOTE_SHARES_1991,
  BR_REGION_VOTE_SHARES_2019,
} from "@/lib/countries/br/data/brStatePartyOrgCalculations";
import { apportionSeats } from "./apportionSeats";

/**
 * These opening holders are game-model aggregates, not named historical
 * governors, councillors, or council chairs. The game's BR macroregions and IE
 * planning regions combine many real jurisdictions, so no single real person
 * can be assigned to one of these offices. Reuse the already authored regional
 * vote-share estimates to give their synthetic NPPs a deterministic party and
 * a real election/office lifecycle. 2027 inherits the latest available
 * estimated baseline; it makes no claim about a future election outcome.
 */
const BR_PARTY_SLUGS: Readonly<Record<string, string>> = {
  pt: "br_pt",
  pl: "br_pl",
  mdb: "br_mdb",
  uniao: "br_uniao",
  psd: "br_psd",
  pmdb: "br_pmdb",
  pfl: "br_pfl",
  pdt: "br_pdt",
  pds: "br_pds",
  ptb: "br_ptb",
  prn: "br_prn",
  psb: "br_psb",
  pcob: "br_pcdob",
};

const IE_PARTY_SLUGS: Readonly<Record<string, string>> = {
  ff: "ie_ff",
  fg: "ie_fg",
  sf: "ie_sf",
  lab: "ie_labour",
  green: "ie_green",
  wp: "ie_wp",
  pd: "ie_pd",
  independent: "ie_independent",
};

function partySlug(country: "BR" | "IE", key: string): string {
  const slug = (country === "BR" ? BR_PARTY_SLUGS : IE_PARTY_SLUGS)[key];
  if (!slug) throw new Error(`No ${country} modeled aggregate party for ${key}`);
  return slug;
}

function dominantParty(votes: Readonly<Record<string, number>>): string {
  const sorted = Object.entries(votes).sort(([a, av], [b, bv]) => bv - av || a.localeCompare(b));
  if (!sorted[0] || sorted[0][1] <= 0) throw new Error("Modeled aggregate needs positive votes");
  return sorted[0][0];
}

export function modeledBrMacroregionGovernors(preset: string): HistoricalSeat[] {
  if (preset !== "1991-default" && preset !== "2019-default" && preset !== "2027-default") {
    return [];
  }
  const byRegion =
    preset === "1991-default" ? BR_REGION_VOTE_SHARES_1991 : BR_REGION_VOTE_SHARES_2019;
  return Object.entries(byRegion).map(([state, votes]) => ({
    state,
    officeType: "governor" as const,
    party: partySlug("BR", dominantParty(votes)),
  }));
}

export function modeledIeRegionalOffices(preset: string): HistoricalSeat[] {
  if (preset !== "1991-default" && preset !== "2019-default" && preset !== "2027-default") {
    return [];
  }
  const byRegion =
    preset === "1991-default" ? IE_REGION_VOTE_SHARES_1989 : IE_REGION_VOTE_SHARES_2024;
  const seats: HistoricalSeat[] = [];
  for (const [state, votes] of Object.entries(byRegion)) {
    const councilSize = IE_LOCAL_COUNCIL_SEATS[state];
    if (!councilSize) throw new Error(`No modeled council size for ${state}`);
    const residual = 100 - Object.values(votes).reduce((sum, value) => sum + value, 0);
    if (residual < 0) throw new Error(`Modeled council vote shares exceed 100 in ${state}`);
    const allocated = apportionSeats(councilSize, {
      ...votes,
      ...(residual > 0 ? { independent: residual } : {}),
    });
    for (const [partyKey, seatsHeld] of Object.entries(allocated)) {
      if (seatsHeld <= 0) continue;
      seats.push({
        state,
        officeType: "localCouncil",
        party: partySlug("IE", partyKey),
        seatsHeld,
      });
    }
    seats.push({
      state,
      officeType: "governor",
      // The residual is a collection of independent lists, not one caucus
      // entitled to the chair. Pick the strongest modeled named party.
      party: partySlug("IE", dominantParty(votes)),
    });
  }
  return seats;
}
