/**
 * Historical seat data for February 2020 (game starting point).
 * Used to populate NPPs on game reset.
 *
 * US: 116th Congress (2019-2021) as of February 2020
 * UK: Post-December 2019 general election
 *
 * DATA STRUCTURE:
 * For multi-seat offices like House/Commons, each entry represents ONE NPP
 * who holds the `seatsHeld` count of seats for their party in that state.
 * Example: California has { party: "democrat", seatsHeld: 45 } meaning
 * ONE Democrat NPP holds all 45 Democratic House seats from CA.
 */

import type { CountryId } from "./countries";
import { recordPresetFallback } from "@/lib/seeds/presetSelector";

export interface HistoricalSeat {
  state: string;
  officeType:
    | "house"
    | "senate"
    | "governor"
    | "president"
    | "vicePresident"
    | "commons"
    | "stateSenate"
    | "regionalCouncil"
    | "shugiin"
    | "sangiin"
    | "bundestag"
    | "landtag"
    | "ministerPresident"
    | "npcDelegate"
    | "peoplesCongress"
    | "dail"
    | "seanad"
    | "uachtaran"
    | "localCouncil"
    | "chamber"
    | "supremeSovietDeputy"
    | "nationalitiesDeputy"
    | "republicSupremeSoviet"
    | "volkskammerDeputy"
    | "premier"
    | "chairmanOfPresidium"
    // Beta-parliament office-type keys (FR/IT/ES/SE/TR + ES 1953 Cortes).
    | "deputy"
    | "senator"
    | "member"
    | "procurador";
  party: string;
  seatsHeld?: number; // For multi-seat offices: how many seats this single NPP holds
  senateClass?: 1 | 2 | 3; // US Senate class
  chamberClass?: 1 | 2; // JP Sangiin class
}

// ─── US February 2020: 116th Congress ────────────────────────────────────────
// House: 232 Democrats, 197 Republicans, 1 Independent (MI), 5 Vacant
// Senate: 53 Republicans, 45 Democrats, 2 Independents (VT, ME)
// Governors: 26 Republicans, 24 Democrats
//
// Each House entry = ONE NPP holding all that party's seats in that state

export const US_HOUSE_2020: HistoricalSeat[] = [
  // Alabama: 1 Dem NPP (1 seat), 1 GOP NPP (6 seats)
  { state: "AL", officeType: "house", party: "republican", seatsHeld: 6 },
  { state: "AL", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Alaska: 1 GOP NPP (1 seat)
  { state: "AK", officeType: "house", party: "republican", seatsHeld: 1 },
  // Arizona: 1 Dem NPP (5 seats), 1 GOP NPP (4 seats)
  { state: "AZ", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "AZ", officeType: "house", party: "republican", seatsHeld: 4 },
  // Arkansas: 1 GOP NPP (4 seats)
  { state: "AR", officeType: "house", party: "republican", seatsHeld: 4 },
  // California: 1 Dem NPP (45 seats), 1 GOP NPP (7 seats)
  { state: "CA", officeType: "house", party: "democrat", seatsHeld: 45 },
  { state: "CA", officeType: "house", party: "republican", seatsHeld: 7 },
  // Colorado: 1 Dem NPP (4 seats), 1 GOP NPP (3 seats)
  { state: "CO", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "CO", officeType: "house", party: "republican", seatsHeld: 3 },
  // Connecticut: 1 Dem NPP (5 seats)
  { state: "CT", officeType: "house", party: "democrat", seatsHeld: 5 },
  // Delaware: 1 Dem NPP (1 seat)
  { state: "DE", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Florida: 1 GOP NPP (14 seats), 1 Dem NPP (13 seats)
  { state: "FL", officeType: "house", party: "republican", seatsHeld: 14 },
  { state: "FL", officeType: "house", party: "democrat", seatsHeld: 13 },
  // Georgia: 1 GOP NPP (9 seats), 1 Dem NPP (5 seats)
  { state: "GA", officeType: "house", party: "republican", seatsHeld: 9 },
  { state: "GA", officeType: "house", party: "democrat", seatsHeld: 5 },
  // Hawaii: 1 Dem NPP (2 seats)
  { state: "HI", officeType: "house", party: "democrat", seatsHeld: 2 },
  // Idaho: 1 GOP NPP (2 seats)
  { state: "ID", officeType: "house", party: "republican", seatsHeld: 2 },
  // Illinois: 1 Dem NPP (13 seats), 1 GOP NPP (5 seats)
  { state: "IL", officeType: "house", party: "democrat", seatsHeld: 13 },
  { state: "IL", officeType: "house", party: "republican", seatsHeld: 5 },
  // Indiana: 1 GOP NPP (7 seats), 1 Dem NPP (2 seats)
  { state: "IN", officeType: "house", party: "republican", seatsHeld: 7 },
  { state: "IN", officeType: "house", party: "democrat", seatsHeld: 2 },
  // Iowa: 1 GOP NPP (3 seats), 1 Dem NPP (1 seat)
  { state: "IA", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "IA", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Kansas: 1 GOP NPP (3 seats), 1 Dem NPP (1 seat)
  { state: "KS", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "KS", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Kentucky: 1 GOP NPP (5 seats), 1 Dem NPP (1 seat)
  { state: "KY", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "KY", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Louisiana: 1 GOP NPP (5 seats), 1 Dem NPP (1 seat)
  { state: "LA", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "LA", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Maine: 1 Dem NPP (2 seats)
  { state: "ME", officeType: "house", party: "democrat", seatsHeld: 2 },
  // Maryland: 1 Dem NPP (7 seats), 1 GOP NPP (1 seat)
  { state: "MD", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "MD", officeType: "house", party: "republican", seatsHeld: 1 },
  // Massachusetts: 1 Dem NPP (9 seats)
  { state: "MA", officeType: "house", party: "democrat", seatsHeld: 9 },
  // Michigan: 1 Dem NPP (7 seats), 1 GOP NPP (6 seats), 1 Independent NPP (1 seat - Amash)
  { state: "MI", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "MI", officeType: "house", party: "republican", seatsHeld: 6 },
  { state: "MI", officeType: "house", party: "independent", seatsHeld: 1 },
  // Minnesota: 1 Dem NPP (5 seats), 1 GOP NPP (3 seats)
  { state: "MN", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "MN", officeType: "house", party: "republican", seatsHeld: 3 },
  // Mississippi: 1 GOP NPP (3 seats), 1 Dem NPP (1 seat)
  { state: "MS", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "MS", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Missouri: 1 GOP NPP (6 seats), 1 Dem NPP (2 seats)
  { state: "MO", officeType: "house", party: "republican", seatsHeld: 6 },
  { state: "MO", officeType: "house", party: "democrat", seatsHeld: 2 },
  // Montana: 1 GOP NPP (1 seat)
  { state: "MT", officeType: "house", party: "republican", seatsHeld: 1 },
  // Nebraska: 1 GOP NPP (3 seats)
  { state: "NE", officeType: "house", party: "republican", seatsHeld: 3 },
  // Nevada: 1 Dem NPP (3 seats), 1 GOP NPP (1 seat)
  { state: "NV", officeType: "house", party: "democrat", seatsHeld: 3 },
  { state: "NV", officeType: "house", party: "republican", seatsHeld: 1 },
  // New Hampshire: 1 Dem NPP (2 seats)
  { state: "NH", officeType: "house", party: "democrat", seatsHeld: 2 },
  // New Jersey: 1 Dem NPP (10 seats), 1 GOP NPP (2 seats)
  { state: "NJ", officeType: "house", party: "democrat", seatsHeld: 10 },
  { state: "NJ", officeType: "house", party: "republican", seatsHeld: 2 },
  // New Mexico: 1 Dem NPP (3 seats)
  { state: "NM", officeType: "house", party: "democrat", seatsHeld: 3 },
  // New York: 1 Dem NPP (21 seats), 1 GOP NPP (6 seats)
  { state: "NY", officeType: "house", party: "democrat", seatsHeld: 21 },
  { state: "NY", officeType: "house", party: "republican", seatsHeld: 6 },
  // North Carolina: 1 GOP NPP (9 seats), 1 Dem NPP (3 seats) - 1 vacancy not filled
  { state: "NC", officeType: "house", party: "republican", seatsHeld: 9 },
  { state: "NC", officeType: "house", party: "democrat", seatsHeld: 3 },
  // North Dakota: 1 GOP NPP (1 seat)
  { state: "ND", officeType: "house", party: "republican", seatsHeld: 1 },
  // Ohio: 1 GOP NPP (12 seats), 1 Dem NPP (4 seats)
  { state: "OH", officeType: "house", party: "republican", seatsHeld: 12 },
  { state: "OH", officeType: "house", party: "democrat", seatsHeld: 4 },
  // Oklahoma: 1 GOP NPP (4 seats), 1 Dem NPP (1 seat)
  { state: "OK", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "OK", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Oregon: 1 Dem NPP (4 seats), 1 GOP NPP (1 seat)
  { state: "OR", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "OR", officeType: "house", party: "republican", seatsHeld: 1 },
  // Pennsylvania: 1 Dem NPP (9 seats), 1 GOP NPP (9 seats)
  { state: "PA", officeType: "house", party: "democrat", seatsHeld: 9 },
  { state: "PA", officeType: "house", party: "republican", seatsHeld: 9 },
  // Rhode Island: 1 Dem NPP (2 seats)
  { state: "RI", officeType: "house", party: "democrat", seatsHeld: 2 },
  // South Carolina: 1 GOP NPP (5 seats), 1 Dem NPP (2 seats)
  { state: "SC", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "SC", officeType: "house", party: "democrat", seatsHeld: 2 },
  // South Dakota: 1 GOP NPP (1 seat)
  { state: "SD", officeType: "house", party: "republican", seatsHeld: 1 },
  // Tennessee: 1 GOP NPP (7 seats), 1 Dem NPP (2 seats)
  { state: "TN", officeType: "house", party: "republican", seatsHeld: 7 },
  { state: "TN", officeType: "house", party: "democrat", seatsHeld: 2 },
  // Texas: 1 GOP NPP (23 seats), 1 Dem NPP (13 seats)
  { state: "TX", officeType: "house", party: "republican", seatsHeld: 23 },
  { state: "TX", officeType: "house", party: "democrat", seatsHeld: 13 },
  // Utah: 1 GOP NPP (3 seats), 1 Dem NPP (1 seat)
  { state: "UT", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "UT", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Vermont: 1 Dem NPP (1 seat)
  { state: "VT", officeType: "house", party: "democrat", seatsHeld: 1 },
  // Virginia: 1 Dem NPP (7 seats), 1 GOP NPP (4 seats)
  { state: "VA", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "VA", officeType: "house", party: "republican", seatsHeld: 4 },
  // Washington: 1 Dem NPP (7 seats), 1 GOP NPP (3 seats)
  { state: "WA", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "WA", officeType: "house", party: "republican", seatsHeld: 3 },
  // West Virginia: 1 GOP NPP (3 seats)
  { state: "WV", officeType: "house", party: "republican", seatsHeld: 3 },
  // Wisconsin: 1 GOP NPP (5 seats), 1 Dem NPP (3 seats)
  { state: "WI", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "WI", officeType: "house", party: "democrat", seatsHeld: 3 },
  // Wyoming: 1 GOP NPP (1 seat)
  { state: "WY", officeType: "house", party: "republican", seatsHeld: 1 },
];

// Senate: Each entry = ONE NPP holding one Senate seat
export const US_SENATE_2020: HistoricalSeat[] = [
  // Alabama: 2 GOP NPPs
  { state: "AL", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "AL", officeType: "senate", party: "republican", senateClass: 3 },
  // Alaska: 2 GOP NPPs
  { state: "AK", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "AK", officeType: "senate", party: "republican", senateClass: 3 },
  // Arizona: 1 GOP NPP, 1 Dem NPP
  { state: "AZ", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "AZ", officeType: "senate", party: "democrat", senateClass: 1 },
  // Arkansas: 2 GOP NPPs
  { state: "AR", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "AR", officeType: "senate", party: "republican", senateClass: 3 },
  // California: 2 Dem NPPs
  { state: "CA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "CA", officeType: "senate", party: "democrat", senateClass: 3 },
  // Colorado: 1 Dem NPP, 1 GOP NPP
  { state: "CO", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "CO", officeType: "senate", party: "republican", senateClass: 2 },
  // Connecticut: 2 Dem NPPs
  { state: "CT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "CT", officeType: "senate", party: "democrat", senateClass: 3 },
  // Delaware: 2 Dem NPPs
  { state: "DE", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "DE", officeType: "senate", party: "democrat", senateClass: 2 },
  // Florida: 2 GOP NPPs
  { state: "FL", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "FL", officeType: "senate", party: "republican", senateClass: 1 },
  // Georgia: 2 GOP NPPs
  { state: "GA", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "GA", officeType: "senate", party: "republican", senateClass: 3 },
  // Hawaii: 2 Dem NPPs
  { state: "HI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "HI", officeType: "senate", party: "democrat", senateClass: 3 },
  // Idaho: 2 GOP NPPs
  { state: "ID", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "ID", officeType: "senate", party: "republican", senateClass: 3 },
  // Illinois: 2 Dem NPPs
  { state: "IL", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "IL", officeType: "senate", party: "democrat", senateClass: 3 },
  // Indiana: 2 GOP NPPs
  { state: "IN", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "IN", officeType: "senate", party: "republican", senateClass: 3 },
  // Iowa: 2 GOP NPPs
  { state: "IA", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "IA", officeType: "senate", party: "republican", senateClass: 3 },
  // Kansas: 2 GOP NPPs
  { state: "KS", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "KS", officeType: "senate", party: "republican", senateClass: 3 },
  // Kentucky: 2 GOP NPPs
  { state: "KY", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "KY", officeType: "senate", party: "republican", senateClass: 3 },
  // Louisiana: 2 GOP NPPs
  { state: "LA", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "LA", officeType: "senate", party: "republican", senateClass: 3 },
  // Maine: 1 GOP NPP, 1 Independent NPP (Angus King)
  { state: "ME", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "ME", officeType: "senate", party: "independent", senateClass: 1 },
  // Maryland: 2 Dem NPPs
  { state: "MD", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MD", officeType: "senate", party: "democrat", senateClass: 3 },
  // Massachusetts: 2 Dem NPPs
  { state: "MA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MA", officeType: "senate", party: "democrat", senateClass: 2 },
  // Michigan: 2 Dem NPPs
  { state: "MI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MI", officeType: "senate", party: "democrat", senateClass: 2 },
  // Minnesota: 2 Dem NPPs
  { state: "MN", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MN", officeType: "senate", party: "democrat", senateClass: 2 },
  // Mississippi: 2 GOP NPPs
  { state: "MS", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MS", officeType: "senate", party: "republican", senateClass: 2 },
  // Missouri: 2 GOP NPPs
  { state: "MO", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MO", officeType: "senate", party: "republican", senateClass: 3 },
  // Montana: 1 Dem NPP, 1 GOP NPP
  { state: "MT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MT", officeType: "senate", party: "republican", senateClass: 2 },
  // Nebraska: 2 GOP NPPs
  { state: "NE", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "NE", officeType: "senate", party: "republican", senateClass: 2 },
  // Nevada: 2 Dem NPPs
  { state: "NV", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NV", officeType: "senate", party: "democrat", senateClass: 3 },
  // New Hampshire: 2 Dem NPPs
  { state: "NH", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NH", officeType: "senate", party: "democrat", senateClass: 3 },
  // New Jersey: 2 Dem NPPs
  { state: "NJ", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NJ", officeType: "senate", party: "democrat", senateClass: 2 },
  // New Mexico: 2 Dem NPPs
  { state: "NM", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NM", officeType: "senate", party: "democrat", senateClass: 2 },
  // New York: 2 Dem NPPs
  { state: "NY", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NY", officeType: "senate", party: "democrat", senateClass: 3 },
  // North Carolina: 2 GOP NPPs
  { state: "NC", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NC", officeType: "senate", party: "republican", senateClass: 3 },
  // North Dakota: 2 GOP NPPs
  { state: "ND", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "ND", officeType: "senate", party: "republican", senateClass: 3 },
  // Ohio: 1 Dem NPP, 1 GOP NPP
  { state: "OH", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "OH", officeType: "senate", party: "republican", senateClass: 3 },
  // Oklahoma: 2 GOP NPPs
  { state: "OK", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "OK", officeType: "senate", party: "republican", senateClass: 3 },
  // Oregon: 2 Dem NPPs
  { state: "OR", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "OR", officeType: "senate", party: "democrat", senateClass: 3 },
  // Pennsylvania: 1 Dem NPP, 1 GOP NPP
  { state: "PA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "PA", officeType: "senate", party: "republican", senateClass: 3 },
  // Rhode Island: 2 Dem NPPs
  { state: "RI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "RI", officeType: "senate", party: "democrat", senateClass: 2 },
  // South Carolina: 2 GOP NPPs
  { state: "SC", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "SC", officeType: "senate", party: "republican", senateClass: 3 },
  // South Dakota: 2 GOP NPPs
  { state: "SD", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "SD", officeType: "senate", party: "republican", senateClass: 3 },
  // Tennessee: 2 GOP NPPs
  { state: "TN", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "TN", officeType: "senate", party: "republican", senateClass: 2 },
  // Texas: 2 GOP NPPs
  { state: "TX", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "TX", officeType: "senate", party: "republican", senateClass: 2 },
  // Utah: 2 GOP NPPs
  { state: "UT", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "UT", officeType: "senate", party: "republican", senateClass: 3 },
  // Vermont: 1 Dem NPP, 1 Independent NPP (Bernie Sanders)
  { state: "VT", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "VT", officeType: "senate", party: "independent", senateClass: 1 },
  // Virginia: 2 Dem NPPs
  { state: "VA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "VA", officeType: "senate", party: "democrat", senateClass: 2 },
  // Washington: 2 Dem NPPs
  { state: "WA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WA", officeType: "senate", party: "democrat", senateClass: 3 },
  // West Virginia: 1 Dem NPP, 1 GOP NPP
  { state: "WV", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WV", officeType: "senate", party: "republican", senateClass: 2 },
  // Wisconsin: 1 Dem NPP, 1 GOP NPP
  { state: "WI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WI", officeType: "senate", party: "republican", senateClass: 3 },
  // Wyoming: 2 GOP NPPs
  { state: "WY", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "WY", officeType: "senate", party: "republican", senateClass: 2 },
];

// Governors: Each entry = ONE NPP holding the governorship
export const US_GOVERNORS_2020: HistoricalSeat[] = [
  { state: "AL", officeType: "governor", party: "republican" },
  { state: "AK", officeType: "governor", party: "republican" },
  { state: "AZ", officeType: "governor", party: "republican" },
  { state: "AR", officeType: "governor", party: "republican" },
  { state: "CA", officeType: "governor", party: "democrat" },
  { state: "CO", officeType: "governor", party: "democrat" },
  { state: "CT", officeType: "governor", party: "democrat" },
  { state: "DE", officeType: "governor", party: "democrat" },
  { state: "FL", officeType: "governor", party: "republican" },
  { state: "GA", officeType: "governor", party: "republican" },
  { state: "HI", officeType: "governor", party: "democrat" },
  { state: "ID", officeType: "governor", party: "republican" },
  { state: "IL", officeType: "governor", party: "democrat" },
  { state: "IN", officeType: "governor", party: "republican" },
  { state: "IA", officeType: "governor", party: "republican" },
  { state: "KS", officeType: "governor", party: "democrat" },
  { state: "KY", officeType: "governor", party: "democrat" },
  { state: "LA", officeType: "governor", party: "democrat" },
  { state: "ME", officeType: "governor", party: "democrat" },
  { state: "MD", officeType: "governor", party: "republican" },
  { state: "MA", officeType: "governor", party: "republican" },
  { state: "MI", officeType: "governor", party: "democrat" },
  { state: "MN", officeType: "governor", party: "democrat" },
  { state: "MS", officeType: "governor", party: "republican" },
  { state: "MO", officeType: "governor", party: "republican" },
  { state: "MT", officeType: "governor", party: "democrat" },
  { state: "NE", officeType: "governor", party: "republican" },
  { state: "NV", officeType: "governor", party: "democrat" },
  { state: "NH", officeType: "governor", party: "republican" },
  { state: "NJ", officeType: "governor", party: "democrat" },
  { state: "NM", officeType: "governor", party: "democrat" },
  { state: "NY", officeType: "governor", party: "democrat" },
  { state: "NC", officeType: "governor", party: "democrat" },
  { state: "ND", officeType: "governor", party: "republican" },
  { state: "OH", officeType: "governor", party: "republican" },
  { state: "OK", officeType: "governor", party: "republican" },
  { state: "OR", officeType: "governor", party: "democrat" },
  { state: "PA", officeType: "governor", party: "democrat" },
  { state: "RI", officeType: "governor", party: "democrat" },
  { state: "SC", officeType: "governor", party: "republican" },
  { state: "SD", officeType: "governor", party: "republican" },
  { state: "TN", officeType: "governor", party: "republican" },
  { state: "TX", officeType: "governor", party: "republican" },
  { state: "UT", officeType: "governor", party: "republican" },
  { state: "VT", officeType: "governor", party: "republican" },
  { state: "VA", officeType: "governor", party: "democrat" },
  { state: "WA", officeType: "governor", party: "democrat" },
  { state: "WV", officeType: "governor", party: "republican" },
  { state: "WI", officeType: "governor", party: "democrat" },
  { state: "WY", officeType: "governor", party: "republican" },
];

// ─── US January 1992: 102nd Congress ─────────────────────────────────────────
// House: 268 Democrats, 166 Republicans, 1 Independent (VT)
// Senate: 57 Democrats, 43 Republicans
// Governors: 28 Democrats, 20 Republicans, 2 Independent (AK, CT)

export const US_HOUSE_1992: HistoricalSeat[] = [
  { state: "AL", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "AL", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "AK", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "AZ", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "AZ", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "AR", officeType: "house", party: "democrat", seatsHeld: 3 },
  { state: "AR", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "CA", officeType: "house", party: "democrat", seatsHeld: 26 },
  { state: "CA", officeType: "house", party: "republican", seatsHeld: 19 },
  { state: "CO", officeType: "house", party: "democrat", seatsHeld: 3 },
  { state: "CO", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "CT", officeType: "house", party: "democrat", seatsHeld: 3 },
  { state: "CT", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "DE", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "FL", officeType: "house", party: "republican", seatsHeld: 10 },
  { state: "FL", officeType: "house", party: "democrat", seatsHeld: 9 },
  { state: "GA", officeType: "house", party: "democrat", seatsHeld: 9 },
  { state: "GA", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "HI", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "ID", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "IL", officeType: "house", party: "democrat", seatsHeld: 15 },
  { state: "IL", officeType: "house", party: "republican", seatsHeld: 7 },
  { state: "IN", officeType: "house", party: "democrat", seatsHeld: 8 },
  { state: "IN", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "IA", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "IA", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "KS", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "KS", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "KY", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "KY", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "LA", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "LA", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "ME", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "ME", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "MD", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "MD", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "MA", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "MI", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "MI", officeType: "house", party: "republican", seatsHeld: 7 },
  { state: "MN", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "MN", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "MS", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "MO", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "MO", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "MT", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "MT", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "NE", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "NE", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "NV", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "NV", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "NH", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "NH", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "NJ", officeType: "house", party: "democrat", seatsHeld: 8 },
  { state: "NJ", officeType: "house", party: "republican", seatsHeld: 6 },
  { state: "NM", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "NM", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "NY", officeType: "house", party: "democrat", seatsHeld: 21 },
  { state: "NY", officeType: "house", party: "republican", seatsHeld: 13 },
  { state: "NC", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "NC", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "ND", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "OH", officeType: "house", party: "republican", seatsHeld: 10 },
  { state: "OH", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "OK", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "OK", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "OR", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "OR", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "PA", officeType: "house", party: "republican", seatsHeld: 12 },
  { state: "PA", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "RI", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "RI", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "SC", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "SC", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "SD", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "TN", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "TN", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "TX", officeType: "house", party: "democrat", seatsHeld: 19 },
  { state: "TX", officeType: "house", party: "republican", seatsHeld: 8 },
  { state: "UT", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "UT", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "VT", officeType: "house", party: "independent", seatsHeld: 1 },
  { state: "VA", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "VA", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "WA", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "WA", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "WV", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "WI", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "WI", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "WY", officeType: "house", party: "republican", seatsHeld: 1 },
];

export const US_SENATE_1992: HistoricalSeat[] = [
  { state: "AL", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "AL", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "AK", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "AK", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "AZ", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "AZ", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "AR", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "AR", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "CA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "CA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "CO", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "CO", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "CT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "CT", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "DE", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "DE", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "FL", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "FL", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "GA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "GA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "HI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "HI", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "ID", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "ID", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "IL", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "IL", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "IN", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "IN", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "IA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "IA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "KS", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "KS", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "KY", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "KY", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "LA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "LA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "ME", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "ME", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MD", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MD", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "MA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "MI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MI", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "MN", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MN", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MS", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MS", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MO", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MO", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "MT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MT", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NE", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NE", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NV", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NV", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "NH", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NH", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "NJ", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NJ", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NM", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NM", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NY", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NY", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "NC", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NC", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "ND", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "ND", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "OH", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "OH", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "OK", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "OK", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "OR", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "OR", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "PA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "PA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "RI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "RI", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "SC", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "SC", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "SD", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "SD", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "TN", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "TN", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "TX", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "TX", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "UT", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "UT", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "VT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "VT", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "VA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "VA", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "WA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "WV", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WV", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "WI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WI", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "WY", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WY", officeType: "senate", party: "republican", senateClass: 2 },
];

// ─── US 1991: State Senate Compositions ─────────────────────────────────────
// Party splits reflect state senate control entering the 1991 legislative
// session, immediately after the November 1990 elections. The 1990 cycle
// was a mild pro-Democratic year — small Dem gains in most chambers,
// preserving the long Southern Democratic dominance and the legacy
// Democratic majorities that would erode over the following decade.
//
// Totals match each state's current `stateSenateSeats` config in
// `src/lib/seeds/reference/states.ts`. Where a chamber's size changed
// between 1990 and today (e.g. NY 61→63, RI 50→38, ND 53→47), the 1990
// partisan ratio is preserved while the absolute counts are scaled to the
// current size.
//
// Nebraska is omitted — its Legislature is unicameral and nonpartisan,
// matching the convention used by US_STATE_SENATE_2020.
//
// Each entry = ONE NPP holding all that party's seats in that state.

export const US_STATE_SENATE_1990: HistoricalSeat[] = [
  // Alabama: 28D, 7R — entrenched Dem South majority
  { state: "AL", officeType: "stateSenate", party: "democrat", seatsHeld: 28 },
  { state: "AL", officeType: "stateSenate", party: "republican", seatsHeld: 7 },
  // Alaska: 9D, 11R — narrow GOP edge under a bipartisan coalition
  { state: "AK", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  { state: "AK", officeType: "stateSenate", party: "republican", seatsHeld: 11 },
  // Arizona: 13D, 17R — GOP-controlled
  { state: "AZ", officeType: "stateSenate", party: "democrat", seatsHeld: 13 },
  { state: "AZ", officeType: "stateSenate", party: "republican", seatsHeld: 17 },
  // Arkansas: 31D, 4R — Dem South supermajority
  { state: "AR", officeType: "stateSenate", party: "democrat", seatsHeld: 31 },
  { state: "AR", officeType: "stateSenate", party: "republican", seatsHeld: 4 },
  // California: 25D, 15R — comfortable Dem control under Roberti
  { state: "CA", officeType: "stateSenate", party: "democrat", seatsHeld: 25 },
  { state: "CA", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // Colorado: 11D, 24R — GOP-controlled
  { state: "CO", officeType: "stateSenate", party: "democrat", seatsHeld: 11 },
  { state: "CO", officeType: "stateSenate", party: "republican", seatsHeld: 24 },
  // Connecticut: 20D, 16R — Dem majority
  { state: "CT", officeType: "stateSenate", party: "democrat", seatsHeld: 20 },
  { state: "CT", officeType: "stateSenate", party: "republican", seatsHeld: 16 },
  // Delaware: 13D, 8R — Dem control
  { state: "DE", officeType: "stateSenate", party: "democrat", seatsHeld: 13 },
  { state: "DE", officeType: "stateSenate", party: "republican", seatsHeld: 8 },
  // Florida: 23D, 17R — fading Dem South majority
  { state: "FL", officeType: "stateSenate", party: "democrat", seatsHeld: 23 },
  { state: "FL", officeType: "stateSenate", party: "republican", seatsHeld: 17 },
  // Georgia: 45D, 11R — Dem South dominance
  { state: "GA", officeType: "stateSenate", party: "democrat", seatsHeld: 45 },
  { state: "GA", officeType: "stateSenate", party: "republican", seatsHeld: 11 },
  // Hawaii: 22D, 3R — single-party Dem state
  { state: "HI", officeType: "stateSenate", party: "democrat", seatsHeld: 22 },
  { state: "HI", officeType: "stateSenate", party: "republican", seatsHeld: 3 },
  // Idaho: 12D, 23R — GOP-controlled
  { state: "ID", officeType: "stateSenate", party: "democrat", seatsHeld: 12 },
  { state: "ID", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  // Illinois: 31D, 28R — narrow Dem majority under Rock
  { state: "IL", officeType: "stateSenate", party: "democrat", seatsHeld: 31 },
  { state: "IL", officeType: "stateSenate", party: "republican", seatsHeld: 28 },
  // Indiana: 24D, 26R — narrow GOP control
  { state: "IN", officeType: "stateSenate", party: "democrat", seatsHeld: 24 },
  { state: "IN", officeType: "stateSenate", party: "republican", seatsHeld: 26 },
  // Iowa: 28D, 22R — Dem majority
  { state: "IA", officeType: "stateSenate", party: "democrat", seatsHeld: 28 },
  { state: "IA", officeType: "stateSenate", party: "republican", seatsHeld: 22 },
  // Kansas: 18D, 22R — GOP control
  { state: "KS", officeType: "stateSenate", party: "democrat", seatsHeld: 18 },
  { state: "KS", officeType: "stateSenate", party: "republican", seatsHeld: 22 },
  // Kentucky: 28D, 10R — Dem South majority
  { state: "KY", officeType: "stateSenate", party: "democrat", seatsHeld: 28 },
  { state: "KY", officeType: "stateSenate", party: "republican", seatsHeld: 10 },
  // Louisiana: 35D, 4R — Dem South supermajority
  { state: "LA", officeType: "stateSenate", party: "democrat", seatsHeld: 35 },
  { state: "LA", officeType: "stateSenate", party: "republican", seatsHeld: 4 },
  // Maine: 22D, 13R — Dem majority
  { state: "ME", officeType: "stateSenate", party: "democrat", seatsHeld: 22 },
  { state: "ME", officeType: "stateSenate", party: "republican", seatsHeld: 13 },
  // Maryland: 38D, 9R — Dem dominance
  { state: "MD", officeType: "stateSenate", party: "democrat", seatsHeld: 38 },
  { state: "MD", officeType: "stateSenate", party: "republican", seatsHeld: 9 },
  // Massachusetts: 32D, 8R — Dem dominance under Bulger
  { state: "MA", officeType: "stateSenate", party: "democrat", seatsHeld: 32 },
  { state: "MA", officeType: "stateSenate", party: "republican", seatsHeld: 8 },
  // Michigan: 18D, 20R — narrow GOP control
  { state: "MI", officeType: "stateSenate", party: "democrat", seatsHeld: 18 },
  { state: "MI", officeType: "stateSenate", party: "republican", seatsHeld: 20 },
  // Minnesota: 45 DFL, 22 IR — DFL/IR mapped to democrat/republican
  { state: "MN", officeType: "stateSenate", party: "democrat", seatsHeld: 45 },
  { state: "MN", officeType: "stateSenate", party: "republican", seatsHeld: 22 },
  // Mississippi: 47D, 5R — Dem South supermajority
  { state: "MS", officeType: "stateSenate", party: "democrat", seatsHeld: 47 },
  { state: "MS", officeType: "stateSenate", party: "republican", seatsHeld: 5 },
  // Missouri: 22D, 12R — Dem majority
  { state: "MO", officeType: "stateSenate", party: "democrat", seatsHeld: 22 },
  { state: "MO", officeType: "stateSenate", party: "republican", seatsHeld: 12 },
  // Montana: 27D, 23R — narrow Dem control
  { state: "MT", officeType: "stateSenate", party: "democrat", seatsHeld: 27 },
  { state: "MT", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  // Nebraska: unicameral nonpartisan — omitted
  // Nevada: 11D, 10R — narrow Dem majority
  { state: "NV", officeType: "stateSenate", party: "democrat", seatsHeld: 11 },
  { state: "NV", officeType: "stateSenate", party: "republican", seatsHeld: 10 },
  // New Hampshire: 9D, 15R — GOP control
  { state: "NH", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  { state: "NH", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // New Jersey: 23D, 17R — Dem majority (post-1991 cycle)
  { state: "NJ", officeType: "stateSenate", party: "democrat", seatsHeld: 23 },
  { state: "NJ", officeType: "stateSenate", party: "republican", seatsHeld: 17 },
  // New Mexico: 26D, 16R — Dem majority
  { state: "NM", officeType: "stateSenate", party: "democrat", seatsHeld: 26 },
  { state: "NM", officeType: "stateSenate", party: "republican", seatsHeld: 16 },
  // New York: 26D, 37R — GOP control under Marino (1990 was 61 seats; scaled to current 63)
  { state: "NY", officeType: "stateSenate", party: "democrat", seatsHeld: 26 },
  { state: "NY", officeType: "stateSenate", party: "republican", seatsHeld: 37 },
  // North Carolina: 37D, 13R — Dem South majority
  { state: "NC", officeType: "stateSenate", party: "democrat", seatsHeld: 37 },
  { state: "NC", officeType: "stateSenate", party: "republican", seatsHeld: 13 },
  // North Dakota: 24D, 23R — tight split (1990 had 53 seats; scaled to current 47)
  { state: "ND", officeType: "stateSenate", party: "democrat", seatsHeld: 24 },
  { state: "ND", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  // Ohio: 12D, 21R — GOP control
  { state: "OH", officeType: "stateSenate", party: "democrat", seatsHeld: 12 },
  { state: "OH", officeType: "stateSenate", party: "republican", seatsHeld: 21 },
  // Oklahoma: 33D, 15R — Dem South majority
  { state: "OK", officeType: "stateSenate", party: "democrat", seatsHeld: 33 },
  { state: "OK", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // Oregon: 19D, 11R — Dem majority
  { state: "OR", officeType: "stateSenate", party: "democrat", seatsHeld: 19 },
  { state: "OR", officeType: "stateSenate", party: "republican", seatsHeld: 11 },
  // Pennsylvania: 24D, 26R — narrow GOP control
  { state: "PA", officeType: "stateSenate", party: "democrat", seatsHeld: 24 },
  { state: "PA", officeType: "stateSenate", party: "republican", seatsHeld: 26 },
  // Rhode Island: 33D, 5R — Dem dominance (1990 had 50 seats; scaled to current 38)
  { state: "RI", officeType: "stateSenate", party: "democrat", seatsHeld: 33 },
  { state: "RI", officeType: "stateSenate", party: "republican", seatsHeld: 5 },
  // South Carolina: 36D, 10R — Dem South majority
  { state: "SC", officeType: "stateSenate", party: "democrat", seatsHeld: 36 },
  { state: "SC", officeType: "stateSenate", party: "republican", seatsHeld: 10 },
  // South Dakota: 14D, 21R — GOP control
  { state: "SD", officeType: "stateSenate", party: "democrat", seatsHeld: 14 },
  { state: "SD", officeType: "stateSenate", party: "republican", seatsHeld: 21 },
  // Tennessee: 22D, 11R — Dem South majority
  { state: "TN", officeType: "stateSenate", party: "democrat", seatsHeld: 22 },
  { state: "TN", officeType: "stateSenate", party: "republican", seatsHeld: 11 },
  // Texas: 23D, 8R — Dem South majority, eroding fast
  { state: "TX", officeType: "stateSenate", party: "democrat", seatsHeld: 23 },
  { state: "TX", officeType: "stateSenate", party: "republican", seatsHeld: 8 },
  // Utah: 7D, 22R — GOP dominance
  { state: "UT", officeType: "stateSenate", party: "democrat", seatsHeld: 7 },
  { state: "UT", officeType: "stateSenate", party: "republican", seatsHeld: 22 },
  // Vermont: 15D, 15R — tied chamber; GOP organized via Lt. Gov tiebreak
  { state: "VT", officeType: "stateSenate", party: "democrat", seatsHeld: 15 },
  { state: "VT", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // Virginia: 30D, 10R — Dem South majority
  { state: "VA", officeType: "stateSenate", party: "democrat", seatsHeld: 30 },
  { state: "VA", officeType: "stateSenate", party: "republican", seatsHeld: 10 },
  // Washington: 25D, 24R — narrow Dem majority
  { state: "WA", officeType: "stateSenate", party: "democrat", seatsHeld: 25 },
  { state: "WA", officeType: "stateSenate", party: "republican", seatsHeld: 24 },
  // West Virginia: 30D, 4R — Dem dominance
  { state: "WV", officeType: "stateSenate", party: "democrat", seatsHeld: 30 },
  { state: "WV", officeType: "stateSenate", party: "republican", seatsHeld: 4 },
  // Wisconsin: 19D, 14R — Dem majority
  { state: "WI", officeType: "stateSenate", party: "democrat", seatsHeld: 19 },
  { state: "WI", officeType: "stateSenate", party: "republican", seatsHeld: 14 },
  // Wyoming: 10D, 20R — GOP control
  { state: "WY", officeType: "stateSenate", party: "democrat", seatsHeld: 10 },
  { state: "WY", officeType: "stateSenate", party: "republican", seatsHeld: 20 },
];

export const US_GOVERNORS_1992: HistoricalSeat[] = [
  { state: "AL", officeType: "governor", party: "republican" },
  { state: "AK", officeType: "governor", party: "independent" },
  { state: "AZ", officeType: "governor", party: "republican" },
  { state: "AR", officeType: "governor", party: "democrat" },
  { state: "CA", officeType: "governor", party: "republican" },
  { state: "CO", officeType: "governor", party: "democrat" },
  { state: "CT", officeType: "governor", party: "independent" },
  { state: "DE", officeType: "governor", party: "republican" },
  { state: "FL", officeType: "governor", party: "democrat" },
  { state: "GA", officeType: "governor", party: "democrat" },
  { state: "HI", officeType: "governor", party: "democrat" },
  { state: "ID", officeType: "governor", party: "democrat" },
  { state: "IL", officeType: "governor", party: "republican" },
  { state: "IN", officeType: "governor", party: "democrat" },
  { state: "IA", officeType: "governor", party: "republican" },
  { state: "KS", officeType: "governor", party: "democrat" },
  { state: "KY", officeType: "governor", party: "democrat" },
  { state: "LA", officeType: "governor", party: "democrat" },
  { state: "ME", officeType: "governor", party: "republican" },
  { state: "MD", officeType: "governor", party: "democrat" },
  { state: "MA", officeType: "governor", party: "republican" },
  { state: "MI", officeType: "governor", party: "republican" },
  { state: "MN", officeType: "governor", party: "republican" },
  { state: "MS", officeType: "governor", party: "republican" },
  { state: "MO", officeType: "governor", party: "republican" },
  { state: "MT", officeType: "governor", party: "republican" },
  { state: "NE", officeType: "governor", party: "democrat" },
  { state: "NV", officeType: "governor", party: "democrat" },
  { state: "NH", officeType: "governor", party: "republican" },
  { state: "NJ", officeType: "governor", party: "democrat" },
  { state: "NM", officeType: "governor", party: "democrat" },
  { state: "NY", officeType: "governor", party: "democrat" },
  { state: "NC", officeType: "governor", party: "republican" },
  { state: "ND", officeType: "governor", party: "democrat" },
  { state: "OH", officeType: "governor", party: "republican" },
  { state: "OK", officeType: "governor", party: "democrat" },
  { state: "OR", officeType: "governor", party: "democrat" },
  { state: "PA", officeType: "governor", party: "democrat" },
  { state: "RI", officeType: "governor", party: "democrat" },
  { state: "SC", officeType: "governor", party: "republican" },
  { state: "SD", officeType: "governor", party: "republican" },
  { state: "TN", officeType: "governor", party: "democrat" },
  { state: "TX", officeType: "governor", party: "democrat" },
  { state: "UT", officeType: "governor", party: "republican" },
  { state: "VT", officeType: "governor", party: "democrat" },
  { state: "VA", officeType: "governor", party: "democrat" },
  { state: "WA", officeType: "governor", party: "democrat" },
  { state: "WV", officeType: "governor", party: "democrat" },
  { state: "WI", officeType: "governor", party: "republican" },
  { state: "WY", officeType: "governor", party: "democrat" },
];

// ─── UK February 2020: Post-December 2019 Election ───────────────────────────
// House of Commons: 650 seats
// Conservative: 365, Labour: 202, SNP: 47, Lib Dem: 11, DUP: 8,
// Sinn Féin: 7, Plaid Cymru: 4, SDLP: 2, Green: 1, Alliance: 1, Speaker: 1, Independent: 1
//
// Each Commons entry = ONE NPP holding all that party's seats in that region

export const UK_COMMONS_2020: HistoricalSeat[] = [
  // London (75 seats): Labour stronghold
  // 1 Labour NPP (49 seats), 1 Conservative NPP (21 seats), 1 Lib Dem NPP (4 seats), 1 Green NPP (1 seat)
  { state: "LON", officeType: "commons", party: "uk_labour", seatsHeld: 49 },
  { state: "LON", officeType: "commons", party: "uk_conservative", seatsHeld: 21 },
  { state: "LON", officeType: "commons", party: "uk_libdem", seatsHeld: 4 },
  { state: "LON", officeType: "commons", party: "uk_green", seatsHeld: 1 },

  // South East England (91 seats): Conservative stronghold
  { state: "SEE", officeType: "commons", party: "uk_conservative", seatsHeld: 74 },
  { state: "SEE", officeType: "commons", party: "uk_labour", seatsHeld: 8 },
  { state: "SEE", officeType: "commons", party: "uk_libdem", seatsHeld: 4 },
  { state: "SEE", officeType: "commons", party: "uk_speaker", seatsHeld: 1 },
  { state: "SEE", officeType: "commons", party: "uk_independent", seatsHeld: 1 },

  // South West England (58 seats): Conservative strong
  { state: "SWE", officeType: "commons", party: "uk_conservative", seatsHeld: 48 },
  { state: "SWE", officeType: "commons", party: "uk_labour", seatsHeld: 4 },
  { state: "SWE", officeType: "commons", party: "uk_libdem", seatsHeld: 3 },

  // East of England (61 seats): Conservative strong
  { state: "EAE", officeType: "commons", party: "uk_conservative", seatsHeld: 52 },
  { state: "EAE", officeType: "commons", party: "uk_labour", seatsHeld: 5 },

  // East Midlands (47 seats): Conservative majority
  { state: "EMI", officeType: "commons", party: "uk_conservative", seatsHeld: 38 },
  { state: "EMI", officeType: "commons", party: "uk_labour", seatsHeld: 8 },

  // West Midlands (57 seats): Conservative majority
  { state: "WMI", officeType: "commons", party: "uk_conservative", seatsHeld: 41 },
  { state: "WMI", officeType: "commons", party: "uk_labour", seatsHeld: 16 },

  // Yorkshire and the Humber (54 seats): Mixed
  { state: "YHU", officeType: "commons", party: "uk_conservative", seatsHeld: 26 },
  { state: "YHU", officeType: "commons", party: "uk_labour", seatsHeld: 28 },

  // North West England (75 seats): Labour traditional but shifting
  { state: "NWE", officeType: "commons", party: "uk_labour", seatsHeld: 43 },
  { state: "NWE", officeType: "commons", party: "uk_conservative", seatsHeld: 32 },

  // North East England (27 seats): Labour heartland
  { state: "NEE", officeType: "commons", party: "uk_labour", seatsHeld: 19 },
  { state: "NEE", officeType: "commons", party: "uk_conservative", seatsHeld: 8 },

  // Scotland (57 seats): SNP dominance
  { state: "SCO", officeType: "commons", party: "uk_snp", seatsHeld: 47 },
  { state: "SCO", officeType: "commons", party: "uk_conservative", seatsHeld: 6 },
  { state: "SCO", officeType: "commons", party: "uk_labour", seatsHeld: 1 },
  { state: "SCO", officeType: "commons", party: "uk_libdem", seatsHeld: 3 },

  // Wales (32 seats): Labour traditional
  { state: "WAL", officeType: "commons", party: "uk_labour", seatsHeld: 22 },
  { state: "WAL", officeType: "commons", party: "uk_conservative", seatsHeld: 6 },
  { state: "WAL", officeType: "commons", party: "uk_plaid", seatsHeld: 4 },

  // Northern Ireland (18 seats): Regional parties
  { state: "NIR", officeType: "commons", party: "uk_dup", seatsHeld: 8 },
  { state: "NIR", officeType: "commons", party: "uk_sf", seatsHeld: 7 },
  { state: "NIR", officeType: "commons", party: "uk_sdlp", seatsHeld: 2 },
  { state: "NIR", officeType: "commons", party: "uk_alliance", seatsHeld: 1 },
];

// ─── US January 2020: State Senate Compositions ────────────────────────────
// Based on state legislative chamber compositions as of January 1, 2020.
// Each entry = ONE NPP holding all that party's seats in that state senate.
// Nebraska is unicameral (nonpartisan) — omitted as it uses a different system.

export const US_STATE_SENATE_2020: HistoricalSeat[] = [
  // Alabama: 27R, 8D
  { state: "AL", officeType: "stateSenate", party: "republican", seatsHeld: 27 },
  { state: "AL", officeType: "stateSenate", party: "democrat", seatsHeld: 8 },
  // Alaska: 13R, 7D
  { state: "AK", officeType: "stateSenate", party: "republican", seatsHeld: 13 },
  { state: "AK", officeType: "stateSenate", party: "democrat", seatsHeld: 7 },
  // Arizona: 17R, 13D
  { state: "AZ", officeType: "stateSenate", party: "republican", seatsHeld: 17 },
  { state: "AZ", officeType: "stateSenate", party: "democrat", seatsHeld: 13 },
  // Arkansas: 26R, 9D
  { state: "AR", officeType: "stateSenate", party: "republican", seatsHeld: 26 },
  { state: "AR", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  // California: 29D, 11R
  { state: "CA", officeType: "stateSenate", party: "democrat", seatsHeld: 29 },
  { state: "CA", officeType: "stateSenate", party: "republican", seatsHeld: 11 },
  // Colorado: 19D, 16R
  { state: "CO", officeType: "stateSenate", party: "democrat", seatsHeld: 19 },
  { state: "CO", officeType: "stateSenate", party: "republican", seatsHeld: 16 },
  // Connecticut: 22D, 14R
  { state: "CT", officeType: "stateSenate", party: "democrat", seatsHeld: 22 },
  { state: "CT", officeType: "stateSenate", party: "republican", seatsHeld: 14 },
  // Delaware: 12D, 9R
  { state: "DE", officeType: "stateSenate", party: "democrat", seatsHeld: 12 },
  { state: "DE", officeType: "stateSenate", party: "republican", seatsHeld: 9 },
  // Florida: 23R, 17D
  { state: "FL", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  { state: "FL", officeType: "stateSenate", party: "democrat", seatsHeld: 17 },
  // Georgia: 35R, 21D
  { state: "GA", officeType: "stateSenate", party: "republican", seatsHeld: 35 },
  { state: "GA", officeType: "stateSenate", party: "democrat", seatsHeld: 21 },
  // Hawaii: 24D, 1R
  { state: "HI", officeType: "stateSenate", party: "democrat", seatsHeld: 24 },
  { state: "HI", officeType: "stateSenate", party: "republican", seatsHeld: 1 },
  // Idaho: 28R, 7D
  { state: "ID", officeType: "stateSenate", party: "republican", seatsHeld: 28 },
  { state: "ID", officeType: "stateSenate", party: "democrat", seatsHeld: 7 },
  // Illinois: 40D, 19R
  { state: "IL", officeType: "stateSenate", party: "democrat", seatsHeld: 40 },
  { state: "IL", officeType: "stateSenate", party: "republican", seatsHeld: 19 },
  // Indiana: 40R, 10D
  { state: "IN", officeType: "stateSenate", party: "republican", seatsHeld: 40 },
  { state: "IN", officeType: "stateSenate", party: "democrat", seatsHeld: 10 },
  // Iowa: 32R, 18D
  { state: "IA", officeType: "stateSenate", party: "republican", seatsHeld: 32 },
  { state: "IA", officeType: "stateSenate", party: "democrat", seatsHeld: 18 },
  // Kansas: 29R, 11D
  { state: "KS", officeType: "stateSenate", party: "republican", seatsHeld: 29 },
  { state: "KS", officeType: "stateSenate", party: "democrat", seatsHeld: 11 },
  // Kentucky: 29R, 9D
  { state: "KY", officeType: "stateSenate", party: "republican", seatsHeld: 29 },
  { state: "KY", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  // Louisiana: 27R, 12D
  { state: "LA", officeType: "stateSenate", party: "republican", seatsHeld: 27 },
  { state: "LA", officeType: "stateSenate", party: "democrat", seatsHeld: 12 },
  // Maine: 21D, 14R
  { state: "ME", officeType: "stateSenate", party: "democrat", seatsHeld: 21 },
  { state: "ME", officeType: "stateSenate", party: "republican", seatsHeld: 14 },
  // Maryland: 32D, 15R
  { state: "MD", officeType: "stateSenate", party: "democrat", seatsHeld: 32 },
  { state: "MD", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // Massachusetts: 34D, 6R
  { state: "MA", officeType: "stateSenate", party: "democrat", seatsHeld: 34 },
  { state: "MA", officeType: "stateSenate", party: "republican", seatsHeld: 6 },
  // Michigan: 22R, 16D
  { state: "MI", officeType: "stateSenate", party: "republican", seatsHeld: 22 },
  { state: "MI", officeType: "stateSenate", party: "democrat", seatsHeld: 16 },
  // Minnesota: 35R, 32D
  { state: "MN", officeType: "stateSenate", party: "republican", seatsHeld: 35 },
  { state: "MN", officeType: "stateSenate", party: "democrat", seatsHeld: 32 },
  // Mississippi: 36R, 16D
  { state: "MS", officeType: "stateSenate", party: "republican", seatsHeld: 36 },
  { state: "MS", officeType: "stateSenate", party: "democrat", seatsHeld: 16 },
  // Missouri: 24R, 10D
  { state: "MO", officeType: "stateSenate", party: "republican", seatsHeld: 24 },
  { state: "MO", officeType: "stateSenate", party: "democrat", seatsHeld: 10 },
  // Montana: 30R, 20D
  { state: "MT", officeType: "stateSenate", party: "republican", seatsHeld: 30 },
  { state: "MT", officeType: "stateSenate", party: "democrat", seatsHeld: 20 },
  // Nebraska: unicameral nonpartisan — omitted
  // Nevada: 13D, 8R
  { state: "NV", officeType: "stateSenate", party: "democrat", seatsHeld: 13 },
  { state: "NV", officeType: "stateSenate", party: "republican", seatsHeld: 8 },
  // New Hampshire: 14R, 10D
  { state: "NH", officeType: "stateSenate", party: "republican", seatsHeld: 14 },
  { state: "NH", officeType: "stateSenate", party: "democrat", seatsHeld: 10 },
  // New Jersey: 25D, 15R
  { state: "NJ", officeType: "stateSenate", party: "democrat", seatsHeld: 25 },
  { state: "NJ", officeType: "stateSenate", party: "republican", seatsHeld: 15 },
  // New Mexico: 26D, 16R
  { state: "NM", officeType: "stateSenate", party: "democrat", seatsHeld: 26 },
  { state: "NM", officeType: "stateSenate", party: "republican", seatsHeld: 16 },
  // New York: 40D, 23R
  { state: "NY", officeType: "stateSenate", party: "democrat", seatsHeld: 40 },
  { state: "NY", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  // North Carolina: 29R, 21D
  { state: "NC", officeType: "stateSenate", party: "republican", seatsHeld: 29 },
  { state: "NC", officeType: "stateSenate", party: "democrat", seatsHeld: 21 },
  // North Dakota: 37R, 10D
  { state: "ND", officeType: "stateSenate", party: "republican", seatsHeld: 37 },
  { state: "ND", officeType: "stateSenate", party: "democrat", seatsHeld: 10 },
  // Ohio: 24R, 9D
  { state: "OH", officeType: "stateSenate", party: "republican", seatsHeld: 24 },
  { state: "OH", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  // Oklahoma: 39R, 9D
  { state: "OK", officeType: "stateSenate", party: "republican", seatsHeld: 39 },
  { state: "OK", officeType: "stateSenate", party: "democrat", seatsHeld: 9 },
  // Oregon: 18D, 12R
  { state: "OR", officeType: "stateSenate", party: "democrat", seatsHeld: 18 },
  { state: "OR", officeType: "stateSenate", party: "republican", seatsHeld: 12 },
  // Pennsylvania: 29R, 21D
  { state: "PA", officeType: "stateSenate", party: "republican", seatsHeld: 29 },
  { state: "PA", officeType: "stateSenate", party: "democrat", seatsHeld: 21 },
  // Rhode Island: 33D, 5R
  { state: "RI", officeType: "stateSenate", party: "democrat", seatsHeld: 33 },
  { state: "RI", officeType: "stateSenate", party: "republican", seatsHeld: 5 },
  // South Carolina: 27R, 19D
  { state: "SC", officeType: "stateSenate", party: "republican", seatsHeld: 27 },
  { state: "SC", officeType: "stateSenate", party: "democrat", seatsHeld: 19 },
  // South Dakota: 30R, 5D
  { state: "SD", officeType: "stateSenate", party: "republican", seatsHeld: 30 },
  { state: "SD", officeType: "stateSenate", party: "democrat", seatsHeld: 5 },
  // Tennessee: 28R, 5D
  { state: "TN", officeType: "stateSenate", party: "republican", seatsHeld: 28 },
  { state: "TN", officeType: "stateSenate", party: "democrat", seatsHeld: 5 },
  // Texas: 19R, 12D
  { state: "TX", officeType: "stateSenate", party: "republican", seatsHeld: 19 },
  { state: "TX", officeType: "stateSenate", party: "democrat", seatsHeld: 12 },
  // Utah: 23R, 6D
  { state: "UT", officeType: "stateSenate", party: "republican", seatsHeld: 23 },
  { state: "UT", officeType: "stateSenate", party: "democrat", seatsHeld: 6 },
  // Vermont: 23D, 7R
  { state: "VT", officeType: "stateSenate", party: "democrat", seatsHeld: 23 },
  { state: "VT", officeType: "stateSenate", party: "republican", seatsHeld: 7 },
  // Virginia: 21D, 19R
  { state: "VA", officeType: "stateSenate", party: "democrat", seatsHeld: 21 },
  { state: "VA", officeType: "stateSenate", party: "republican", seatsHeld: 19 },
  // Washington: 29D, 20R
  { state: "WA", officeType: "stateSenate", party: "democrat", seatsHeld: 29 },
  { state: "WA", officeType: "stateSenate", party: "republican", seatsHeld: 20 },
  // West Virginia: 20R, 14D
  { state: "WV", officeType: "stateSenate", party: "republican", seatsHeld: 20 },
  { state: "WV", officeType: "stateSenate", party: "democrat", seatsHeld: 14 },
  // Wisconsin: 19R, 14D
  { state: "WI", officeType: "stateSenate", party: "republican", seatsHeld: 19 },
  { state: "WI", officeType: "stateSenate", party: "democrat", seatsHeld: 14 },
  // Wyoming: 27R, 3D
  { state: "WY", officeType: "stateSenate", party: "republican", seatsHeld: 27 },
  { state: "WY", officeType: "stateSenate", party: "democrat", seatsHeld: 3 },
];

// ─── UK January 2020: Regional Council Compositions ────────────────────────
// Based on local council seat compositions as of January 2020.
// English regions use aggregated local authority control data.
// Scotland = Scottish Parliament (129 MSPs), Wales = Senedd (60 MSs),
// Northern Ireland = NI Assembly (90 MLAs).
// Each entry = ONE NPP holding all that party's seats in that council.

export const UK_REGIONAL_COUNCIL_2020: HistoricalSeat[] = [
  // London (32 seats): Labour-dominated with Tory suburbs
  { state: "LON", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 18 },
  { state: "LON", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 11 },
  { state: "LON", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 2 },
  { state: "LON", officeType: "regionalCouncil", party: "uk_green", seatsHeld: 1 },

  // South East England (67 seats): Conservative heartland
  { state: "SEE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 40 },
  { state: "SEE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 10 },
  { state: "SEE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 12 },
  { state: "SEE", officeType: "regionalCouncil", party: "uk_green", seatsHeld: 5 },

  // South West England (39 seats): Conservative with Lib Dem pockets
  { state: "SWE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 20 },
  { state: "SWE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 10 },
  { state: "SWE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 7 },
  { state: "SWE", officeType: "regionalCouncil", party: "uk_green", seatsHeld: 2 },

  // East of England (39 seats): Conservative leaning
  { state: "EAE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 23 },
  { state: "EAE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 10 },
  { state: "EAE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 6 },

  // East Midlands (39 seats): Competitive Con-Lab
  { state: "EMI", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 20 },
  { state: "EMI", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 16 },
  { state: "EMI", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 3 },

  // West Midlands (18 seats): Mixed urban Labour / rural Tory
  { state: "WMI", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 9 },
  { state: "WMI", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 8 },
  { state: "WMI", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // Yorkshire & the Humber (21 seats): Labour urban, Tory rural
  { state: "YHU", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 12 },
  { state: "YHU", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 8 },
  { state: "YHU", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // North West England (27 seats): Labour heartland
  { state: "NWE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 17 },
  { state: "NWE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 9 },
  { state: "NWE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // North East England (17 seats): Strong Labour
  { state: "NEE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 13 },
  { state: "NEE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 4 },

  // Scotland (129 MSPs): SNP government, fragmented opposition
  { state: "SCO", officeType: "regionalCouncil", party: "uk_snp", seatsHeld: 63 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 31 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 24 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_green", seatsHeld: 6 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 5 },

  // Wales (60 MSs): Labour-led Senedd
  { state: "WAL", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 29 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 11 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_plaid", seatsHeld: 10 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 5 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_green", seatsHeld: 1 },
  // 4 seats: Brexit Party / independent — assigned independent
  { state: "WAL", officeType: "regionalCouncil", party: "uk_independent", seatsHeld: 4 },

  // Northern Ireland (90 MLAs): Cross-community power-sharing
  { state: "NIR", officeType: "regionalCouncil", party: "uk_dup", seatsHeld: 28 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_sf", seatsHeld: 27 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_sdlp", seatsHeld: 12 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_alliance", seatsHeld: 8 },
  // Remaining: UUP, TUV, PBP, independents — spread across smaller groups
  { state: "NIR", officeType: "regionalCouncil", party: "uk_independent", seatsHeld: 15 },
];

// ─── UK First Ministers + Mayor of London — February 2020 ──────────────────
// Devolved-executive seats (recycle the `governor` officeType — see
// docs/design/uk-jp-devolved-executives.md). One seat per devolved region:
//   - SCO: First Minister of Scotland — Nicola Sturgeon (SNP)
//   - WAL: First Minister of Wales — Mark Drakeford (Labour)
//   - NIR: First Minister of Northern Ireland — Arlene Foster (DUP) at this point
//   - LON: Mayor of London — Sadiq Khan (Labour)
// English non-London regions intentionally absent — they have no devolved
// executive and `getRegionalExecutive` returns null for them.
export const UK_FIRST_MINISTERS_2020: HistoricalSeat[] = [
  { state: "SCO", officeType: "governor", party: "uk_snp" },
  { state: "WAL", officeType: "governor", party: "uk_labour" },
  { state: "NIR", officeType: "governor", party: "uk_dup" },
  { state: "LON", officeType: "governor", party: "uk_labour" },
];

// ─── UK April 1992: Post-1992 General Election ─────────────────────────────
// House of Commons: 651 seats
// Conservative 336, Labour 271, Lib Dem 20, SNP 3, Plaid 4,
// DUP 3, UUP 9, SDLP 4, Alliance 1

export const UK_COMMONS_1992: HistoricalSeat[] = [
  { state: "LON", officeType: "commons", party: "uk_labour", seatsHeld: 35 },
  { state: "LON", officeType: "commons", party: "uk_conservative", seatsHeld: 48 },
  { state: "LON", officeType: "commons", party: "uk_libdem", seatsHeld: 1 },

  { state: "SEE", officeType: "commons", party: "uk_conservative", seatsHeld: 106 },
  { state: "SEE", officeType: "commons", party: "uk_labour", seatsHeld: 3 },

  { state: "SWE", officeType: "commons", party: "uk_conservative", seatsHeld: 38 },
  { state: "SWE", officeType: "commons", party: "uk_labour", seatsHeld: 4 },
  { state: "SWE", officeType: "commons", party: "uk_libdem", seatsHeld: 6 },

  { state: "EAE", officeType: "commons", party: "uk_conservative", seatsHeld: 17 },
  { state: "EAE", officeType: "commons", party: "uk_labour", seatsHeld: 3 },

  { state: "EMI", officeType: "commons", party: "uk_conservative", seatsHeld: 28 },
  { state: "EMI", officeType: "commons", party: "uk_labour", seatsHeld: 14 },

  { state: "WMI", officeType: "commons", party: "uk_conservative", seatsHeld: 29 },
  { state: "WMI", officeType: "commons", party: "uk_labour", seatsHeld: 29 },

  { state: "YHU", officeType: "commons", party: "uk_labour", seatsHeld: 34 },
  { state: "YHU", officeType: "commons", party: "uk_conservative", seatsHeld: 20 },

  { state: "NWE", officeType: "commons", party: "uk_labour", seatsHeld: 44 },
  { state: "NWE", officeType: "commons", party: "uk_conservative", seatsHeld: 27 },
  { state: "NWE", officeType: "commons", party: "uk_libdem", seatsHeld: 2 },

  { state: "NEE", officeType: "commons", party: "uk_labour", seatsHeld: 29 },
  { state: "NEE", officeType: "commons", party: "uk_conservative", seatsHeld: 6 },
  { state: "NEE", officeType: "commons", party: "uk_libdem", seatsHeld: 1 },

  { state: "SCO", officeType: "commons", party: "uk_labour", seatsHeld: 49 },
  { state: "SCO", officeType: "commons", party: "uk_conservative", seatsHeld: 11 },
  { state: "SCO", officeType: "commons", party: "uk_libdem", seatsHeld: 9 },
  { state: "SCO", officeType: "commons", party: "uk_snp", seatsHeld: 3 },

  { state: "WAL", officeType: "commons", party: "uk_labour", seatsHeld: 27 },
  { state: "WAL", officeType: "commons", party: "uk_conservative", seatsHeld: 6 },
  { state: "WAL", officeType: "commons", party: "uk_plaid", seatsHeld: 4 },
  { state: "WAL", officeType: "commons", party: "uk_libdem", seatsHeld: 1 },

  // 1992 NIR Commons: DUP 3, UUP 9, SDLP 4, UPUP/Independent Unionist 1
  // (James Kilfedder, North Down). SF won 0 seats in 1992; Alliance 0.
  // SDLP and Alliance aren't seeded as default parties — `uk_sdlp` and
  // `uk_alliance` would resolve to "independent" via the seedHistorical
  // fallback. We keep `uk_sdlp` to preserve the historical attribution
  // in case those parties are added later; the lone UPUP/Ind seat is
  // recorded directly as `uk_independent`.
  { state: "NIR", officeType: "commons", party: "uk_uup", seatsHeld: 9 },
  { state: "NIR", officeType: "commons", party: "uk_dup", seatsHeld: 3 },
  { state: "NIR", officeType: "commons", party: "uk_sdlp", seatsHeld: 4 },
  { state: "NIR", officeType: "commons", party: "uk_independent", seatsHeld: 1 },
];

// ─── UK First Ministers + Mayor of London — January 1992 (anachronistic) ──
// Devolution didn't exist in 1992 (Scottish/Welsh devolution 1999, NI 1998)
// and the Mayor of London office didn't exist until 2000. The 1991-default
// preset still models these offices because the game's office structure is
// preset-agnostic — Phase 1 wires the `governor` officeType for these
// regions and Phase 2 spawns elections on a 4-year cycle. Party-stamped
// to the regional Westminster majority circa 1992:
//   - SCO: Labour (uk_labour) — Labour swept Scotland in 1992
//   - WAL: Labour (uk_labour) — Labour dominant in Wales
//   - NIR: UUP (uk_uup) — Ulster Unionist Party was the dominant
//          unionist party in NI pre-1998. UUP is a 1991-only default
//          party (see `ukParties.ts` validForPresets).
//   - LON: Labour (uk_labour) — Labour-leaning region in 1992
export const UK_FIRST_MINISTERS_1992: HistoricalSeat[] = [
  { state: "SCO", officeType: "governor", party: "uk_labour" },
  { state: "WAL", officeType: "governor", party: "uk_labour" },
  { state: "NIR", officeType: "governor", party: "uk_uup" },
  { state: "LON", officeType: "governor", party: "uk_labour" },
];

// ─── UK 1992: Regional Council Compositions ────────────────────────────────
// Devolution didn't exist in 1992 (Scotland 1999, Wales 1999, NI 1998), so
// these party splits are aggregated from the local-government tier that DID
// exist in the early 90s:
//   - English regions: 1989 county councils + 1990/1991 London borough and
//     metropolitan district elections
//   - Scotland: 1990 Scottish regional council elections (the regional
//     councils that existed until the 1996 unitary reorganization)
//   - Wales: 1991 Welsh county + district council elections
//   - Northern Ireland: 1989 district council elections
//
// Totals match each region's current `stateSenateSeats` config in
// `src/lib/seeds/uk/ukRegions.ts`. The seat counts in the config are the
// modern devolved-parliament/assembly sizes (SCO 129 MSPs, WAL 60 MSs, NIR
// 90 MLAs, LON 32 GLA-equivalent) — we keep them as the chamber size for
// gameplay purposes and just allocate them according to the 1989-91 local
// vote shares scaled up.
//
// Major political backdrop: Conservative-led government under Major; Labour
// surging at local level after 1989-91 poll-tax backlash; Lib Dems
// recovering from the 1988 SDP-Liberal merger; SNP gaining at Westminster
// (3 MPs after 1992 GE) but still secondary to Labour in Scottish local
// councils.
//
// SDLP / Alliance are not seeded as default parties — like UK_COMMONS_1992,
// we keep `uk_sdlp` / `uk_alliance` slugs to preserve historical attribution
// (they fall back to `independent` via `seedHistorical`'s resolver until
// those parties are seeded).
//
// Each entry = ONE NPP holding all that party's seats in that region.

export const UK_REGIONAL_COUNCIL_1992: HistoricalSeat[] = [
  // London (32 seats): Labour swept the 1990 London borough elections in the
  // post-poll-tax backlash. Tory suburban boroughs still held outer London.
  { state: "LON", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 20 },
  { state: "LON", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 11 },
  { state: "LON", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // South East England (67 seats): Conservative heartland in the 1989 county
  // council elections; Lib Dems gaining footholds in Hampshire / Surrey.
  { state: "SEE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 42 },
  { state: "SEE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 12 },
  { state: "SEE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 13 },

  // South West England (39 seats): Tory with strong Lib Dem pockets
  // (Cornwall, Devon, Somerset West).
  { state: "SWE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 22 },
  { state: "SWE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 9 },
  { state: "SWE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 8 },

  // East of England (39 seats): Conservative-leaning rural and suburban
  // counties; Labour pockets in Norwich / Luton / Peterborough.
  { state: "EAE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 23 },
  { state: "EAE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 11 },
  { state: "EAE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 5 },

  // East Midlands (39 seats): Closely contested between Tory shire counties
  // and Labour Derby / Nottingham / Leicester urban authorities.
  { state: "EMI", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 18 },
  { state: "EMI", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 18 },
  { state: "EMI", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 3 },

  // West Midlands (18 seats): Labour controlled Birmingham + the Black
  // Country metropolitan districts; Tory shires around Warwickshire.
  { state: "WMI", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 9 },
  { state: "WMI", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 8 },
  { state: "WMI", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // Yorkshire & the Humber (21 seats): Labour locked in the metropolitan
  // boroughs; Conservatives held N/E Yorkshire.
  { state: "YHU", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 13 },
  { state: "YHU", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 7 },
  { state: "YHU", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // North West England (27 seats): Labour heartland; Manchester / Liverpool
  // / Salford solidly Labour. Tories held Cheshire-area shires.
  { state: "NWE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 18 },
  { state: "NWE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 8 },
  { state: "NWE", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 1 },

  // North East England (17 seats): Strong Labour across Tyneside, Wearside,
  // Durham, Teesside.
  { state: "NEE", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 14 },
  { state: "NEE", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 3 },

  // Scotland (129 seats): 1990 regional council elections — Labour took
  // Strathclyde/Lothian/Central/Fife, SNP held a handful of districts in
  // Tayside, Conservatives clung on in Grampian/Borders. Plenty of
  // independent councillors in island and rural authorities.
  { state: "SCO", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 65 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 20 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_snp", seatsHeld: 15 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 14 },
  { state: "SCO", officeType: "regionalCouncil", party: "uk_independent", seatsHeld: 15 },

  // Wales (60 seats): 1991 county + district elections. Labour controlled
  // South Wales valleys, Conservative held Powys / Vale of Glamorgan, Plaid
  // Cymru concentrated in Gwynedd, Lib Dems in mid-Wales.
  { state: "WAL", officeType: "regionalCouncil", party: "uk_labour", seatsHeld: 30 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_conservative", seatsHeld: 10 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_plaid", seatsHeld: 8 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_libdem", seatsHeld: 6 },
  { state: "WAL", officeType: "regionalCouncil", party: "uk_independent", seatsHeld: 6 },

  // Northern Ireland (90 seats): 1989 district council elections, scaled
  // proportionally. UUP largest, DUP second, SDLP third, SF fourth,
  // Alliance fifth. Misc unionist/loyalist Independents fill the remainder.
  { state: "NIR", officeType: "regionalCouncil", party: "uk_uup", seatsHeld: 30 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_sdlp", seatsHeld: 19 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_dup", seatsHeld: 16 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_sf", seatsHeld: 10 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_independent", seatsHeld: 9 },
  { state: "NIR", officeType: "regionalCouncil", party: "uk_alliance", seatsHeld: 6 },
];

// ─── JP January 2020: National Diet ─────────────────────────────────────────
// Minor party slugs (jp_sdp, jp_reiwa, jp_nhk, jp_independent) resolve to
// "independent" at seed time if the party doesn't exist in the DB, matching
// the Northern Ireland pattern for DUP/SF/etc.
//
// Shugiin (House of Representatives): 465 seats
//   Post-October 2017 general election + party realignments through Jan 2020
//   LDP 278, CDP 59, Komeito 32, DPFP 43, JCP 14, Ishin 11, SDP 2, NHK 1, Ind 25
// Sangiin (House of Councillors): 245 seats (pre-2022 expansion to 248)
//   Post-July 2019 half-election
//   LDP 113, CDP 32, Komeito 28, DPFP 21, Ishin 16, JCP 13, Other 22
// Governors: 8 regions, all LDP-affiliated at game start
//
// Seat distribution is proportional to each region's Shugiin/Sangiin allocation.
// Each entry = ONE NPP holding all that party's seats in that region.

export const JP_SHUGIIN_2020: HistoricalSeat[] = [
  // Hokkaido (12 seats): LDP-CDP competitive
  { state: "HOK", officeType: "shugiin", party: "jp_ldp", seatsHeld: 6 },
  { state: "HOK", officeType: "shugiin", party: "jp_cdp", seatsHeld: 3 },
  { state: "HOK", officeType: "shugiin", party: "jp_komeito", seatsHeld: 1 },
  { state: "HOK", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 1 },
  { state: "HOK", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },

  // Tohoku (37 seats): Strong LDP rural base
  { state: "TOH", officeType: "shugiin", party: "jp_ldp", seatsHeld: 23 },
  { state: "TOH", officeType: "shugiin", party: "jp_cdp", seatsHeld: 5 },
  { state: "TOH", officeType: "shugiin", party: "jp_komeito", seatsHeld: 3 },
  { state: "TOH", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 4 },
  { state: "TOH", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },
  { state: "TOH", officeType: "shugiin", party: "jp_ishin", seatsHeld: 1 },

  // Kanto (150 seats): Mixed — LDP strong suburban, CDP strong Tokyo urban
  { state: "KAN", officeType: "shugiin", party: "jp_ldp", seatsHeld: 88 },
  { state: "KAN", officeType: "shugiin", party: "jp_cdp", seatsHeld: 22 },
  { state: "KAN", officeType: "shugiin", party: "jp_komeito", seatsHeld: 10 },
  { state: "KAN", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 16 },
  { state: "KAN", officeType: "shugiin", party: "jp_jcp", seatsHeld: 5 },
  { state: "KAN", officeType: "shugiin", party: "jp_ishin", seatsHeld: 2 },
  { state: "KAN", officeType: "shugiin", party: "jp_sdp", seatsHeld: 1 },
  { state: "KAN", officeType: "shugiin", party: "jp_independent", seatsHeld: 6 },

  // Chubu (81 seats): LDP-leaning industrial/rural mix
  { state: "CHU", officeType: "shugiin", party: "jp_ldp", seatsHeld: 50 },
  { state: "CHU", officeType: "shugiin", party: "jp_cdp", seatsHeld: 9 },
  { state: "CHU", officeType: "shugiin", party: "jp_komeito", seatsHeld: 5 },
  { state: "CHU", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 10 },
  { state: "CHU", officeType: "shugiin", party: "jp_jcp", seatsHeld: 2 },
  { state: "CHU", officeType: "shugiin", party: "jp_ishin", seatsHeld: 2 },
  { state: "CHU", officeType: "shugiin", party: "jp_independent", seatsHeld: 3 },

  // Kansai (82 seats): Ishin stronghold (Osaka-based), LDP also strong
  { state: "KNS", officeType: "shugiin", party: "jp_ldp", seatsHeld: 43 },
  { state: "KNS", officeType: "shugiin", party: "jp_cdp", seatsHeld: 8 },
  { state: "KNS", officeType: "shugiin", party: "jp_komeito", seatsHeld: 6 },
  { state: "KNS", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 4 },
  { state: "KNS", officeType: "shugiin", party: "jp_jcp", seatsHeld: 2 },
  { state: "KNS", officeType: "shugiin", party: "jp_ishin", seatsHeld: 4 },
  { state: "KNS", officeType: "shugiin", party: "jp_independent", seatsHeld: 15 },

  // Chugoku (28 seats): Strong LDP (Abe's home region)
  { state: "CGK", officeType: "shugiin", party: "jp_ldp", seatsHeld: 20 },
  { state: "CGK", officeType: "shugiin", party: "jp_cdp", seatsHeld: 3 },
  { state: "CGK", officeType: "shugiin", party: "jp_komeito", seatsHeld: 2 },
  { state: "CGK", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 2 },
  { state: "CGK", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },

  // Shikoku (14 seats): Strong LDP
  { state: "SHI", officeType: "shugiin", party: "jp_ldp", seatsHeld: 10 },
  { state: "SHI", officeType: "shugiin", party: "jp_cdp", seatsHeld: 2 },
  { state: "SHI", officeType: "shugiin", party: "jp_komeito", seatsHeld: 1 },
  { state: "SHI", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 1 },

  // Kyushu & Okinawa (61 seats): LDP strong mainland, Okinawa opposition
  { state: "KYU", officeType: "shugiin", party: "jp_ldp", seatsHeld: 38 },
  { state: "KYU", officeType: "shugiin", party: "jp_cdp", seatsHeld: 7 },
  { state: "KYU", officeType: "shugiin", party: "jp_komeito", seatsHeld: 4 },
  { state: "KYU", officeType: "shugiin", party: "jp_dpfp", seatsHeld: 5 },
  { state: "KYU", officeType: "shugiin", party: "jp_jcp", seatsHeld: 2 },
  { state: "KYU", officeType: "shugiin", party: "jp_ishin", seatsHeld: 2 },
  { state: "KYU", officeType: "shugiin", party: "jp_sdp", seatsHeld: 1 },
  { state: "KYU", officeType: "shugiin", party: "jp_nhk", seatsHeld: 1 },
  { state: "KYU", officeType: "shugiin", party: "jp_independent", seatsHeld: 1 },
];
// Shugiin totals: LDP 278, CDP 59, Komeito 32, DPFP 43, JCP 14, Ishin 11, SDP 2, NHK 1, Ind 25 = 465

export const JP_SANGIIN_2020: HistoricalSeat[] = [
  // Each region participates in both Class 1 and Class 2. Seats split ~50/50 per party.
  // Class 1 gets ceil, Class 2 gets floor for odd totals.
  // Total per region = sum of both classes = full Sangiin allocation.

  // Hokkaido (7 total: C1=4, C2=3)
  { state: "HOK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_cdp", seatsHeld: 1, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 1, chamberClass: 2 },
  { state: "HOK", officeType: "sangiin", party: "jp_cdp", seatsHeld: 1, chamberClass: 2 },
  { state: "HOK", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },

  // Tohoku (20 total: C1=10, C2=10)
  { state: "TOH", officeType: "sangiin", party: "jp_ldp", seatsHeld: 5, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_ldp", seatsHeld: 5, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_ishin", seatsHeld: 1, chamberClass: 2 },

  // Kanto (80 total: C1=40, C2=40)
  { state: "KAN", officeType: "sangiin", party: "jp_ldp", seatsHeld: 18, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_cdp", seatsHeld: 6, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_komeito", seatsHeld: 5, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 4, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_ishin", seatsHeld: 3, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_jcp", seatsHeld: 3, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_reiwa", seatsHeld: 1, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_ldp", seatsHeld: 18, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_cdp", seatsHeld: 6, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_komeito", seatsHeld: 5, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 3, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_ishin", seatsHeld: 3, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_jcp", seatsHeld: 2, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_reiwa", seatsHeld: 1, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 2 },

  // Chubu (44 total: C1=22, C2=22)
  { state: "CHU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 11, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_cdp", seatsHeld: 3, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 3, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 3, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_ishin", seatsHeld: 1, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 10, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 2, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_ishin", seatsHeld: 2, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_independent", seatsHeld: 3, chamberClass: 2 },

  // Kansai (44 total: C1=22, C2=22)
  { state: "KNS", officeType: "sangiin", party: "jp_ldp", seatsHeld: 9, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_ishin", seatsHeld: 3, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_komeito", seatsHeld: 3, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 2, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_sdp", seatsHeld: 1, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_ldp", seatsHeld: 9, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_ishin", seatsHeld: 3, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_sdp", seatsHeld: 1, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_independent", seatsHeld: 3, chamberClass: 2 },

  // Chugoku (14 total: C1=7, C2=7)
  { state: "CGK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 4, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_cdp", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 4, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_cdp", seatsHeld: 1, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 2 },

  // Shikoku (8 total: C1=4, C2=4)
  { state: "SHI", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_cdp", seatsHeld: 1, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 2 },
  { state: "SHI", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 2 },
  { state: "SHI", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },

  // Kyushu & Okinawa (31 total: C1=16, C2=15)
  { state: "KYU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 8, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 2, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_ishin", seatsHeld: 1, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 7, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_cdp", seatsHeld: 2, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_dpfp", seatsHeld: 1, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_nhk", seatsHeld: 1, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 2 },
];
// Sangiin totals: 248 seats (124 Class 1 + 124 Class 2)
// LDP 115, CDP 34, Komeito 30, DPFP 22, Ishin 17, JCP 15, Reiwa 2, SDP 2, NHK 1, Ind 10

export const JP_GOVERNORS_2020: HistoricalSeat[] = [
  // All JP governors are LDP-affiliated at game start (Jan 2020)
  { state: "HOK", officeType: "governor", party: "jp_ldp" },
  { state: "TOH", officeType: "governor", party: "jp_ldp" },
  { state: "KAN", officeType: "governor", party: "jp_ldp" },
  { state: "CHU", officeType: "governor", party: "jp_ldp" },
  { state: "KNS", officeType: "governor", party: "jp_ldp" },
  { state: "CGK", officeType: "governor", party: "jp_ldp" },
  { state: "SHI", officeType: "governor", party: "jp_ldp" },
  { state: "KYU", officeType: "governor", party: "jp_ldp" },
];

// ─── JP January 2020: Prefectural Assembly Seats (Regional Council) ─────────
// Aggregated from all 47 prefectural assemblies as of January 2020.
// Main source: 2019 unified local elections (41 prefectures) + off-cycle
// prefectures (Iwate Sep 2019, Miyagi Oct 2019, Fukushima Nov 2019,
// Ibaraki Dec 2018, Tokyo Jul 2017, Okinawa Jun 2016).
//
// Total across all 47 prefectures: ~2,679 seats
//
// KEY NOTES:
// - Many "independents" at the prefectural level are LDP-aligned conservatives.
//   The game treats them as LDP for party org strength, matching how the UK
//   regional council data rolls local independents into the nearest major party.
// - Osaka Ishin (Osaka Restoration Association) is the local wing of Nippon
//   Ishin no Kai — all Ishin-family seats are counted under jp_ishin.
// - Pre-merger CDP (Jan 2020) was small at the local level. Many former DPJ
//   members sat as independents or in local groups. CDP numbers here include
//   CDP-aligned local caucuses (e.g., Iwate's Kibo Iwate, Mie's Shinseikai).
// - DPFP (Democratic Party for the People) had modest local presence.
// - Tokyo's Tomin First no Kai seats are counted as independents for game
//   purposes (no national party equivalent in the game's 6-party system).

export const JP_REGIONAL_COUNCIL_2020: HistoricalSeat[] = [
  // Hokkaido (100 seats): LDP majority, CDP opposition base (strongest CDP prefecture)
  // Source: 2019 Hokkaido prefectural election
  { state: "HOK", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 51 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 24 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 8 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 3 },
  // 14 independents — mostly conservative-leaning, folded into LDP for game balance

  // Tohoku (299 seats): Strong LDP rural base across 6 prefectures
  // Aomori 48 + Iwate 48 + Miyagi 59 + Akita 43 + Yamagata 43 + Fukushima 58
  // LDP dominant but Iwate historically opposition-leaning (DPJ successor territory)
  { state: "TOH", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 170 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 35 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 12 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 20 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 9 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 4 },
  // ~49 independents/local parties absorbed into above

  // Kanto (581 seats): Largest region — mixed urban/suburban
  // Ibaraki 62 + Tochigi 50 + Gunma 50 + Saitama 93 + Chiba 94 + Tokyo 127 + Kanagawa 105
  // LDP strong in suburban/rural areas; Tokyo dominated by Tomin First (2017)
  // which has no national party equivalent — those seats go to independent/LDP pool
  { state: "KAN", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 280 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 55 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 56 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 38 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 5 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 18 },
  // ~129 independents/Tomin First absorbed — Tokyo skews this region's independent count

  // Chubu (483 seats): LDP-leaning industrial/rural mix
  // Niigata 53 + Toyama 40 + Ishikawa 43 + Fukui 37 + Yamanashi 37 + Nagano 57
  // + Gifu 46 + Shizuoka 68 + Aichi 102
  // Aichi (Toyota country) is the most competitive; Hokuriku strongly LDP
  { state: "CHU", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 280 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 15 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 24 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 16 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 9 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 13 },
  // ~126 independents absorbed — many LDP-aligned in Hokuriku/rural areas

  // Kansai (414 seats): Ishin stronghold (Osaka), diverse opposition elsewhere
  // Mie 51 + Shiga 44 + Kyoto 60 + Osaka 88 + Hyogo 86 + Nara 43 + Wakayama 42
  // Osaka Ishin dominates Osaka (51/88 seats); Kyoto has strong JCP presence
  { state: "KNS", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 148 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 62 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 42 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 32 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 14 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 4 },
  // ~112 independents/local parties absorbed — Mie/Shiga have large local blocs

  // Chugoku (238 seats): Strong LDP (Abe's home region of Yamaguchi)
  // Tottori 35 + Shimane 37 + Okayama 55 + Hiroshima 64 + Yamaguchi 47
  { state: "CGK", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 145 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 21 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 8 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 6 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 7 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 2 },
  // ~49 independents absorbed — heavily LDP-aligned in rural San'in

  // Shikoku (163 seats): Strong LDP, notable JCP presence in Kochi
  // Tokushima 38 + Kagawa 41 + Ehime 47 + Kochi 37
  { state: "SHI", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 96 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 9 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 10 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 4 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 4 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 3 },
  // ~37 independents absorbed — Ehime has large independent bloc

  // Kyushu & Okinawa (401 seats): LDP mainland dominance, Okinawa anti-base opposition
  // Fukuoka 87 + Saga 38 + Nagasaki 46 + Kumamoto 49 + Oita 43 + Miyazaki 39
  // + Kagoshima 51 + Okinawa 48
  // Okinawa uniquely has strong local opposition parties (Social Mass Party, etc.)
  { state: "KYU", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 222 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 31 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 17 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_cdp", seatsHeld: 12 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_ishin", seatsHeld: 22 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_dpfp", seatsHeld: 13 },
  // ~84 independents/Okinawa local parties absorbed
];
// Regional council totals: LDP 1392, Komeito 203, JCP 144, CDP 165, Ishin 130, DPFP 45 = 2079
// (remaining ~600 seats are independents/local parties folded into above allocations)

// ─── JP April 1991: Prefectural Assembly Compositions ───────────────────────
// The April 1991 unified local elections — the first big test for the LDP
// after the Recruit scandal — landed during the wave of "anti-political"
// independent candidacies. Result: LDP still dominant but with a large
// conservative-independent bloc, JSP holding its post-1989 peak, smaller
// Komeito/JCP/DSP presences.
//
// Composed from prefectural assembly compositions post-April 1991, with
// 1991-era parties only (jp_ldp, jp_jsp, jp_komeito, jp_jcp, jp_dsp,
// jp_independent). CDP / DPFP / Ishin are 2019-era parties and do not
// appear here. JSP is a 1991-only default party (`validForPresets` in
// `jpParties.ts`); DSP likewise.
//
// Unlike `JP_REGIONAL_COUNCIL_2020` (which under-counts and rolls
// independents into commentary), totals here match each region's
// configured `stateSenateSeats` in `src/lib/seeds/jp/jpRegions.ts` so the
// chamber size and seat allocation line up — matching the US/UK pattern
// used in this file.
//
// Each entry = ONE NPP holding all that party's seats in that region.

export const JP_REGIONAL_COUNCIL_1991: HistoricalSeat[] = [
  // Hokkaido (100 seats): LDP rural + JSP industrial / labor-union base.
  { state: "HOK", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 50 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 20 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 6 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 4 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 2 },
  { state: "HOK", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 18 },

  // Tohoku (299 seats): Strong LDP rural plurality; JSP holds industrial
  // Niigata / Miyagi / Iwate. Big conservative-independent bloc.
  { state: "TOH", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 175 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 55 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 12 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 8 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 4 },
  { state: "TOH", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 45 },

  // Kanto (581 seats): Largest region — Tokyo / Kanagawa / Saitama / Chiba +
  // surrounding prefectures. Most diverse opposition presence, urban
  // Komeito + JCP strength.
  { state: "KAN", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 240 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 90 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 60 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 35 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 16 },
  { state: "KAN", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 140 },

  // Chubu (483 seats): LDP-leaning industrial (Aichi) + rural (Hokuriku).
  { state: "CHU", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 245 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 65 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 28 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 12 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 8 },
  { state: "CHU", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 125 },

  // Kansai (414 seats): Osaka / Kyoto / Hyogo. Stronger DSP + Komeito base
  // in Osaka labor districts; Kyoto's notable JCP presence.
  { state: "KNS", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 165 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 50 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 50 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 30 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 22 },
  { state: "KNS", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 97 },

  // Chugoku (238 seats): Strong LDP across Yamaguchi / Hiroshima.
  { state: "CGK", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 130 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 32 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 18 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 5 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 3 },
  { state: "CGK", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 50 },

  // Shikoku (163 seats): Strong LDP. Kochi has a small but persistent JCP base.
  { state: "SHI", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 90 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 22 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 10 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 6 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 2 },
  { state: "SHI", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 33 },

  // Kyushu & Okinawa (401 seats): LDP mainland dominance + JSP industrial
  // base in Fukuoka. Okinawa skews more opposition-friendly but the local
  // anti-base parties (Social Mass Party etc.) fold into `jp_independent`.
  { state: "KYU", officeType: "regionalCouncil", party: "jp_ldp", seatsHeld: 220 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_jsp", seatsHeld: 50 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_komeito", seatsHeld: 25 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_jcp", seatsHeld: 15 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_dsp", seatsHeld: 6 },
  { state: "KYU", officeType: "regionalCouncil", party: "jp_independent", seatsHeld: 85 },
];

// ─── JP February 1990: 39th General Election ─────────────────────────────────
// Shugiin: 512 seats
// LDP 275, JSP 136, Komeito 45, JCP 16, DSP 14, SDF 1, Ind 25
// Party slugs: jp_ldp (LDP), jp_jsp (JSP — 1991-only default), jp_komeito,
// jp_jcp, jp_dsp (DSP — 1991-only default), jp_independent (SDF + independents).
// CDP / DPFP / Ishin are 2019-era parties and don't appear here.

export const JP_SHUGIIN_1990: HistoricalSeat[] = [
  // HOK (23 seats): LDP rural + JSP labor-union strongholds. LDP 11, JSP 6,
  // Komeito 1, JCP 1, DSP 0, Ind 4 = 23.
  { state: "HOK", officeType: "shugiin", party: "jp_ldp", seatsHeld: 11 },
  { state: "HOK", officeType: "shugiin", party: "jp_jsp", seatsHeld: 6 },
  { state: "HOK", officeType: "shugiin", party: "jp_komeito", seatsHeld: 1 },
  { state: "HOK", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },
  { state: "HOK", officeType: "shugiin", party: "jp_independent", seatsHeld: 4 },

  // TOH (62 seats): rural LDP heartland, JSP holds industrial Niigata + Miyagi.
  // LDP 32, JSP 18, Komeito 3, JCP 1, DSP 1, Ind 7 = 62.
  { state: "TOH", officeType: "shugiin", party: "jp_ldp", seatsHeld: 32 },
  { state: "TOH", officeType: "shugiin", party: "jp_jsp", seatsHeld: 18 },
  { state: "TOH", officeType: "shugiin", party: "jp_komeito", seatsHeld: 3 },
  { state: "TOH", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },
  { state: "TOH", officeType: "shugiin", party: "jp_dsp", seatsHeld: 1 },
  { state: "TOH", officeType: "shugiin", party: "jp_independent", seatsHeld: 7 },

  // KAN (143 seats): Tokyo metro — JSP's industrial-labor base + Komeito
  // Soka Gakkai concentration + JCP urban strongholds. LDP 70, JSP 44,
  // Komeito 16, JCP 7, DSP 5, Ind 1 = 143.
  { state: "KAN", officeType: "shugiin", party: "jp_ldp", seatsHeld: 70 },
  { state: "KAN", officeType: "shugiin", party: "jp_jsp", seatsHeld: 44 },
  { state: "KAN", officeType: "shugiin", party: "jp_komeito", seatsHeld: 16 },
  { state: "KAN", officeType: "shugiin", party: "jp_jcp", seatsHeld: 7 },
  { state: "KAN", officeType: "shugiin", party: "jp_dsp", seatsHeld: 5 },
  { state: "KAN", officeType: "shugiin", party: "jp_independent", seatsHeld: 1 },

  // CHU (75 seats): industrial Aichi (Toyota/Nagoya) blunts LDP dominance.
  // LDP 41, JSP 17, Komeito 7, JCP 2, DSP 3, Ind 5 = 75.
  { state: "CHU", officeType: "shugiin", party: "jp_ldp", seatsHeld: 41 },
  { state: "CHU", officeType: "shugiin", party: "jp_jsp", seatsHeld: 17 },
  { state: "CHU", officeType: "shugiin", party: "jp_komeito", seatsHeld: 7 },
  { state: "CHU", officeType: "shugiin", party: "jp_jcp", seatsHeld: 2 },
  { state: "CHU", officeType: "shugiin", party: "jp_dsp", seatsHeld: 3 },
  { state: "CHU", officeType: "shugiin", party: "jp_independent", seatsHeld: 5 },

  // KNS (78 seats): Osaka metro — JSP industrial Sōhyō unions, strong
  // Komeito + DSP urban presence. LDP 33, JSP 22, Komeito 11, JCP 3,
  // DSP 4, Ind 5 = 78.
  { state: "KNS", officeType: "shugiin", party: "jp_ldp", seatsHeld: 33 },
  { state: "KNS", officeType: "shugiin", party: "jp_jsp", seatsHeld: 22 },
  { state: "KNS", officeType: "shugiin", party: "jp_komeito", seatsHeld: 11 },
  { state: "KNS", officeType: "shugiin", party: "jp_jcp", seatsHeld: 3 },
  { state: "KNS", officeType: "shugiin", party: "jp_dsp", seatsHeld: 4 },
  { state: "KNS", officeType: "shugiin", party: "jp_independent", seatsHeld: 5 },

  // CGK (30 seats): rural LDP heartland. LDP 19, JSP 6, Komeito 2, JCP 1,
  // DSP 0, Ind 2 = 30.
  { state: "CGK", officeType: "shugiin", party: "jp_ldp", seatsHeld: 19 },
  { state: "CGK", officeType: "shugiin", party: "jp_jsp", seatsHeld: 6 },
  { state: "CGK", officeType: "shugiin", party: "jp_komeito", seatsHeld: 2 },
  { state: "CGK", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },
  { state: "CGK", officeType: "shugiin", party: "jp_independent", seatsHeld: 2 },

  // SHI (16 seats): smallest region, LDP dominant. LDP 11, JSP 3, Komeito 1,
  // Ind 1 = 16.
  { state: "SHI", officeType: "shugiin", party: "jp_ldp", seatsHeld: 11 },
  { state: "SHI", officeType: "shugiin", party: "jp_jsp", seatsHeld: 3 },
  { state: "SHI", officeType: "shugiin", party: "jp_komeito", seatsHeld: 1 },
  { state: "SHI", officeType: "shugiin", party: "jp_independent", seatsHeld: 1 },

  // KYU (85 seats): LDP mainland dominance plus JSP union strength in
  // Fukuoka coal-belt + Okinawa anti-base opposition. LDP 58, JSP 20,
  // Komeito 4, JCP 1, DSP 1, Ind 1 = 85.
  { state: "KYU", officeType: "shugiin", party: "jp_ldp", seatsHeld: 58 },
  { state: "KYU", officeType: "shugiin", party: "jp_jsp", seatsHeld: 20 },
  { state: "KYU", officeType: "shugiin", party: "jp_komeito", seatsHeld: 4 },
  { state: "KYU", officeType: "shugiin", party: "jp_jcp", seatsHeld: 1 },
  { state: "KYU", officeType: "shugiin", party: "jp_dsp", seatsHeld: 1 },
  { state: "KYU", officeType: "shugiin", party: "jp_independent", seatsHeld: 1 },
];
// Totals: LDP 275, JSP 136, Komeito 45, JCP 16, DSP 14, Ind 26 = 512 ✓
// (Independent total includes Social Democratic Federation's 4 seats + 22 true independents.)

export const JP_SANGIIN_1989: HistoricalSeat[] = [
  { state: "HOK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "HOK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 1, chamberClass: 2 },
  { state: "HOK", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 2 },
  { state: "HOK", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },

  { state: "TOH", officeType: "sangiin", party: "jp_ldp", seatsHeld: 4, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_jsp", seatsHeld: 2, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_dsp", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "TOH", officeType: "sangiin", party: "jp_ldp", seatsHeld: 4, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_jsp", seatsHeld: 2, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 2 },
  { state: "TOH", officeType: "sangiin", party: "jp_dsp", seatsHeld: 1, chamberClass: 2 },
  // Ishin entry dropped — Nippon Ishin no Kai didn't exist until 2010.

  { state: "KAN", officeType: "sangiin", party: "jp_ldp", seatsHeld: 16, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_jsp", seatsHeld: 6, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_komeito", seatsHeld: 4, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_dsp", seatsHeld: 2, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_jcp", seatsHeld: 2, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 1 },
  { state: "KAN", officeType: "sangiin", party: "jp_ldp", seatsHeld: 16, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_jsp", seatsHeld: 6, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_komeito", seatsHeld: 4, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_jcp", seatsHeld: 2, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_dsp", seatsHeld: 2, chamberClass: 2 },
  { state: "KAN", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 2 },

  { state: "CHU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 9, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_dsp", seatsHeld: 1, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 1 },
  { state: "CHU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 9, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "CHU", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 2 },

  { state: "KNS", officeType: "sangiin", party: "jp_ldp", seatsHeld: 8, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_komeito", seatsHeld: 3, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_dsp", seatsHeld: 1, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 1 },
  { state: "KNS", officeType: "sangiin", party: "jp_ldp", seatsHeld: 8, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_komeito", seatsHeld: 3, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "KNS", officeType: "sangiin", party: "jp_independent", seatsHeld: 2, chamberClass: 2 },

  { state: "CGK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 3, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "CGK", officeType: "sangiin", party: "jp_ldp", seatsHeld: 3, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 2 },
  { state: "CGK", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 2 },

  { state: "SHI", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_komeito", seatsHeld: 1, chamberClass: 1 },
  { state: "SHI", officeType: "sangiin", party: "jp_ldp", seatsHeld: 2, chamberClass: 2 },
  { state: "SHI", officeType: "sangiin", party: "jp_jsp", seatsHeld: 1, chamberClass: 2 },
  { state: "SHI", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },

  { state: "KYU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 7, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 1 },
  { state: "KYU", officeType: "sangiin", party: "jp_ldp", seatsHeld: 7, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_jsp", seatsHeld: 3, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_komeito", seatsHeld: 2, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_jcp", seatsHeld: 1, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_dsp", seatsHeld: 1, chamberClass: 2 },
  { state: "KYU", officeType: "sangiin", party: "jp_independent", seatsHeld: 1, chamberClass: 2 },
];

// Source data is the 1990 prefectural baseline (all eight macro-regions held
// by LDP-aligned governors). Identifier suffixed `_1991` to match the
// `1991-default` reset preset id; the underlying composition is unchanged.
export const JP_GOVERNORS_1991: HistoricalSeat[] = [
  { state: "HOK", officeType: "governor", party: "jp_ldp" },
  { state: "TOH", officeType: "governor", party: "jp_ldp" },
  { state: "KAN", officeType: "governor", party: "jp_ldp" },
  { state: "CHU", officeType: "governor", party: "jp_ldp" },
  { state: "KNS", officeType: "governor", party: "jp_ldp" },
  { state: "CGK", officeType: "governor", party: "jp_ldp" },
  { state: "SHI", officeType: "governor", party: "jp_ldp" },
  { state: "KYU", officeType: "governor", party: "jp_ldp" },
];

// ─── Nigeria: zone governors (one per geopolitical zone). Like JP, only the
// executive seats are seeded historically; the National Assembly fills via
// elections. Party per zone follows the dominant party in ngRegionVoteShares.
export const NG_GOVERNORS_2019: HistoricalSeat[] = [
  { state: "NORTH_WEST", officeType: "governor", party: "ng_apc" },
  { state: "NORTH_EAST", officeType: "governor", party: "ng_apc" },
  { state: "NORTH_CENTRAL", officeType: "governor", party: "ng_apc" },
  { state: "SOUTH_WEST", officeType: "governor", party: "ng_apc" },
  { state: "SOUTH_SOUTH", officeType: "governor", party: "ng_pdp" },
  { state: "SOUTH_EAST", officeType: "governor", party: "ng_apga" },
];

// 1991 Third Republic: SDP dominant in SW/NC/SS; NRC in NW/NE/SE.
export const NG_GOVERNORS_1991: HistoricalSeat[] = [
  { state: "NORTH_WEST", officeType: "governor", party: "ng_nrc" },
  { state: "NORTH_EAST", officeType: "governor", party: "ng_nrc" },
  { state: "NORTH_CENTRAL", officeType: "governor", party: "ng_sdp" },
  { state: "SOUTH_WEST", officeType: "governor", party: "ng_sdp" },
  { state: "SOUTH_SOUTH", officeType: "governor", party: "ng_sdp" },
  { state: "SOUTH_EAST", officeType: "governor", party: "ng_nrc" },
];

// 1953 late-colonial: map the three Regional Premiers onto the 6-zone grid.
// Northern Region (Bello / NPC) → NW/NE/NC; Western (Awolowo / AG) → SW;
// Eastern (Azikiwe / NCNC) → SE/SS. Nigeria had no zone governors in 1953 —
// these are the engine's sub-national executive seats standing in for regional
// party control under Macpherson/Lyttelton.
export const NG_GOVERNORS_1953: HistoricalSeat[] = [
  { state: "NORTH_WEST", officeType: "governor", party: "ng_npc" },
  { state: "NORTH_EAST", officeType: "governor", party: "ng_npc" },
  { state: "NORTH_CENTRAL", officeType: "governor", party: "ng_npc" },
  { state: "SOUTH_WEST", officeType: "governor", party: "ng_ag" },
  { state: "SOUTH_SOUTH", officeType: "governor", party: "ng_ncnc" },
  { state: "SOUTH_EAST", officeType: "governor", party: "ng_ncnc" },
];

// ─── Germany: 20th Bundestag (post-2021 election) scaled + 2020 Ministerpräsidenten ──
// Seat counts scaled down from the 736-seat 2021 Bundestag to 201 NPP-held seats
// to match the existing seed-de-npps targets (SPD 56, CDU 42, CSU 12, Greens 32,
// FDP 25, AfD 23, Linke 11). Distribution per Land follows 2021 Zweitstimmen
// vote shares and Land population. One NPP per (Land × party) holds that
// party's seatsHeld share of the Bundestag group for that Land.
export const DE_BUNDESTAG_2021: HistoricalSeat[] = [
  // Baden-Württemberg (~14% pop — CDU-leaning, strong Greens)
  { state: "BW", officeType: "bundestag", party: "de_spd", seatsHeld: 7 },
  { state: "BW", officeType: "bundestag", party: "de_cdu", seatsHeld: 7 },
  { state: "BW", officeType: "bundestag", party: "de_greens", seatsHeld: 6 },
  { state: "BW", officeType: "bundestag", party: "de_fdp", seatsHeld: 4 },
  { state: "BW", officeType: "bundestag", party: "de_afd", seatsHeld: 3 },
  { state: "BW", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Bayern (~16% pop — CSU replaces CDU here)
  { state: "BY", officeType: "bundestag", party: "de_spd", seatsHeld: 7 },
  { state: "BY", officeType: "bundestag", party: "de_csu", seatsHeld: 12 },
  { state: "BY", officeType: "bundestag", party: "de_greens", seatsHeld: 5 },
  { state: "BY", officeType: "bundestag", party: "de_fdp", seatsHeld: 3 },
  { state: "BY", officeType: "bundestag", party: "de_afd", seatsHeld: 3 },
  // Berlin (city-state, left-liberal)
  { state: "BE", officeType: "bundestag", party: "de_spd", seatsHeld: 2 },
  { state: "BE", officeType: "bundestag", party: "de_cdu", seatsHeld: 2 },
  { state: "BE", officeType: "bundestag", party: "de_greens", seatsHeld: 2 },
  { state: "BE", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "BE", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  { state: "BE", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Brandenburg (east — strong AfD)
  { state: "BB", officeType: "bundestag", party: "de_spd", seatsHeld: 2 },
  { state: "BB", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  { state: "BB", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "BB", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "BB", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  // Bremen (smallest, SPD stronghold)
  { state: "BRE", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "BRE", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  // Hamburg (SPD/Greens)
  { state: "HH", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "HH", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  { state: "HH", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "HH", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  // Hessen
  { state: "HE", officeType: "bundestag", party: "de_spd", seatsHeld: 5 },
  { state: "HE", officeType: "bundestag", party: "de_cdu", seatsHeld: 4 },
  { state: "HE", officeType: "bundestag", party: "de_greens", seatsHeld: 2 },
  { state: "HE", officeType: "bundestag", party: "de_fdp", seatsHeld: 3 },
  { state: "HE", officeType: "bundestag", party: "de_afd", seatsHeld: 2 },
  { state: "HE", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Mecklenburg-Vorpommern (east)
  { state: "MV", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "MV", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  { state: "MV", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  { state: "MV", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Niedersachsen (large north — SPD leaning)
  { state: "NI", officeType: "bundestag", party: "de_spd", seatsHeld: 6 },
  { state: "NI", officeType: "bundestag", party: "de_cdu", seatsHeld: 5 },
  { state: "NI", officeType: "bundestag", party: "de_greens", seatsHeld: 3 },
  { state: "NI", officeType: "bundestag", party: "de_fdp", seatsHeld: 2 },
  { state: "NI", officeType: "bundestag", party: "de_afd", seatsHeld: 2 },
  { state: "NI", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Nordrhein-Westfalen (largest Land by population)
  { state: "NW", officeType: "bundestag", party: "de_spd", seatsHeld: 14 },
  { state: "NW", officeType: "bundestag", party: "de_cdu", seatsHeld: 11 },
  { state: "NW", officeType: "bundestag", party: "de_greens", seatsHeld: 8 },
  { state: "NW", officeType: "bundestag", party: "de_fdp", seatsHeld: 5 },
  { state: "NW", officeType: "bundestag", party: "de_afd", seatsHeld: 3 },
  { state: "NW", officeType: "bundestag", party: "de_linke", seatsHeld: 2 },
  // Rheinland-Pfalz
  { state: "RP", officeType: "bundestag", party: "de_spd", seatsHeld: 3 },
  { state: "RP", officeType: "bundestag", party: "de_cdu", seatsHeld: 3 },
  { state: "RP", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "RP", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "RP", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  { state: "RP", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Saarland (smallest western)
  { state: "SL", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "SL", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  // Sachsen (east — AfD stronghold)
  { state: "SN", officeType: "bundestag", party: "de_spd", seatsHeld: 2 },
  { state: "SN", officeType: "bundestag", party: "de_cdu", seatsHeld: 2 },
  { state: "SN", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "SN", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "SN", officeType: "bundestag", party: "de_afd", seatsHeld: 3 },
  { state: "SN", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Sachsen-Anhalt (east)
  { state: "ST", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "ST", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  { state: "ST", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "ST", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  { state: "ST", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
  // Schleswig-Holstein
  { state: "SH", officeType: "bundestag", party: "de_spd", seatsHeld: 2 },
  { state: "SH", officeType: "bundestag", party: "de_cdu", seatsHeld: 2 },
  { state: "SH", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "SH", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "SH", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  // Thüringen (east — AfD + Linke)
  { state: "TH", officeType: "bundestag", party: "de_spd", seatsHeld: 1 },
  { state: "TH", officeType: "bundestag", party: "de_cdu", seatsHeld: 1 },
  { state: "TH", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "TH", officeType: "bundestag", party: "de_afd", seatsHeld: 1 },
  { state: "TH", officeType: "bundestag", party: "de_linke", seatsHeld: 1 },
];
// Bundestag totals: SPD 56, CDU 42, CSU 12, Greens 32, FDP 25, AfD 23, Linke 11 = 201

// Ministerpräsidenten as of February 2020 (before the 2021 NRW+SH+MV shuffles).
// 7 SPD, 6 CDU, 1 CSU, 1 Greens, 1 Linke.
export const DE_MINISTERPRAESIDENTEN_2020: HistoricalSeat[] = [
  { state: "BW", officeType: "ministerPresident", party: "de_greens" }, // Kretschmann
  { state: "BY", officeType: "ministerPresident", party: "de_csu" }, // Söder
  { state: "BE", officeType: "ministerPresident", party: "de_spd" }, // Müller
  { state: "BB", officeType: "ministerPresident", party: "de_spd" }, // Woidke
  { state: "BRE", officeType: "ministerPresident", party: "de_spd" }, // Bovenschulte
  { state: "HH", officeType: "ministerPresident", party: "de_spd" }, // Tschentscher
  { state: "HE", officeType: "ministerPresident", party: "de_cdu" }, // Bouffier
  { state: "MV", officeType: "ministerPresident", party: "de_spd" }, // Schwesig
  { state: "NI", officeType: "ministerPresident", party: "de_spd" }, // Weil
  { state: "NW", officeType: "ministerPresident", party: "de_cdu" }, // Laschet
  { state: "RP", officeType: "ministerPresident", party: "de_spd" }, // Dreyer
  { state: "SL", officeType: "ministerPresident", party: "de_cdu" }, // Hans
  { state: "SN", officeType: "ministerPresident", party: "de_cdu" }, // Kretschmer
  { state: "ST", officeType: "ministerPresident", party: "de_cdu" }, // Haseloff
  { state: "SH", officeType: "ministerPresident", party: "de_cdu" }, // Günther
  { state: "TH", officeType: "ministerPresident", party: "de_linke" }, // Ramelow
];

// ─── Germany: 12th Bundestag (1990-1994) + 1992 Ministerpräsidenten ──────────
// First all-German election after reunification (3 Oct 1990).
// Seat counts scaled from 662-seat Bundestag.

export const DE_BUNDESTAG_1990: HistoricalSeat[] = [
  { state: "BW", officeType: "bundestag", party: "de_spd", seatsHeld: 24 },
  { state: "BW", officeType: "bundestag", party: "de_cdu", seatsHeld: 39 },
  { state: "BW", officeType: "bundestag", party: "de_greens", seatsHeld: 10 },
  { state: "BW", officeType: "bundestag", party: "de_fdp", seatsHeld: 10 },

  { state: "BY", officeType: "bundestag", party: "de_spd", seatsHeld: 26 },
  { state: "BY", officeType: "bundestag", party: "de_csu", seatsHeld: 51 },
  { state: "BY", officeType: "bundestag", party: "de_fdp", seatsHeld: 9 },

  { state: "BE", officeType: "bundestag", party: "de_spd", seatsHeld: 9 },
  { state: "BE", officeType: "bundestag", party: "de_cdu", seatsHeld: 12 },
  { state: "BE", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
  { state: "BE", officeType: "bundestag", party: "de_fdp", seatsHeld: 3 },
  { state: "BE", officeType: "bundestag", party: "de_pds", seatsHeld: 3 },

  { state: "BB", officeType: "bundestag", party: "de_spd", seatsHeld: 7 },
  { state: "BB", officeType: "bundestag", party: "de_cdu", seatsHeld: 8 },
  { state: "BB", officeType: "bundestag", party: "de_fdp", seatsHeld: 2 },
  { state: "BB", officeType: "bundestag", party: "de_pds", seatsHeld: 3 },
  { state: "BB", officeType: "bundestag", party: "de_greens", seatsHeld: 2 },

  { state: "BRE", officeType: "bundestag", party: "de_spd", seatsHeld: 3 },
  { state: "BRE", officeType: "bundestag", party: "de_cdu", seatsHeld: 2 },
  { state: "BRE", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },

  { state: "HH", officeType: "bundestag", party: "de_spd", seatsHeld: 6 },
  { state: "HH", officeType: "bundestag", party: "de_cdu", seatsHeld: 6 },
  { state: "HH", officeType: "bundestag", party: "de_fdp", seatsHeld: 2 },

  { state: "HE", officeType: "bundestag", party: "de_spd", seatsHeld: 20 },
  { state: "HE", officeType: "bundestag", party: "de_cdu", seatsHeld: 22 },
  { state: "HE", officeType: "bundestag", party: "de_fdp", seatsHeld: 6 },

  { state: "MV", officeType: "bundestag", party: "de_spd", seatsHeld: 4 },
  { state: "MV", officeType: "bundestag", party: "de_cdu", seatsHeld: 8 },
  { state: "MV", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },
  { state: "MV", officeType: "bundestag", party: "de_pds", seatsHeld: 2 },
  { state: "MV", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },

  { state: "NI", officeType: "bundestag", party: "de_spd", seatsHeld: 27 },
  { state: "NI", officeType: "bundestag", party: "de_cdu", seatsHeld: 31 },
  { state: "NI", officeType: "bundestag", party: "de_fdp", seatsHeld: 7 },

  { state: "NW", officeType: "bundestag", party: "de_spd", seatsHeld: 65 },
  { state: "NW", officeType: "bundestag", party: "de_cdu", seatsHeld: 63 },
  { state: "NW", officeType: "bundestag", party: "de_fdp", seatsHeld: 17 },
  { state: "NW", officeType: "bundestag", party: "de_pds", seatsHeld: 1 },

  { state: "RP", officeType: "bundestag", party: "de_spd", seatsHeld: 13 },
  { state: "RP", officeType: "bundestag", party: "de_cdu", seatsHeld: 17 },
  { state: "RP", officeType: "bundestag", party: "de_fdp", seatsHeld: 4 },

  { state: "SL", officeType: "bundestag", party: "de_spd", seatsHeld: 6 },
  { state: "SL", officeType: "bundestag", party: "de_cdu", seatsHeld: 4 },
  { state: "SL", officeType: "bundestag", party: "de_fdp", seatsHeld: 1 },

  { state: "SN", officeType: "bundestag", party: "de_spd", seatsHeld: 8 },
  { state: "SN", officeType: "bundestag", party: "de_cdu", seatsHeld: 21 },
  { state: "SN", officeType: "bundestag", party: "de_fdp", seatsHeld: 5 },
  { state: "SN", officeType: "bundestag", party: "de_pds", seatsHeld: 4 },
  { state: "SN", officeType: "bundestag", party: "de_greens", seatsHeld: 2 },

  { state: "ST", officeType: "bundestag", party: "de_spd", seatsHeld: 6 },
  { state: "ST", officeType: "bundestag", party: "de_cdu", seatsHeld: 12 },
  { state: "ST", officeType: "bundestag", party: "de_fdp", seatsHeld: 5 },
  { state: "ST", officeType: "bundestag", party: "de_pds", seatsHeld: 2 },
  { state: "ST", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },

  { state: "SH", officeType: "bundestag", party: "de_spd", seatsHeld: 10 },
  { state: "SH", officeType: "bundestag", party: "de_cdu", seatsHeld: 11 },
  { state: "SH", officeType: "bundestag", party: "de_fdp", seatsHeld: 3 },

  { state: "TH", officeType: "bundestag", party: "de_spd", seatsHeld: 5 },
  { state: "TH", officeType: "bundestag", party: "de_cdu", seatsHeld: 12 },
  { state: "TH", officeType: "bundestag", party: "de_fdp", seatsHeld: 3 },
  { state: "TH", officeType: "bundestag", party: "de_pds", seatsHeld: 2 },
  { state: "TH", officeType: "bundestag", party: "de_greens", seatsHeld: 1 },
];

export const DE_MINISTERPRAESIDENTEN_1992: HistoricalSeat[] = [
  { state: "BW", officeType: "ministerPresident", party: "de_cdu" }, // Teufel
  { state: "BY", officeType: "ministerPresident", party: "de_csu" }, // Streibl
  { state: "BE", officeType: "ministerPresident", party: "de_cdu" }, // Diepgen
  { state: "BB", officeType: "ministerPresident", party: "de_spd" }, // Stolpe
  { state: "BRE", officeType: "ministerPresident", party: "de_spd" }, // Wedemeier
  { state: "HH", officeType: "ministerPresident", party: "de_spd" }, // Voscherau
  { state: "HE", officeType: "ministerPresident", party: "de_spd" }, // Eichel
  { state: "MV", officeType: "ministerPresident", party: "de_cdu" }, // Gomolka
  { state: "NI", officeType: "ministerPresident", party: "de_spd" }, // Schröder
  { state: "NW", officeType: "ministerPresident", party: "de_spd" }, // Rau
  { state: "RP", officeType: "ministerPresident", party: "de_spd" }, // Scharping
  { state: "SL", officeType: "ministerPresident", party: "de_spd" }, // Lafontaine
  { state: "SN", officeType: "ministerPresident", party: "de_cdu" }, // Biedenkopf
  { state: "ST", officeType: "ministerPresident", party: "de_cdu" }, // Münch
  { state: "SH", officeType: "ministerPresident", party: "de_spd" }, // Engholm
  { state: "TH", officeType: "ministerPresident", party: "de_cdu" }, // Duchač
];

// ─── DE 1990: Landtag Compositions ──────────────────────────────────────────
// Party splits reflect Landtag control entering 1991. Western Länder use
// their most recent pre-1991 election (1986 Bayern, 1988 BW, 1988 SH, 1990
// NRW, 1990 NI, 1990 SL, etc.); East German Länder use the October 1990
// post-reunification founding elections; Berlin uses the December 1990
// reunified Abgeordnetenhaus election; HE/HH/HB use early-1991 results
// (these elections fell within Q1 1991, before the game's 1991-default
// reset point).
//
// Totals match each Land's configured `stateSenateSeats` in
// `src/lib/seeds/de/deRegions.ts` (which DE uses as the Landtag seat count
// — there's no separate sub-national upper chamber). Where the chamber
// size changed since 1990 (most reform happened 1995-2010), 1990 partisan
// ratios are preserved while absolute counts are scaled to the modern
// configured size.
//
// Notable party slugs:
//   - de_pds: 1991-only default, present only in East German Länder + Berlin.
//   - Republikaner: surged in 1988 BW but stayed below threshold and won 0
//     seats; not represented here.
//   - SSW (Schleswig-Holstein) and STATT (Hamburg) are not seeded as
//     default DE parties — their seats fold into `de_independent` for
//     game purposes, matching how UK_REGIONAL_COUNCIL_1992 handles uk_sdlp.
//
// Each entry = ONE NPP holding all that party's seats in that Land.

// ─── DE 2020: Landtag Compositions ──────────────────────────────────────────
// Most recent Landtag election per Land as of February 2020. By Land:
//   BW 2016, BY 2018, NW 2017, HE 2018, RP 2016, SL 2017, NI 2017,
//   SH 2017, HH 2015, HB 2019, BE 2016, BB 2019, MV 2016, SN 2019,
//   ST 2016, TH 2019.
//
// Notable shifts vs DE_LANDTAG_1990: AfD enters every Land (post-2013
// founding), Linke retains former-GDR base, FDP returns to most
// chambers after the 2013 wipeout. Local lists (FW Bayern, SSW
// Schleswig-Holstein, BVB/FW Brandenburg) fold into `de_independent`
// matching the 1990 dataset's convention.
//
// Totals match each Land's configured `stateSenateSeats` in
// `src/lib/seeds/de/deRegions.ts`; where chamber sizes changed between
// the election year and current config (e.g. HH 121→123, NI 137→146,
// HB 84→87), the 2019/2020-era partisan ratios are preserved while
// absolute counts scale to current size.

export const DE_LANDTAG_2020: HistoricalSeat[] = [
  // Baden-Württemberg (154 seats): 2016 election. Grüne plurality under
  // Kretschmann; first AfD entry into a western Landtag.
  { state: "BW", officeType: "landtag", party: "de_greens", seatsHeld: 47 },
  { state: "BW", officeType: "landtag", party: "de_cdu", seatsHeld: 42 },
  { state: "BW", officeType: "landtag", party: "de_afd", seatsHeld: 23 },
  { state: "BW", officeType: "landtag", party: "de_spd", seatsHeld: 19 },
  { state: "BW", officeType: "landtag", party: "de_fdp", seatsHeld: 12 },
  { state: "BW", officeType: "landtag", party: "de_independent", seatsHeld: 11 },

  // Bayern (203 seats): 2018 election. CSU loses absolute majority for
  // first time since 1966; CSU-FW coalition under Söder. Freie Wähler
  // and minor lists fold into de_independent.
  { state: "BY", officeType: "landtag", party: "de_csu", seatsHeld: 84 },
  { state: "BY", officeType: "landtag", party: "de_greens", seatsHeld: 38 },
  { state: "BY", officeType: "landtag", party: "de_afd", seatsHeld: 22 },
  { state: "BY", officeType: "landtag", party: "de_spd", seatsHeld: 22 },
  { state: "BY", officeType: "landtag", party: "de_fdp", seatsHeld: 10 },
  { state: "BY", officeType: "landtag", party: "de_independent", seatsHeld: 27 },

  // Nordrhein-Westfalen (195 seats): 2017 election. CDU-FDP coalition
  // under Laschet ends the long SPD streak.
  { state: "NW", officeType: "landtag", party: "de_cdu", seatsHeld: 70 },
  { state: "NW", officeType: "landtag", party: "de_spd", seatsHeld: 67 },
  { state: "NW", officeType: "landtag", party: "de_fdp", seatsHeld: 27 },
  { state: "NW", officeType: "landtag", party: "de_afd", seatsHeld: 16 },
  { state: "NW", officeType: "landtag", party: "de_greens", seatsHeld: 14 },
  { state: "NW", officeType: "landtag", party: "de_independent", seatsHeld: 1 },

  // Hessen (137 seats): 2018 election. CDU-Grüne coalition under Bouffier
  // continues. Grüne tied with SPD for second place — rising green wave.
  { state: "HE", officeType: "landtag", party: "de_cdu", seatsHeld: 40 },
  { state: "HE", officeType: "landtag", party: "de_greens", seatsHeld: 29 },
  { state: "HE", officeType: "landtag", party: "de_spd", seatsHeld: 29 },
  { state: "HE", officeType: "landtag", party: "de_afd", seatsHeld: 19 },
  { state: "HE", officeType: "landtag", party: "de_fdp", seatsHeld: 11 },
  { state: "HE", officeType: "landtag", party: "de_linke", seatsHeld: 9 },

  // Rheinland-Pfalz (101 seats): 2016 election. SPD-FDP-Grüne "traffic
  // light" coalition under Dreyer.
  { state: "RP", officeType: "landtag", party: "de_spd", seatsHeld: 39 },
  { state: "RP", officeType: "landtag", party: "de_cdu", seatsHeld: 35 },
  { state: "RP", officeType: "landtag", party: "de_afd", seatsHeld: 14 },
  { state: "RP", officeType: "landtag", party: "de_fdp", seatsHeld: 7 },
  { state: "RP", officeType: "landtag", party: "de_greens", seatsHeld: 6 },

  // Saarland (51 seats): 2017 election. CDU-SPD grand coalition under
  // Annegret Kramp-Karrenbauer (later Hans).
  { state: "SL", officeType: "landtag", party: "de_cdu", seatsHeld: 24 },
  { state: "SL", officeType: "landtag", party: "de_spd", seatsHeld: 17 },
  { state: "SL", officeType: "landtag", party: "de_linke", seatsHeld: 7 },
  { state: "SL", officeType: "landtag", party: "de_afd", seatsHeld: 3 },

  // Niedersachsen (146 seats): 2017 election. SPD-CDU grand coalition
  // under Weil after SPD lost outright majority.
  { state: "NI", officeType: "landtag", party: "de_spd", seatsHeld: 58 },
  { state: "NI", officeType: "landtag", party: "de_cdu", seatsHeld: 53 },
  { state: "NI", officeType: "landtag", party: "de_greens", seatsHeld: 13 },
  { state: "NI", officeType: "landtag", party: "de_fdp", seatsHeld: 12 },
  { state: "NI", officeType: "landtag", party: "de_afd", seatsHeld: 10 },

  // Schleswig-Holstein (73 seats): 2017 election. CDU-Grüne-FDP
  // "Jamaica" coalition under Günther. SSW (Danish minority) holds 3
  // seats — folds into de_independent.
  { state: "SH", officeType: "landtag", party: "de_cdu", seatsHeld: 25 },
  { state: "SH", officeType: "landtag", party: "de_spd", seatsHeld: 21 },
  { state: "SH", officeType: "landtag", party: "de_greens", seatsHeld: 10 },
  { state: "SH", officeType: "landtag", party: "de_fdp", seatsHeld: 9 },
  { state: "SH", officeType: "landtag", party: "de_afd", seatsHeld: 5 },
  { state: "SH", officeType: "landtag", party: "de_independent", seatsHeld: 3 },

  // Hamburg (123 seats): 2015 election (the 2020 election was just after
  // our reset point in late February). SPD-Grüne coalition under Scholz.
  { state: "HH", officeType: "landtag", party: "de_spd", seatsHeld: 59 },
  { state: "HH", officeType: "landtag", party: "de_cdu", seatsHeld: 20 },
  { state: "HH", officeType: "landtag", party: "de_greens", seatsHeld: 15 },
  { state: "HH", officeType: "landtag", party: "de_linke", seatsHeld: 11 },
  { state: "HH", officeType: "landtag", party: "de_afd", seatsHeld: 9 },
  { state: "HH", officeType: "landtag", party: "de_fdp", seatsHeld: 9 },

  // Bremen (87 seats): May 2019 election. SPD-Grüne-Linke "red-red-green"
  // coalition — first such at the Land level — under Bovenschulte (later).
  { state: "BRE", officeType: "landtag", party: "de_greens", seatsHeld: 24 },
  { state: "BRE", officeType: "landtag", party: "de_spd", seatsHeld: 23 },
  { state: "BRE", officeType: "landtag", party: "de_cdu", seatsHeld: 23 },
  { state: "BRE", officeType: "landtag", party: "de_linke", seatsHeld: 10 },
  { state: "BRE", officeType: "landtag", party: "de_fdp", seatsHeld: 5 },
  { state: "BRE", officeType: "landtag", party: "de_afd", seatsHeld: 1 },
  { state: "BRE", officeType: "landtag", party: "de_independent", seatsHeld: 1 },

  // Berlin (159 seats): 2016 election. SPD-Linke-Grüne "red-red-green"
  // coalition under Müller (later Giffey).
  { state: "BE", officeType: "landtag", party: "de_spd", seatsHeld: 38 },
  { state: "BE", officeType: "landtag", party: "de_cdu", seatsHeld: 31 },
  { state: "BE", officeType: "landtag", party: "de_linke", seatsHeld: 27 },
  { state: "BE", officeType: "landtag", party: "de_greens", seatsHeld: 27 },
  { state: "BE", officeType: "landtag", party: "de_afd", seatsHeld: 24 },
  { state: "BE", officeType: "landtag", party: "de_fdp", seatsHeld: 12 },

  // Brandenburg (88 seats): September 2019 election. SPD-CDU-Grüne "Kenya"
  // coalition under Woidke after SPD lost to AfD by 1pt.
  { state: "BB", officeType: "landtag", party: "de_spd", seatsHeld: 25 },
  { state: "BB", officeType: "landtag", party: "de_afd", seatsHeld: 23 },
  { state: "BB", officeType: "landtag", party: "de_cdu", seatsHeld: 15 },
  { state: "BB", officeType: "landtag", party: "de_linke", seatsHeld: 10 },
  { state: "BB", officeType: "landtag", party: "de_greens", seatsHeld: 10 },
  { state: "BB", officeType: "landtag", party: "de_independent", seatsHeld: 5 },

  // Mecklenburg-Vorpommern (79 seats): 2016 election. SPD-CDU coalition
  // under Schwesig. Grüne fell below 5% threshold and won 0 seats.
  { state: "MV", officeType: "landtag", party: "de_spd", seatsHeld: 26 },
  { state: "MV", officeType: "landtag", party: "de_afd", seatsHeld: 18 },
  { state: "MV", officeType: "landtag", party: "de_cdu", seatsHeld: 18 },
  { state: "MV", officeType: "landtag", party: "de_linke", seatsHeld: 11 },
  { state: "MV", officeType: "landtag", party: "de_independent", seatsHeld: 6 },

  // Sachsen (120 seats): September 2019 election. CDU-Grüne-SPD "Kenya"
  // coalition under Kretschmer after AfD's near-second-place finish.
  { state: "SN", officeType: "landtag", party: "de_cdu", seatsHeld: 45 },
  { state: "SN", officeType: "landtag", party: "de_afd", seatsHeld: 38 },
  { state: "SN", officeType: "landtag", party: "de_linke", seatsHeld: 14 },
  { state: "SN", officeType: "landtag", party: "de_greens", seatsHeld: 12 },
  { state: "SN", officeType: "landtag", party: "de_spd", seatsHeld: 10 },
  { state: "SN", officeType: "landtag", party: "de_independent", seatsHeld: 1 },

  // Sachsen-Anhalt (97 seats): 2016 election. CDU-SPD-Grüne "Kenya"
  // coalition under Haseloff — first such, prefiguring Sachsen 2019.
  { state: "ST", officeType: "landtag", party: "de_cdu", seatsHeld: 30 },
  { state: "ST", officeType: "landtag", party: "de_afd", seatsHeld: 25 },
  { state: "ST", officeType: "landtag", party: "de_linke", seatsHeld: 16 },
  { state: "ST", officeType: "landtag", party: "de_spd", seatsHeld: 11 },
  { state: "ST", officeType: "landtag", party: "de_greens", seatsHeld: 5 },
  { state: "ST", officeType: "landtag", party: "de_independent", seatsHeld: 10 },

  // Thüringen (88 seats): October 2019 election. Linke plurality under
  // Ramelow — only Land where Linke leads the government.
  { state: "TH", officeType: "landtag", party: "de_linke", seatsHeld: 28 },
  { state: "TH", officeType: "landtag", party: "de_afd", seatsHeld: 22 },
  { state: "TH", officeType: "landtag", party: "de_cdu", seatsHeld: 21 },
  { state: "TH", officeType: "landtag", party: "de_spd", seatsHeld: 8 },
  { state: "TH", officeType: "landtag", party: "de_greens", seatsHeld: 5 },
  { state: "TH", officeType: "landtag", party: "de_fdp", seatsHeld: 4 },
];

export const DE_LANDTAG_1990: HistoricalSeat[] = [
  // Baden-Württemberg (154 seats): 1988 election. CDU plurality under
  // Späth, SPD opposition, Grüne and FDP minor partners.
  { state: "BW", officeType: "landtag", party: "de_cdu", seatsHeld: 78 },
  { state: "BW", officeType: "landtag", party: "de_spd", seatsHeld: 53 },
  { state: "BW", officeType: "landtag", party: "de_greens", seatsHeld: 13 },
  { state: "BW", officeType: "landtag", party: "de_fdp", seatsHeld: 10 },

  // Bayern (203 seats): 1986 election. CSU absolute majority under Strauß
  // (then Streibl in 1991); SPD second, Grüne minor.
  { state: "BY", officeType: "landtag", party: "de_csu", seatsHeld: 128 },
  { state: "BY", officeType: "landtag", party: "de_spd", seatsHeld: 61 },
  { state: "BY", officeType: "landtag", party: "de_greens", seatsHeld: 14 },

  // Nordrhein-Westfalen (195 seats): 1990 election. SPD majority under Rau.
  { state: "NW", officeType: "landtag", party: "de_spd", seatsHeld: 119 },
  { state: "NW", officeType: "landtag", party: "de_cdu", seatsHeld: 65 },
  { state: "NW", officeType: "landtag", party: "de_fdp", seatsHeld: 11 },

  // Hessen (137 seats): January 1991 election. SPD-Grüne red-green
  // coalition (Eichel cabinet) replaces Wallmann CDU.
  { state: "HE", officeType: "landtag", party: "de_spd", seatsHeld: 58 },
  { state: "HE", officeType: "landtag", party: "de_cdu", seatsHeld: 58 },
  { state: "HE", officeType: "landtag", party: "de_greens", seatsHeld: 13 },
  { state: "HE", officeType: "landtag", party: "de_fdp", seatsHeld: 8 },

  // Rheinland-Pfalz (101 seats): 1987 Landtag. CDU plurality under Wagner,
  // SPD opposition, FDP and Grüne minor. The April 1991 election (SPD
  // pickup under Scharping) hadn't happened at our 1991 reset point.
  { state: "RP", officeType: "landtag", party: "de_cdu", seatsHeld: 48 },
  { state: "RP", officeType: "landtag", party: "de_spd", seatsHeld: 40 },
  { state: "RP", officeType: "landtag", party: "de_fdp", seatsHeld: 7 },
  { state: "RP", officeType: "landtag", party: "de_greens", seatsHeld: 5 },
  { state: "RP", officeType: "landtag", party: "de_independent", seatsHeld: 1 },

  // Saarland (51 seats): January 1990 election. SPD absolute majority
  // under Lafontaine; FDP small; Grüne missed threshold.
  { state: "SL", officeType: "landtag", party: "de_spd", seatsHeld: 30 },
  { state: "SL", officeType: "landtag", party: "de_cdu", seatsHeld: 18 },
  { state: "SL", officeType: "landtag", party: "de_fdp", seatsHeld: 3 },

  // Niedersachsen (146 seats): May 1990 election. SPD-Grüne coalition
  // ousts the long-running Albrecht CDU government — Schröder takes over.
  { state: "NI", officeType: "landtag", party: "de_spd", seatsHeld: 71 },
  { state: "NI", officeType: "landtag", party: "de_cdu", seatsHeld: 67 },
  { state: "NI", officeType: "landtag", party: "de_greens", seatsHeld: 8 },

  // Schleswig-Holstein (73 seats): 1988 election (post-Barschel affair).
  // SPD absolute majority under Engholm. SSW (Danish minority) holds
  // 1 seat — falls back to `de_independent` since not a default party.
  { state: "SH", officeType: "landtag", party: "de_spd", seatsHeld: 45 },
  { state: "SH", officeType: "landtag", party: "de_cdu", seatsHeld: 27 },
  { state: "SH", officeType: "landtag", party: "de_independent", seatsHeld: 1 },

  // Hamburg (123 seats): June 1991 Bürgerschaft election (just within Q2,
  // included for parity with the other early-1991 dynamics). STATT Partei
  // (anti-establishment local) won 3 seats — folded into `de_independent`.
  { state: "HH", officeType: "landtag", party: "de_spd", seatsHeld: 61 },
  { state: "HH", officeType: "landtag", party: "de_cdu", seatsHeld: 44 },
  { state: "HH", officeType: "landtag", party: "de_greens", seatsHeld: 8 },
  { state: "HH", officeType: "landtag", party: "de_fdp", seatsHeld: 7 },
  { state: "HH", officeType: "landtag", party: "de_independent", seatsHeld: 3 },

  // Bremen (87 seats): September 1991 Bürgerschaft. SPD plurality under
  // Wedemeier. Federal SPD strength concentrated here.
  { state: "BRE", officeType: "landtag", party: "de_spd", seatsHeld: 41 },
  { state: "BRE", officeType: "landtag", party: "de_cdu", seatsHeld: 32 },
  { state: "BRE", officeType: "landtag", party: "de_greens", seatsHeld: 11 },
  { state: "BRE", officeType: "landtag", party: "de_fdp", seatsHeld: 3 },

  // Berlin (159 seats): December 1990 reunified Abgeordnetenhaus election.
  // First all-Berlin election since 1946; CDU plurality under Diepgen,
  // grand coalition with SPD. PDS enters with East Berlin base.
  { state: "BE", officeType: "landtag", party: "de_cdu", seatsHeld: 70 },
  { state: "BE", officeType: "landtag", party: "de_spd", seatsHeld: 53 },
  { state: "BE", officeType: "landtag", party: "de_pds", seatsHeld: 16 },
  { state: "BE", officeType: "landtag", party: "de_fdp", seatsHeld: 12 },
  { state: "BE", officeType: "landtag", party: "de_greens", seatsHeld: 8 },

  // Brandenburg (88 seats): October 1990 first free Landtag election.
  // SPD-FDP-Grüne "traffic light" coalition under Stolpe.
  { state: "BB", officeType: "landtag", party: "de_spd", seatsHeld: 36 },
  { state: "BB", officeType: "landtag", party: "de_cdu", seatsHeld: 27 },
  { state: "BB", officeType: "landtag", party: "de_pds", seatsHeld: 13 },
  { state: "BB", officeType: "landtag", party: "de_fdp", seatsHeld: 6 },
  { state: "BB", officeType: "landtag", party: "de_greens", seatsHeld: 6 },

  // Mecklenburg-Vorpommern (79 seats): October 1990 first free Landtag
  // election. CDU plurality under Gomolka.
  { state: "MV", officeType: "landtag", party: "de_cdu", seatsHeld: 29 },
  { state: "MV", officeType: "landtag", party: "de_spd", seatsHeld: 21 },
  { state: "MV", officeType: "landtag", party: "de_greens", seatsHeld: 13 },
  { state: "MV", officeType: "landtag", party: "de_pds", seatsHeld: 12 },
  { state: "MV", officeType: "landtag", party: "de_fdp", seatsHeld: 4 },

  // Sachsen (120 seats): October 1990 first free Landtag election.
  // CDU absolute majority under Biedenkopf — strongest East German CDU
  // result.
  { state: "SN", officeType: "landtag", party: "de_cdu", seatsHeld: 69 },
  { state: "SN", officeType: "landtag", party: "de_spd", seatsHeld: 24 },
  { state: "SN", officeType: "landtag", party: "de_pds", seatsHeld: 13 },
  { state: "SN", officeType: "landtag", party: "de_fdp", seatsHeld: 8 },
  { state: "SN", officeType: "landtag", party: "de_greens", seatsHeld: 6 },

  // Sachsen-Anhalt (97 seats): October 1990 first free Landtag election.
  // CDU plurality under Münch, CDU-FDP coalition.
  { state: "ST", officeType: "landtag", party: "de_cdu", seatsHeld: 44 },
  { state: "ST", officeType: "landtag", party: "de_spd", seatsHeld: 25 },
  { state: "ST", officeType: "landtag", party: "de_fdp", seatsHeld: 13 },
  { state: "ST", officeType: "landtag", party: "de_pds", seatsHeld: 11 },
  { state: "ST", officeType: "landtag", party: "de_greens", seatsHeld: 4 },

  // Thüringen (88 seats): October 1990 first free Landtag election.
  // CDU plurality under Duchač, CDU-FDP coalition.
  { state: "TH", officeType: "landtag", party: "de_cdu", seatsHeld: 43 },
  { state: "TH", officeType: "landtag", party: "de_spd", seatsHeld: 21 },
  { state: "TH", officeType: "landtag", party: "de_fdp", seatsHeld: 9 },
  { state: "TH", officeType: "landtag", party: "de_pds", seatsHeld: 9 },
  { state: "TH", officeType: "landtag", party: "de_greens", seatsHeld: 6 },
];

// ─── China: 13th NPC (2018-2023) + Regional Governors ────────────────────
// NPC: 2980 seats. CPC dominates (~95%), minor parties hold token seats.
// Each entry = ONE NPP holding all that party's seats in that region.

export const CN_NPC_2020: HistoricalSeat[] = [
  // Dongbei (Northeast): 238 seats — CPC 225, CDL 8, CNDCA 5
  { state: "DB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 225 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 8 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 5 },

  // Huabei (North): 323 seats — CPC 306, CDL 11, CNDCA 6
  { state: "HB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 306 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 11 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 6 },

  // Huadong (East): 922 seats — CPC 874, CDL 32, CNDCA 16
  { state: "HD", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 874 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 32 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 16 },

  // Huazhong (Central): 395 seats — CPC 374, CDL 14, CNDCA 7
  { state: "HZ", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 374 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 14 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 7 },

  // Huanan (South): 316 seats — CPC 299, CDL 12, CNDCA 5
  { state: "HN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 299 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 12 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 5 },

  // Xinan (Southwest): 466 seats — CPC 441, CDL 17, CNDCA 8
  { state: "XN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 441 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 17 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 8 },

  // Xibei (Northwest): 320 seats — CPC 303, CDL 11, CNDCA 6
  { state: "XB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 303 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 11 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 6 },
];

// CPC-affiliated regional governors (all 7 regions)
export const CN_GOVERNORS_2020: HistoricalSeat[] = [
  { state: "DB", officeType: "governor", party: "cn_ccp" },
  { state: "HB", officeType: "governor", party: "cn_ccp" },
  { state: "HD", officeType: "governor", party: "cn_ccp" },
  { state: "HZ", officeType: "governor", party: "cn_ccp" },
  { state: "HN", officeType: "governor", party: "cn_ccp" },
  { state: "XN", officeType: "governor", party: "cn_ccp" },
  { state: "XB", officeType: "governor", party: "cn_ccp" },
];

// ─── China: 7th NPC (1988–1993) + Regional Governors ────────────────────────
// ~1991 session. CPC held ~97% of NPC seats; CDL and CNDCA held token seats.
// Seat counts match the game's 2,980-seat NPC model.

export const CN_NPC_1991: HistoricalSeat[] = [
  // Dongbei (Northeast): 238 seats — CPC 231, CDL 5, CNDCA 2
  { state: "DB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 231 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 5 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 2 },

  // Huabei (North): 323 seats — CPC 313, CDL 7, CNDCA 3
  { state: "HB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 313 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 7 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 3 },

  // Huadong (East): 922 seats — CPC 895, CDL 18, CNDCA 9
  { state: "HD", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 895 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 18 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 9 },

  // Huazhong (Central): 395 seats — CPC 383, CDL 8, CNDCA 4
  { state: "HZ", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 383 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 8 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 4 },

  // Huanan (South): 316 seats — CPC 307, CDL 6, CNDCA 3
  { state: "HN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 307 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 6 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 3 },

  // Xinan (Southwest): 466 seats — CPC 452, CDL 9, CNDCA 5
  { state: "XN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 452 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 9 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 5 },

  // Xibei (Northwest): 320 seats — CPC 311, CDL 6, CNDCA 3
  { state: "XB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 311 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 6 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 3 },
];

// ─── China: Provincial People's Congress (sub-national legislature) ───────
// Approximate per-region seat totals scaled from real-world provincial PPC
// sizes (Sichuan/Henan/Shandong ~860-890 delegates each; per-macro-region
// sums scaled down for game playability). Party split mirrors NPC's ~94.5%
// CCP / 3.5% CDL / 2% CNDCA pattern. Each entry is one row = one NPP
// before splitCNNPCDelegates redistributes CCP rows across 7 NPPs.

export const CN_PEOPLES_CONGRESS_2020: HistoricalSeat[] = [
  // Dongbei (Northeast): 321 — CPC 303, CDL 11, CNDCA 7
  { state: "DB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 303 },
  { state: "DB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 11 },
  { state: "DB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 7 },

  // Huabei (North): 433 — CPC 409, CDL 15, CNDCA 9
  { state: "HB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 409 },
  { state: "HB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 15 },
  { state: "HB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 9 },

  // Huadong (East): 1240 — CPC 1172, CDL 43, CNDCA 25
  { state: "HD", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 1172 },
  { state: "HD", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 43 },
  { state: "HD", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 25 },

  // Huazhong (Central): 533 — CPC 504, CDL 19, CNDCA 10
  { state: "HZ", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 504 },
  { state: "HZ", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 19 },
  { state: "HZ", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 10 },

  // Huanan (South): 425 — CPC 402, CDL 15, CNDCA 8
  { state: "HN", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 402 },
  { state: "HN", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 15 },
  { state: "HN", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 8 },

  // Xinan (Southwest): 625 — CPC 591, CDL 22, CNDCA 12
  { state: "XN", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 591 },
  { state: "XN", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 22 },
  { state: "XN", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 12 },

  // Xibei (Northwest): 423 — CPC 400, CDL 14, CNDCA 9
  { state: "XB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 400 },
  { state: "XB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 14 },
  { state: "XB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 9 },
];

// 1991-era Provincial People's Congresses — higher CCP share (~96.7%),
// minor parties markedly smaller, matching the 7th NPC era.
export const CN_PEOPLES_CONGRESS_1991: HistoricalSeat[] = [
  // Dongbei (Northeast): 321 — CPC 310, CDL 7, CNDCA 4
  { state: "DB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 310 },
  { state: "DB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 7 },
  { state: "DB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 4 },

  // Huabei (North): 433 — CPC 419, CDL 9, CNDCA 5
  { state: "HB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 419 },
  { state: "HB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 9 },
  { state: "HB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 5 },

  // Huadong (East): 1240 — CPC 1200, CDL 25, CNDCA 15
  { state: "HD", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 1200 },
  { state: "HD", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 25 },
  { state: "HD", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 15 },

  // Huazhong (Central): 533 — CPC 515, CDL 12, CNDCA 6
  { state: "HZ", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 515 },
  { state: "HZ", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 12 },
  { state: "HZ", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 6 },

  // Huanan (South): 425 — CPC 410, CDL 10, CNDCA 5
  { state: "HN", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 410 },
  { state: "HN", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 10 },
  { state: "HN", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 5 },

  // Xinan (Southwest): 625 — CPC 605, CDL 14, CNDCA 6
  { state: "XN", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 605 },
  { state: "XN", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 14 },
  { state: "XN", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 6 },

  // Xibei (Northwest): 423 — CPC 408, CDL 10, CNDCA 5
  { state: "XB", officeType: "peoplesCongress", party: "cn_ccp", seatsHeld: 408 },
  { state: "XB", officeType: "peoplesCongress", party: "cn_cdl", seatsHeld: 10 },
  { state: "XB", officeType: "peoplesCongress", party: "cn_cndca", seatsHeld: 5 },
];

// CN NPC delegate + Provincial People's Congress split — see splitCNNPCDelegates below
export const CN_CCP_NPPS_PER_REGION = 7;

/** Office types in CN that get the 7-NPPs-per-region CCP split. */
const CN_SPLITTABLE_OFFICE_TYPES = new Set(["npcDelegate", "peoplesCongress"]);

/**
 * Split CCP delegate rows into `CN_CCP_NPPS_PER_REGION` (7) NPPs per
 * region, distributing the historical seat count evenly. Applies to
 * both `npcDelegate` (national) and `peoplesCongress` (sub-national
 * Provincial People's Congress) rows. CDL / CNDCA rows are passed
 * through unchanged — one NPP per region per minor party, holding all
 * of that party's seats in the region.
 *
 * Rationale (2026-05-23): the raw historical data has one row = one NPP
 * holding all seats for a party in a region. For CCP the HD (Huadong) NPC row
 * alone is one NPP carrying 874 seats — a single character can't
 * realistically represent the whole regional caucus. 7 CCP NPPs per
 * region gives enough density for caucus dynamics (retirements,
 * scandals, factional play) without spawning thousands of identical
 * characters at seed.
 *
 * Total seatsHeld per (region, party) is preserved exactly. Rows with
 * `seatsHeld` undefined or zero are passed through unchanged (the splitter
 * only fires when there are seats to distribute).
 */
export function splitCNNPCDelegates(rows: HistoricalSeat[]): HistoricalSeat[] {
  const out: HistoricalSeat[] = [];
  for (const row of rows) {
    const isCcpDelegate = row.party === "cn_ccp" && CN_SPLITTABLE_OFFICE_TYPES.has(row.officeType);
    if (!isCcpDelegate) {
      out.push(row);
      continue;
    }
    const total = row.seatsHeld ?? 0;
    if (total <= 0) {
      out.push(row);
      continue;
    }
    const n = CN_CCP_NPPS_PER_REGION;
    const base = Math.floor(total / n);
    const remainder = total % n;
    for (let i = 0; i < n; i++) {
      const held = base + (i < remainder ? 1 : 0);
      if (held <= 0) continue;
      out.push({ ...row, seatsHeld: held });
    }
  }
  return out;
}

// CPC-affiliated regional governors (all 7 regions, same as 2020)
export const CN_GOVERNORS_1991: HistoricalSeat[] = [
  { state: "DB", officeType: "governor", party: "cn_ccp" },
  { state: "HB", officeType: "governor", party: "cn_ccp" },
  { state: "HD", officeType: "governor", party: "cn_ccp" },
  { state: "HZ", officeType: "governor", party: "cn_ccp" },
  { state: "HN", officeType: "governor", party: "cn_ccp" },
  { state: "XN", officeType: "governor", party: "cn_ccp" },
  { state: "XB", officeType: "governor", party: "cn_ccp" },
];

// ─── Brazil: 49th Congress (post-October 1990 elections) ─────────────────────
// Chamber of Deputies: 503 seats (game models 513; historical 1990 total was 503).
// Senate: 81 seats (3 per state, mix of 1986 holdovers and 1990 elected).
// Party slugs use historical names; many parties later merged or dissolved.

export const BR_CHAMBER_1991: HistoricalSeat[] = [
  // Sudeste (SE — SP, RJ, MG, ES): ~196 seats
  { state: "SUDESTE", officeType: "chamber", party: "br_pmdb", seatsHeld: 41 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pfl", seatsHeld: 27 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pdt", seatsHeld: 21 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pds", seatsHeld: 16 },
  { state: "SUDESTE", officeType: "chamber", party: "br_ptb", seatsHeld: 15 },
  { state: "SUDESTE", officeType: "chamber", party: "br_prn", seatsHeld: 16 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pt", seatsHeld: 20 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pl", seatsHeld: 7 },
  { state: "SUDESTE", officeType: "chamber", party: "br_psb", seatsHeld: 5 },
  { state: "SUDESTE", officeType: "chamber", party: "br_pcdob", seatsHeld: 2 },
  { state: "SUDESTE", officeType: "chamber", party: "br_psd", seatsHeld: 4 },
  { state: "SUDESTE", officeType: "chamber", party: "br_other", seatsHeld: 22 },

  // Nordeste (NE — BA, PE, CE, MA, PB, RN, AL, SE, PI): ~141 seats
  { state: "NORDESTE", officeType: "chamber", party: "br_pmdb", seatsHeld: 28 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pfl", seatsHeld: 35 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pdt", seatsHeld: 11 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pds", seatsHeld: 12 },
  { state: "NORDESTE", officeType: "chamber", party: "br_ptb", seatsHeld: 11 },
  { state: "NORDESTE", officeType: "chamber", party: "br_prn", seatsHeld: 11 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pt", seatsHeld: 5 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pl", seatsHeld: 4 },
  { state: "NORDESTE", officeType: "chamber", party: "br_psb", seatsHeld: 3 },
  { state: "NORDESTE", officeType: "chamber", party: "br_pcdob", seatsHeld: 2 },
  { state: "NORDESTE", officeType: "chamber", party: "br_psd", seatsHeld: 5 },
  { state: "NORDESTE", officeType: "chamber", party: "br_other", seatsHeld: 14 },

  // Sul (S — RS, PR, SC): ~86 seats
  { state: "SUL", officeType: "chamber", party: "br_pmdb", seatsHeld: 21 },
  { state: "SUL", officeType: "chamber", party: "br_pfl", seatsHeld: 10 },
  { state: "SUL", officeType: "chamber", party: "br_pdt", seatsHeld: 9 },
  { state: "SUL", officeType: "chamber", party: "br_pds", seatsHeld: 10 },
  { state: "SUL", officeType: "chamber", party: "br_ptb", seatsHeld: 7 },
  { state: "SUL", officeType: "chamber", party: "br_prn", seatsHeld: 8 },
  { state: "SUL", officeType: "chamber", party: "br_pt", seatsHeld: 8 },
  { state: "SUL", officeType: "chamber", party: "br_pl", seatsHeld: 3 },
  { state: "SUL", officeType: "chamber", party: "br_psb", seatsHeld: 2 },
  { state: "SUL", officeType: "chamber", party: "br_pcdob", seatsHeld: 1 },
  { state: "SUL", officeType: "chamber", party: "br_psd", seatsHeld: 3 },
  { state: "SUL", officeType: "chamber", party: "br_other", seatsHeld: 4 },

  // Centro-Oeste (CW — GO, MT, MS, DF): ~35 seats
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pmdb", seatsHeld: 10 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pfl", seatsHeld: 5 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pdt", seatsHeld: 3 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pds", seatsHeld: 2 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_ptb", seatsHeld: 3 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_prn", seatsHeld: 3 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pt", seatsHeld: 1 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_pl", seatsHeld: 1 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_psb", seatsHeld: 1 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_psd", seatsHeld: 1 },
  { state: "CENTRO_OESTE", officeType: "chamber", party: "br_other", seatsHeld: 5 },

  // Norte (N — PA, AM, AC, RO, RR, AP, TO): ~45 seats
  { state: "NORTE", officeType: "chamber", party: "br_pmdb", seatsHeld: 8 },
  { state: "NORTE", officeType: "chamber", party: "br_pfl", seatsHeld: 5 },
  { state: "NORTE", officeType: "chamber", party: "br_pdt", seatsHeld: 2 },
  { state: "NORTE", officeType: "chamber", party: "br_pds", seatsHeld: 2 },
  { state: "NORTE", officeType: "chamber", party: "br_ptb", seatsHeld: 2 },
  { state: "NORTE", officeType: "chamber", party: "br_prn", seatsHeld: 2 },
  { state: "NORTE", officeType: "chamber", party: "br_pt", seatsHeld: 1 },
  { state: "NORTE", officeType: "chamber", party: "br_pl", seatsHeld: 1 },
  { state: "NORTE", officeType: "chamber", party: "br_psd", seatsHeld: 1 },
  { state: "NORTE", officeType: "chamber", party: "br_other", seatsHeld: 21 },
];

export const BR_SENATE_1991: HistoricalSeat[] = [
  // Sudeste (12 senators — 4 states × 3)
  { state: "SUDESTE", officeType: "senate", party: "br_pmdb", seatsHeld: 4 },
  { state: "SUDESTE", officeType: "senate", party: "br_pfl", seatsHeld: 2 },
  { state: "SUDESTE", officeType: "senate", party: "br_pdt", seatsHeld: 2 },
  { state: "SUDESTE", officeType: "senate", party: "br_pt", seatsHeld: 1 },
  { state: "SUDESTE", officeType: "senate", party: "br_prn", seatsHeld: 1 },
  { state: "SUDESTE", officeType: "senate", party: "br_other", seatsHeld: 2 },

  // Nordeste (27 senators — 9 states × 3)
  { state: "NORDESTE", officeType: "senate", party: "br_pmdb", seatsHeld: 6 },
  { state: "NORDESTE", officeType: "senate", party: "br_pfl", seatsHeld: 8 },
  { state: "NORDESTE", officeType: "senate", party: "br_pds", seatsHeld: 5 },
  { state: "NORDESTE", officeType: "senate", party: "br_ptb", seatsHeld: 3 },
  { state: "NORDESTE", officeType: "senate", party: "br_pdt", seatsHeld: 1 },
  { state: "NORDESTE", officeType: "senate", party: "br_prn", seatsHeld: 2 },
  { state: "NORDESTE", officeType: "senate", party: "br_other", seatsHeld: 2 },

  // Sul (9 senators — 3 states × 3)
  { state: "SUL", officeType: "senate", party: "br_pmdb", seatsHeld: 4 },
  { state: "SUL", officeType: "senate", party: "br_pds", seatsHeld: 2 },
  { state: "SUL", officeType: "senate", party: "br_pdt", seatsHeld: 2 },
  { state: "SUL", officeType: "senate", party: "br_ptb", seatsHeld: 1 },

  // Centro-Oeste (12 senators — 4 states × 3)
  { state: "CENTRO_OESTE", officeType: "senate", party: "br_pmdb", seatsHeld: 5 },
  { state: "CENTRO_OESTE", officeType: "senate", party: "br_pfl", seatsHeld: 3 },
  { state: "CENTRO_OESTE", officeType: "senate", party: "br_pds", seatsHeld: 2 },
  { state: "CENTRO_OESTE", officeType: "senate", party: "br_prn", seatsHeld: 1 },
  { state: "CENTRO_OESTE", officeType: "senate", party: "br_other", seatsHeld: 1 },

  // Norte (21 senators — 7 states × 3)
  { state: "NORTE", officeType: "senate", party: "br_pmdb", seatsHeld: 7 },
  { state: "NORTE", officeType: "senate", party: "br_pfl", seatsHeld: 3 },
  { state: "NORTE", officeType: "senate", party: "br_pdt", seatsHeld: 2 },
  { state: "NORTE", officeType: "senate", party: "br_ptb", seatsHeld: 1 },
  { state: "NORTE", officeType: "senate", party: "br_other", seatsHeld: 8 },
];

// ─── Ireland: 27th Dáil (post-June 1989 general election) ────────────────────
// 160 seats (game model; historical 1989 Dáil had 166 seats, scaled proportionally).
// FF formed government with PD confidence-and-supply. Sinn Féin held no Dáil seats.

export const IE_DAIL_1991: HistoricalSeat[] = [
  // Dublin (DUB): ~64 seats
  { state: "DUB", officeType: "dail", party: "ie_ff", seatsHeld: 28 },
  { state: "DUB", officeType: "dail", party: "ie_fg", seatsHeld: 21 },
  { state: "DUB", officeType: "dail", party: "ie_labour", seatsHeld: 7 },
  { state: "DUB", officeType: "dail", party: "ie_wp", seatsHeld: 4 },
  { state: "DUB", officeType: "dail", party: "ie_pd", seatsHeld: 2 },
  { state: "DUB", officeType: "dail", party: "ie_ind", seatsHeld: 2 },

  // Kildare (KIL): ~13 seats
  { state: "KIL", officeType: "dail", party: "ie_ff", seatsHeld: 6 },
  { state: "KIL", officeType: "dail", party: "ie_fg", seatsHeld: 5 },
  { state: "KIL", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "KIL", officeType: "dail", party: "ie_pd", seatsHeld: 1 },

  // Midlands (MID): ~10 seats
  { state: "MID", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "MID", officeType: "dail", party: "ie_fg", seatsHeld: 4 },
  { state: "MID", officeType: "dail", party: "ie_labour", seatsHeld: 1 },

  // Wexford (WEX): ~14 seats
  { state: "WEX", officeType: "dail", party: "ie_ff", seatsHeld: 7 },
  { state: "WEX", officeType: "dail", party: "ie_fg", seatsHeld: 5 },
  { state: "WEX", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "WEX", officeType: "dail", party: "ie_pd", seatsHeld: 1 },

  // Limerick (LIM): ~11 seats
  { state: "LIM", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "LIM", officeType: "dail", party: "ie_fg", seatsHeld: 4 },
  { state: "LIM", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "LIM", officeType: "dail", party: "ie_pd", seatsHeld: 1 },

  // Cork (COR): ~18 seats
  { state: "COR", officeType: "dail", party: "ie_ff", seatsHeld: 9 },
  { state: "COR", officeType: "dail", party: "ie_fg", seatsHeld: 7 },
  { state: "COR", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "COR", officeType: "dail", party: "ie_pd", seatsHeld: 1 },

  // Galway (GAL): ~14 seats
  { state: "GAL", officeType: "dail", party: "ie_ff", seatsHeld: 7 },
  { state: "GAL", officeType: "dail", party: "ie_fg", seatsHeld: 5 },
  { state: "GAL", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "GAL", officeType: "dail", party: "ie_ind", seatsHeld: 1 },

  // Donegal (DON): ~16 seats
  { state: "DON", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "DON", officeType: "dail", party: "ie_fg", seatsHeld: 2 },
  { state: "DON", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "DON", officeType: "dail", party: "ie_wp", seatsHeld: 3 },
  { state: "DON", officeType: "dail", party: "ie_ind", seatsHeld: 5 },
];

// IE 33rd Dáil — 2020 General Election distribution scaled to the game's
// 160-seat model. National party totals: FF 38, FG 35, SF 37, Lab 6, Green 12,
// Ind (incl. SocDems, PBP-Solidarity, Aontú, others) 32. Per-region seats
// match the canonical `ieRegions[*].houseDistricts` (49 / 21 / 11 / 13 / 15 /
// 20 / 15 / 16). Used by the 2019-default reset preset; this is the
// "modern" counterpart to IE_DAIL_1991 (28th Dáil, 1989-1992).
export const IE_DAIL_2020: HistoricalSeat[] = [
  // Dublin (DUB): 49 seats — SF, Green, and Independent share is highest here.
  { state: "DUB", officeType: "dail", party: "ie_sf", seatsHeld: 14 },
  { state: "DUB", officeType: "dail", party: "ie_ff", seatsHeld: 9 },
  { state: "DUB", officeType: "dail", party: "ie_fg", seatsHeld: 10 },
  { state: "DUB", officeType: "dail", party: "ie_green", seatsHeld: 4 },
  { state: "DUB", officeType: "dail", party: "ie_labour", seatsHeld: 3 },
  { state: "DUB", officeType: "dail", party: "ie_ind", seatsHeld: 9 },

  // Kildare (KIL): 21 seats — three-way FF/FG/SF balance.
  { state: "KIL", officeType: "dail", party: "ie_sf", seatsHeld: 4 },
  { state: "KIL", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "KIL", officeType: "dail", party: "ie_fg", seatsHeld: 5 },
  { state: "KIL", officeType: "dail", party: "ie_green", seatsHeld: 2 },
  { state: "KIL", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "KIL", officeType: "dail", party: "ie_ind", seatsHeld: 4 },

  // Midlands (MID): 11 seats — rural FF/FG dominance, fewer Greens.
  { state: "MID", officeType: "dail", party: "ie_sf", seatsHeld: 2 },
  { state: "MID", officeType: "dail", party: "ie_ff", seatsHeld: 3 },
  { state: "MID", officeType: "dail", party: "ie_fg", seatsHeld: 3 },
  { state: "MID", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "MID", officeType: "dail", party: "ie_ind", seatsHeld: 2 },

  // Wexford (WEX): 13 seats.
  { state: "WEX", officeType: "dail", party: "ie_sf", seatsHeld: 3 },
  { state: "WEX", officeType: "dail", party: "ie_ff", seatsHeld: 3 },
  { state: "WEX", officeType: "dail", party: "ie_fg", seatsHeld: 3 },
  { state: "WEX", officeType: "dail", party: "ie_green", seatsHeld: 1 },
  { state: "WEX", officeType: "dail", party: "ie_ind", seatsHeld: 3 },

  // Limerick (LIM): 15 seats.
  { state: "LIM", officeType: "dail", party: "ie_sf", seatsHeld: 4 },
  { state: "LIM", officeType: "dail", party: "ie_ff", seatsHeld: 4 },
  { state: "LIM", officeType: "dail", party: "ie_fg", seatsHeld: 3 },
  { state: "LIM", officeType: "dail", party: "ie_green", seatsHeld: 1 },
  { state: "LIM", officeType: "dail", party: "ie_ind", seatsHeld: 3 },

  // Cork (COR): 20 seats — Cork is an FG/FF stronghold; Kerry brings Independents.
  { state: "COR", officeType: "dail", party: "ie_sf", seatsHeld: 4 },
  { state: "COR", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "COR", officeType: "dail", party: "ie_fg", seatsHeld: 5 },
  { state: "COR", officeType: "dail", party: "ie_green", seatsHeld: 1 },
  { state: "COR", officeType: "dail", party: "ie_labour", seatsHeld: 1 },
  { state: "COR", officeType: "dail", party: "ie_ind", seatsHeld: 4 },

  // Galway (GAL): 15 seats — Galway/Mayo with strong FF/FG and Independents.
  { state: "GAL", officeType: "dail", party: "ie_sf", seatsHeld: 3 },
  { state: "GAL", officeType: "dail", party: "ie_ff", seatsHeld: 4 },
  { state: "GAL", officeType: "dail", party: "ie_fg", seatsHeld: 4 },
  { state: "GAL", officeType: "dail", party: "ie_green", seatsHeld: 1 },
  { state: "GAL", officeType: "dail", party: "ie_ind", seatsHeld: 3 },

  // Donegal (DON): 16 seats — SF stronghold (Donegal / Cavan-Monaghan).
  { state: "DON", officeType: "dail", party: "ie_sf", seatsHeld: 3 },
  { state: "DON", officeType: "dail", party: "ie_ff", seatsHeld: 5 },
  { state: "DON", officeType: "dail", party: "ie_fg", seatsHeld: 2 },
  { state: "DON", officeType: "dail", party: "ie_green", seatsHeld: 2 },
  { state: "DON", officeType: "dail", party: "ie_ind", seatsHeld: 4 },
];

// ─── IE Seanad: 26th Seanad (post-Mar 2020 election) ─────────────────────────
// 60 seats total. The real Seanad is elected via five vocational panels +
// university constituencies + 11 Taoiseach-nominated members; the game
// collapses that complexity into per-region multi-seat offices keyed off
// the `stateSenateSeats` count on each `ieRegions[*]` entry (DUB 9, KIL 8,
// MID 7, WEX 7, LIM 7, COR 8, GAL 7, DON 7 → 60).
//
// Composition post-Apr 2020 Seanad election under Taoiseach Martin (FF/FG/Green
// coalition): national totals FF 18, FG 18, SF 5, Green 4, Lab 3, Ind 12.
// Distributed roughly by regional party strength; the 11 Taoiseach-nominated
// independents fold into the Independent column. `ie_ind` matches the IE_DAIL_2020
// usage (collapses to the canonical "Independent" via INDEPENDENT_SLUGS).
export const IE_SEANAD_2020: HistoricalSeat[] = [
  // Dublin (DUB): 9 seats — Greens + SF concentrated here; coalition Taoiseach
  // nominees boost the Ind column.
  { state: "DUB", officeType: "seanad", party: "ie_ff", seatsHeld: 1 },
  { state: "DUB", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "DUB", officeType: "seanad", party: "ie_sf", seatsHeld: 1 },
  { state: "DUB", officeType: "seanad", party: "ie_green", seatsHeld: 2 },
  { state: "DUB", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "DUB", officeType: "seanad", party: "ie_ind", seatsHeld: 2 },

  // Kildare (KIL): 8 seats — commuter belt, FF/FG split with a Green.
  { state: "KIL", officeType: "seanad", party: "ie_ff", seatsHeld: 3 },
  { state: "KIL", officeType: "seanad", party: "ie_fg", seatsHeld: 3 },
  { state: "KIL", officeType: "seanad", party: "ie_green", seatsHeld: 1 },
  { state: "KIL", officeType: "seanad", party: "ie_ind", seatsHeld: 1 },

  // Midlands (MID): 7 seats — rural FF/FG dominance.
  { state: "MID", officeType: "seanad", party: "ie_ff", seatsHeld: 2 },
  { state: "MID", officeType: "seanad", party: "ie_fg", seatsHeld: 3 },
  { state: "MID", officeType: "seanad", party: "ie_ind", seatsHeld: 2 },

  // Wexford (WEX): 7 seats.
  { state: "WEX", officeType: "seanad", party: "ie_ff", seatsHeld: 2 },
  { state: "WEX", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "WEX", officeType: "seanad", party: "ie_sf", seatsHeld: 1 },
  { state: "WEX", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "WEX", officeType: "seanad", party: "ie_ind", seatsHeld: 1 },

  // Limerick (LIM): 7 seats — FF/FG rural balance.
  { state: "LIM", officeType: "seanad", party: "ie_ff", seatsHeld: 3 },
  { state: "LIM", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "LIM", officeType: "seanad", party: "ie_ind", seatsHeld: 2 },

  // Cork (COR): 8 seats — FF/FG stronghold, modest SF foothold.
  { state: "COR", officeType: "seanad", party: "ie_ff", seatsHeld: 3 },
  { state: "COR", officeType: "seanad", party: "ie_fg", seatsHeld: 3 },
  { state: "COR", officeType: "seanad", party: "ie_sf", seatsHeld: 1 },
  { state: "COR", officeType: "seanad", party: "ie_ind", seatsHeld: 1 },

  // Galway (GAL): 7 seats — FF/FG rural seats + one Green panel pick.
  { state: "GAL", officeType: "seanad", party: "ie_ff", seatsHeld: 2 },
  { state: "GAL", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "GAL", officeType: "seanad", party: "ie_green", seatsHeld: 1 },
  { state: "GAL", officeType: "seanad", party: "ie_ind", seatsHeld: 2 },

  // Donegal (DON): 7 seats — SF stronghold (border region).
  { state: "DON", officeType: "seanad", party: "ie_ff", seatsHeld: 2 },
  { state: "DON", officeType: "seanad", party: "ie_fg", seatsHeld: 1 },
  { state: "DON", officeType: "seanad", party: "ie_sf", seatsHeld: 2 },
  { state: "DON", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "DON", officeType: "seanad", party: "ie_ind", seatsHeld: 1 },
];

// ─── IE Seanad: 19th Seanad (post-June 1989 election) ────────────────────────
// 60 seats total. Composition post-1989 GE under Taoiseach Haughey (FF/PD
// coalition): national totals FF 30, FG 16, Lab 5, PD 6, WP 1, Ind 2.
// PD (`ie_pd`) and WP (`ie_wp`) are 1991-only defaults (validForPresets
// excludes them from 2019-default). Independents are minimal in the 1989
// Seanad — the elected panel + university members were largely partisan.
// Distribution mirrors regional party strength at the 1989 GE.
export const IE_SEANAD_1991: HistoricalSeat[] = [
  // Dublin (DUB): 9 seats — FF dominant; PD strongest here (urban liberal).
  { state: "DUB", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "DUB", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "DUB", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "DUB", officeType: "seanad", party: "ie_pd", seatsHeld: 1 },
  { state: "DUB", officeType: "seanad", party: "ie_wp", seatsHeld: 1 },

  // Kildare (KIL): 8 seats — commuter belt, FF/FG split with PD foothold.
  { state: "KIL", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "KIL", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "KIL", officeType: "seanad", party: "ie_pd", seatsHeld: 2 },

  // Midlands (MID): 7 seats — rural FF heartland.
  { state: "MID", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "MID", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "MID", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },

  // Wexford (WEX): 7 seats.
  { state: "WEX", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "WEX", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "WEX", officeType: "seanad", party: "ie_pd", seatsHeld: 1 },

  // Limerick (LIM): 7 seats — FF/FG split + Labour foothold.
  { state: "LIM", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "LIM", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "LIM", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },

  // Cork (COR): 8 seats — FF/FG stronghold.
  { state: "COR", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "COR", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "COR", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "COR", officeType: "seanad", party: "ie_pd", seatsHeld: 1 },

  // Galway (GAL): 7 seats — rural FF dominance.
  { state: "GAL", officeType: "seanad", party: "ie_ff", seatsHeld: 4 },
  { state: "GAL", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "GAL", officeType: "seanad", party: "ie_pd", seatsHeld: 1 },

  // Donegal (DON): 7 seats — border region; modest FF/FG with stronger
  // Independent presence reflecting the rural-Ulster pattern.
  { state: "DON", officeType: "seanad", party: "ie_ff", seatsHeld: 2 },
  { state: "DON", officeType: "seanad", party: "ie_fg", seatsHeld: 2 },
  { state: "DON", officeType: "seanad", party: "ie_labour", seatsHeld: 1 },
  { state: "DON", officeType: "seanad", party: "ie_independent", seatsHeld: 2 },
];

/**
 * Get all historical seats for a country as of February 2020
 * @deprecated Use getPresetSeats with a preset ID instead
 */
export function getHistoricalSeats(countryId: CountryId): HistoricalSeat[] {
  switch (countryId) {
    case "US":
      return [...US_HOUSE_2020, ...US_SENATE_2020, ...US_STATE_SENATE_2020, ...US_GOVERNORS_2020];
    case "UK":
      return [...UK_COMMONS_2020, ...UK_REGIONAL_COUNCIL_2020, ...UK_FIRST_MINISTERS_2020];
    case "JP":
      return [
        ...JP_SHUGIIN_2020,
        ...JP_SANGIIN_2020,
        ...JP_GOVERNORS_2020,
        ...JP_REGIONAL_COUNCIL_2020,
      ];
    case "DE":
      return [...DE_BUNDESTAG_2021, ...DE_MINISTERPRAESIDENTEN_2020];
    case "CN":
      return [
        ...splitCNNPCDelegates(CN_NPC_2020),
        ...splitCNNPCDelegates(CN_PEOPLES_CONGRESS_2020),
        ...CN_GOVERNORS_2020,
      ];
    default:
      return [];
  }
}

// ─── Reset Presets ───────────────────────────────────────────────────────────
// Presets define starting conditions for game resets

export interface ResetPreset {
  id: string;
  name: string;
  description: string;
  /** Countries included in this preset */
  countries: CountryId[];
  /** If true, delete all default parties (Democrat, Republican, UK parties) */
  deleteDefaultParties?: boolean;
}

/**
 * Available reset presets.
 * Each preset defines a specific starting condition for game resets.
 */
// ─────────────────────────────────────────────────────────────────────────────
// 1953 Early-Cold-War one-party legislatures. Regions match 1979 (bloc borders
// were stable across the Cold War), but each chamber uses its ERA-CORRECT ruling
// party: HU is the MDP (Rákosi's Working People's Party, not the post-1956 MSZMP)
// and RO is the PMR (the Workers' Party, not the "PCR" name it adopted in 1965).
// The other bloc ruling parties (SED, PZPR, SKJ, BKP, KSČ, CPB) carried the same
// names in both eras. Seat totals are authored for the 1953 convocations and
// differ from the 1979 map. The US 1953 executive + 83rd Congress are fully
// authored above; the other democracies (UK/FR/IT/ES/SE/TR/DE/JP/BR/IE) start
// with vacant legislatures — per-state 1953 results are a separate task.
// Nigeria is a British colony (coming-soon) but seeds its late-colonial party
// triad (NCNC/AG/NPC) + zone-governor priors; Federal House seats stay vacant.

// USSR — 3rd Supreme Soviet convocation (elected Mar 1950); CPSU ~75%, non-party ~25%.
// Soviet of the Union: 526 seats across all 14 RU regions; every region's
// delegation equals its `houseDistricts` in ruRegions1953 — asserted in
// sovietSeatMap.test.ts, so reapportioning requires regenerating this list.
// The real 1954 convocation seated 708; the missing 182 belong to Ukraine,
// Byelorussia and the Baltics, which are their own countries with their own
// chambers now, so their rows left this list.
// Soviet of Nationalities: 515 republic-weighted delegations from
// RU_NATIONALITIES_SEATS (ruSeats.ts, D11), likewise down from 640 for the same
// reason. Both chambers: CPSU share = round(seats * 0.75).
export const SU_SUPREME_SOVIET_1953: HistoricalSeat[] = [
  { state: "CEN", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 60 },
  { state: "CEN", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 20 },
  { state: "NWR", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 28 },
  { state: "NWR", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 9 },
  { state: "NOR", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 13 },
  { state: "NOR", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 4 },
  { state: "CBE", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 23 },
  { state: "CBE", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 7 },
  { state: "VOL", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 45 },
  { state: "VOL", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 15 },
  { state: "NCA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 35 },
  { state: "NCA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 11 },
  { state: "URA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 41 },
  { state: "URA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 14 },
  { state: "WSB", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 26 },
  { state: "WSB", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 8 },
  { state: "ESB", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 16 },
  { state: "ESB", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 5 },
  { state: "FEA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 14 },
  { state: "FEA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 4 },
  { state: "KAZ", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 23 },
  { state: "KAZ", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 7 },
  { state: "TRA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 29 },
  { state: "TRA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 10 },
  { state: "CAS", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 38 },
  { state: "CAS", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 12 },
  { state: "MOL", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 7 },
  { state: "MOL", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 2 },
  // ── Soviet of Nationalities (RU_NATIONALITIES_SEATS, D11) — republic-weighted,
  // same CPSU share convention: round(seats * 0.75). ──
  { state: "CEN", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "CEN", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  { state: "NWR", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "NWR", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "NOR", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "NOR", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "CBE", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "CBE", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "VOL", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 33 },
  { state: "VOL", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 11 },
  { state: "NCA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 25 },
  { state: "NCA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 8 },
  { state: "URA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "URA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "WSB", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "WSB", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "ESB", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "ESB", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "FEA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "FEA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "KAZ", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "KAZ", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  { state: "TRA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 81 },
  { state: "TRA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 27 },
  { state: "CAS", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 83 },
  { state: "CAS", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 28 },
  { state: "MOL", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "MOL", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  // ── Executive (US_EXECUTIVE_1953 pattern: national offices use the bare
  // country code as `state`; fictional generated names). The world must not
  // open with a vacant Council of Ministers — seedRUGovernmentFormation links
  // the seeded Premier NPP into a `formed` government doc (D5).
  { state: "RU", officeType: "premier", party: "su_cpsu" },
  { state: "RU", officeType: "chairmanOfPresidium", party: "su_cpsu" },
];

// GDR — 1st Volkskammer (elected Oct 1950); National Front: SED + bloc parties.
// Seats per Land ∝ ddRegions1953 houseDistricts (BEO 32 / MV 58 / BB 71 /
// ST 112 / SN 151 / TH 76 = 500); party totals SED 292, CDU/LDPD/NDPD 51 each,
// DBD 55.
export const DD_VOLKSKAMMER_1953: HistoricalSeat[] = [
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 19 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 3 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 3 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 3 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 4 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 34 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 6 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 6 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 6 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 6 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 41 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 7 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 7 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 7 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 9 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 65 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 12 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 12 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 11 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 12 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 88 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 15 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 15 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 16 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 17 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 45 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 7 },
];

// US executive 1953 — the 1952 presidential landslide (R 55.2% / D 44.3%) put a
// Republican president + vice president in office in January 1953, so a 1953
// world must NOT start with a vacant (or NPP-appointed) executive. National
// offices pass the country code as `state` (see seedFromSeats); the seeded NPPs
// get generated fictional names like every other historical officeholder.
// The perpetual 1956 presidential race (cycleAnchorContext president: 1956)
// spawns from canonical anchors regardless of the officeholder, so seeding the
// executive does not suppress the re-election cycle.
export const US_EXECUTIVE_1953: HistoricalSeat[] = [
  { state: "US", officeType: "president", party: "republican" },
  { state: "US", officeType: "vicePresident", party: "republican" },
];

// BR executive 1953 — the PTB ticket won the Oct 1950 presidential election;
// that Second Republic president (inaugurated Jan 1951) is still sitting in
// 1953. Seed a generic NPP on the historically-correct PTB affiliation (same
// unnamed-officeholder pattern as US_EXECUTIVE_1953). No VP row: the 1951–54
// VP sat with PSP, which is not in the 1953 BR party roster. BR perpetual
// elections only spawn chamber races, so without this seed the presidency
// stays vacant for the whole game.
export const BR_EXECUTIVE_1953: HistoricalSeat[] = [
  { state: "BR", officeType: "president", party: "br_ptb" },
];

// ─── US legislature 1953 — 83rd Congress (elected Nov 1952, seated Jan 3 1953) ─
//
// COMPLETE. Every state's real delegation is authored from the 1952 election
// results, sized to the 1950-census apportionment (HOUSE_SEATS_1953 in states.ts —
// the 435-seat map the 1953-default preset now uses). Because every seat is
// authored, the sim's backfillMissingSeats fills ZERO US seats: the authored map
// IS the chamber. Alaska and Hawaii are absent (territories until 1959), as is DC
// (no House seat, no pre-1961 electoral votes).
//
// National composition (verified against the 83rd Congress):
//   House:  213 D / 221 R / 1 I   (435)  — lone Independent Frazier Reams, Ohio 9th
//   Senate:  47 D / 48 R / 1 I    (96)   — lone Independent Wayne Morse, Oregon
//   Governors (Jan 1953): 18 D / 30 R    (48)
//
// Sources: Wikipedia "1952 United States House / Senate / gubernatorial elections"
// and "83rd United States Congress", cross-checked per state against the 1950
// apportionment and the national totals. NOTE: Virginia is 7 D / 3 R — the three
// GOP freshmen Poff (VA-6), Wampler (VA-9) and Broyhill (VA-10) won in the 1952
// Eisenhower wave; the earlier Solid-South scaffold undercounted them as 9 D / 1 R,
// so the real Solid South is 100 D / 6 R, not 102 / 4.
//
// House delegations are multi-member (seatsHeld); Senate rows carry the state's
// canonical senateClass (SENATE_CLASSES_BY_STATE); one row per governorship.
export const US_HOUSE_1953: HistoricalSeat[] = [
  { state: "AL", officeType: "house", party: "democrat", seatsHeld: 9 },
  { state: "AR", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "AZ", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "AZ", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "CA", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "CA", officeType: "house", party: "republican", seatsHeld: 19 },
  { state: "CO", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "CO", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "CT", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "CT", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "DE", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "FL", officeType: "house", party: "democrat", seatsHeld: 8 },
  { state: "GA", officeType: "house", party: "democrat", seatsHeld: 10 },
  { state: "IA", officeType: "house", party: "republican", seatsHeld: 8 },
  { state: "ID", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "ID", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "IL", officeType: "house", party: "democrat", seatsHeld: 9 },
  { state: "IL", officeType: "house", party: "republican", seatsHeld: 16 },
  { state: "IN", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "IN", officeType: "house", party: "republican", seatsHeld: 10 },
  { state: "KS", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "KS", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "KY", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "KY", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "LA", officeType: "house", party: "democrat", seatsHeld: 8 },
  { state: "MA", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "MA", officeType: "house", party: "republican", seatsHeld: 8 },
  { state: "MD", officeType: "house", party: "democrat", seatsHeld: 3 },
  { state: "MD", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "ME", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "MI", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "MI", officeType: "house", party: "republican", seatsHeld: 13 },
  { state: "MN", officeType: "house", party: "democrat", seatsHeld: 4 },
  { state: "MN", officeType: "house", party: "republican", seatsHeld: 5 },
  { state: "MO", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "MO", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "MS", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "MT", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "MT", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "NC", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "NC", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "ND", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "NE", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "NH", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "NJ", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "NJ", officeType: "house", party: "republican", seatsHeld: 9 },
  { state: "NM", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "NV", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "NY", officeType: "house", party: "democrat", seatsHeld: 16 },
  { state: "NY", officeType: "house", party: "republican", seatsHeld: 27 },
  { state: "OH", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "OH", officeType: "house", party: "republican", seatsHeld: 16 },
  { state: "OH", officeType: "house", party: "independent", seatsHeld: 1 },
  { state: "OK", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "OK", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "OR", officeType: "house", party: "republican", seatsHeld: 4 },
  { state: "PA", officeType: "house", party: "democrat", seatsHeld: 11 },
  { state: "PA", officeType: "house", party: "republican", seatsHeld: 19 },
  { state: "RI", officeType: "house", party: "democrat", seatsHeld: 2 },
  { state: "SC", officeType: "house", party: "democrat", seatsHeld: 6 },
  { state: "SD", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "TN", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "TN", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "TX", officeType: "house", party: "democrat", seatsHeld: 22 },
  { state: "UT", officeType: "house", party: "republican", seatsHeld: 2 },
  { state: "VA", officeType: "house", party: "democrat", seatsHeld: 7 },
  { state: "VA", officeType: "house", party: "republican", seatsHeld: 3 },
  { state: "VT", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "WA", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "WA", officeType: "house", party: "republican", seatsHeld: 6 },
  { state: "WI", officeType: "house", party: "democrat", seatsHeld: 1 },
  { state: "WI", officeType: "house", party: "republican", seatsHeld: 9 },
  { state: "WV", officeType: "house", party: "democrat", seatsHeld: 5 },
  { state: "WV", officeType: "house", party: "republican", seatsHeld: 1 },
  { state: "WY", officeType: "house", party: "republican", seatsHeld: 1 },
];

// Senate — 2 seats per state in their canonical classes (SENATE_CLASSES_BY_STATE).
// 47 D / 48 R / 1 I; all 22 Southern seats Democratic; Wayne Morse (OR, class 3) I.
export const US_SENATE_1953: HistoricalSeat[] = [
  { state: "AL", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "AL", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "AR", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "AR", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "AZ", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "AZ", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "CA", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "CA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "CO", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "CO", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "CT", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "CT", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "DE", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "DE", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "FL", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "FL", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "GA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "GA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "IA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "IA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "ID", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "ID", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "IL", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "IL", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "IN", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "IN", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "KS", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "KS", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "KY", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "KY", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "LA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "LA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "MA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MA", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MD", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MD", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "ME", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "ME", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MI", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MI", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "MN", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "MN", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "MO", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MO", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "MS", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MS", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "MT", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "MT", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NC", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NC", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "ND", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "ND", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "NE", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "NE", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NH", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NH", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "NJ", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "NJ", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "NM", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "NM", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "NV", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "NV", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "NY", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "NY", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "OH", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "OH", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "OK", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "OK", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "OR", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "OR", officeType: "senate", party: "independent", senateClass: 3 },
  { state: "PA", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "PA", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "RI", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "RI", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "SC", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "SC", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "SD", officeType: "senate", party: "republican", senateClass: 2 },
  { state: "SD", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "TN", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "TN", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "TX", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "TX", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "UT", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "UT", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "VA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "VA", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "VT", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "VT", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "WA", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "WI", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "WI", officeType: "senate", party: "republican", senateClass: 3 },
  { state: "WV", officeType: "senate", party: "democrat", senateClass: 1 },
  { state: "WV", officeType: "senate", party: "democrat", senateClass: 2 },
  { state: "WY", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "WY", officeType: "senate", party: "democrat", senateClass: 2 },
];

// Governors as of January 1953 — 18 D / 30 R; all 11 Southern statehouses Democratic.
export const US_GOVERNOR_1953: HistoricalSeat[] = [
  { state: "AL", officeType: "governor", party: "democrat" },
  { state: "AR", officeType: "governor", party: "democrat" },
  { state: "AZ", officeType: "governor", party: "republican" },
  { state: "CA", officeType: "governor", party: "republican" },
  { state: "CO", officeType: "governor", party: "republican" },
  { state: "CT", officeType: "governor", party: "republican" },
  { state: "DE", officeType: "governor", party: "republican" },
  { state: "FL", officeType: "governor", party: "democrat" },
  { state: "GA", officeType: "governor", party: "democrat" },
  { state: "IA", officeType: "governor", party: "republican" },
  { state: "ID", officeType: "governor", party: "republican" },
  { state: "IL", officeType: "governor", party: "republican" },
  { state: "IN", officeType: "governor", party: "republican" },
  { state: "KS", officeType: "governor", party: "republican" },
  { state: "KY", officeType: "governor", party: "democrat" },
  { state: "LA", officeType: "governor", party: "democrat" },
  { state: "MA", officeType: "governor", party: "republican" },
  { state: "MD", officeType: "governor", party: "republican" },
  { state: "ME", officeType: "governor", party: "republican" },
  { state: "MI", officeType: "governor", party: "democrat" },
  { state: "MN", officeType: "governor", party: "republican" },
  { state: "MO", officeType: "governor", party: "democrat" },
  { state: "MS", officeType: "governor", party: "democrat" },
  { state: "MT", officeType: "governor", party: "republican" },
  { state: "NC", officeType: "governor", party: "democrat" },
  { state: "ND", officeType: "governor", party: "republican" },
  { state: "NE", officeType: "governor", party: "republican" },
  { state: "NH", officeType: "governor", party: "republican" },
  { state: "NJ", officeType: "governor", party: "republican" },
  { state: "NM", officeType: "governor", party: "republican" },
  { state: "NV", officeType: "governor", party: "republican" },
  { state: "NY", officeType: "governor", party: "republican" },
  { state: "OH", officeType: "governor", party: "democrat" },
  { state: "OK", officeType: "governor", party: "democrat" },
  { state: "OR", officeType: "governor", party: "republican" },
  { state: "PA", officeType: "governor", party: "republican" },
  { state: "RI", officeType: "governor", party: "democrat" },
  { state: "SC", officeType: "governor", party: "democrat" },
  { state: "SD", officeType: "governor", party: "republican" },
  { state: "TN", officeType: "governor", party: "democrat" },
  { state: "TX", officeType: "governor", party: "democrat" },
  { state: "UT", officeType: "governor", party: "republican" },
  { state: "VA", officeType: "governor", party: "democrat" },
  { state: "VT", officeType: "governor", party: "republican" },
  { state: "WA", officeType: "governor", party: "republican" },
  { state: "WI", officeType: "governor", party: "republican" },
  { state: "WV", officeType: "governor", party: "democrat" },
  { state: "WY", officeType: "governor", party: "republican" },
];

// Other Eastern-Bloc one-party states 1953 — same party/region structure as 1979.
// Byelorussia and the Baltics are NOT here either: they are separate playable
// countries (BLR/BAL) with their own chambers, not part of the bloc-satellite
// pattern this list encodes.
export const BLOC_CHAMBERS_1953: HistoricalSeat[] = [
  { state: "HU_BUD", officeType: "chamber", party: "hu_mdp", seatsHeld: 52 },
  { state: "HU_PES", officeType: "chamber", party: "hu_mdp", seatsHeld: 27 },
  { state: "HU_TRW", officeType: "chamber", party: "hu_mdp", seatsHeld: 58 },
  { state: "HU_TRS", officeType: "chamber", party: "hu_mdp", seatsHeld: 30 },
  { state: "HU_NOR", officeType: "chamber", party: "hu_mdp", seatsHeld: 39 },
  { state: "HU_ALF", officeType: "chamber", party: "hu_mdp", seatsHeld: 92 },
  { state: "PL_MAZ", officeType: "chamber", party: "pl_pzpr", seatsHeld: 60 },
  { state: "PL_LOD", officeType: "chamber", party: "pl_pzpr", seatsHeld: 50 },
  { state: "PL_MAL", officeType: "chamber", party: "pl_pzpr", seatsHeld: 60 },
  { state: "PL_SLK", officeType: "chamber", party: "pl_pzpr", seatsHeld: 65 },
  { state: "PL_DSL", officeType: "chamber", party: "pl_pzpr", seatsHeld: 42 },
  { state: "PL_WLK", officeType: "chamber", party: "pl_pzpr", seatsHeld: 62 },
  { state: "PL_POM", officeType: "chamber", party: "pl_pzpr", seatsHeld: 46 },
  { state: "PL_EAS", officeType: "chamber", party: "pl_pzpr", seatsHeld: 40 },
  { state: "RO_BUC", officeType: "chamber", party: "ro_pmr", seatsHeld: 28 },
  { state: "RO_MUN", officeType: "chamber", party: "ro_pmr", seatsHeld: 80 },
  { state: "RO_OLT", officeType: "chamber", party: "ro_pmr", seatsHeld: 41 },
  { state: "RO_TRA", officeType: "chamber", party: "ro_pmr", seatsHeld: 75 },
  { state: "RO_VST", officeType: "chamber", party: "ro_pmr", seatsHeld: 52 },
  { state: "RO_MOL", officeType: "chamber", party: "ro_pmr", seatsHeld: 68 },
  { state: "RO_DOB", officeType: "chamber", party: "ro_pmr", seatsHeld: 14 },
  { state: "YU_SLO", officeType: "chamber", party: "yu_skj", seatsHeld: 25 },
  { state: "YU_CRO", officeType: "chamber", party: "yu_skj", seatsHeld: 61 },
  { state: "YU_BIH", officeType: "chamber", party: "yu_skj", seatsHeld: 55 },
  { state: "YU_SRB", officeType: "chamber", party: "yu_skj", seatsHeld: 77 },
  { state: "YU_VOJ", officeType: "chamber", party: "yu_skj", seatsHeld: 27 },
  { state: "YU_KOS", officeType: "chamber", party: "yu_skj", seatsHeld: 20 },
  { state: "YU_MNE", officeType: "chamber", party: "yu_skj", seatsHeld: 8 },
  { state: "YU_MKD", officeType: "chamber", party: "yu_skj", seatsHeld: 25 },
  { state: "BG_SOF", officeType: "chamber", party: "bg_bkp", seatsHeld: 50 },
  { state: "BG_NOR", officeType: "chamber", party: "bg_bkp", seatsHeld: 137 },
  { state: "BG_COA", officeType: "chamber", party: "bg_bkp", seatsHeld: 53 },
  { state: "BG_THR", officeType: "chamber", party: "bg_bkp", seatsHeld: 113 },
  { state: "BG_SW", officeType: "chamber", party: "bg_bkp", seatsHeld: 31 },
  { state: "CS_PRG", officeType: "chamber", party: "cs_ksc", seatsHeld: 15 },
  { state: "CS_BOH", officeType: "chamber", party: "cs_ksc", seatsHeld: 75 },
  { state: "CS_MOR", officeType: "chamber", party: "cs_ksc", seatsHeld: 53 },
  { state: "CS_SVK", officeType: "chamber", party: "cs_ksc", seatsHeld: 57 },
];

// PRC — the national one-party chamber for the 1953 preset. Same shape as
// SU_SUPREME_SOVIET_1953 / DD_VOLKSKAMMER_1953 / BLOC_CHAMBERS_1953: the
// NATIONAL chamber only (no sub-national rows — DD seats no Landtage and the
// bloc seats no regional assemblies either).
//
// Era honesty. The National People's Congress did NOT exist in 1953: the 1st
// NPC convened in September 1954, and until then the CPPCC National Committee
// exercised the NPC's functions under the 1949 Common Program. The preset
// models that interim body on the `npcDelegate` office type, which is why the
// apportionment is the 1,226-deputy 1st-NPC allocation rather than the modern
// 2,980 — the same allocation `cnRegions1953.houseDistricts` already authors
// (88/129/379/215/118/219/78 = 1226) and that
// `COUNTRY_CONFIGS.CN.legislature.lowerChamber.seats` already declares for
// this preset. The game's own `cnNpcDelegate` cycle anchor for 1953-default is
// 1954, so cycle 1 resolves exactly when the 1st NPC really convened.
//
// Party split is MODELED, not copied from 1979/2020. The 1949-54 united front
// was materially broader than later decades: alongside the CPC, the CPPCC and
// the 1st NPC seated the recognised democratic parties (CDL / CNDCA here) and
// a large bloc of non-party "democratic personages" and mass-organisation
// delegates. Modeled as CPC ~55% / CDL ~6% / CNDCA ~4% / non-party ~35%, which
// is deliberately far from the CCP shares the later tables use (1991 ~96.7%,
// 2020 ~94.5%). Non-party rows use `cn_independent` (INDEPENDENT_SLUGS), the
// same convention SU_SUPREME_SOVIET_1953 uses for its non-party quarter.
// Per-region rows sum EXACTLY to that region's `houseDistricts`.
export const CN_NPC_1953: HistoricalSeat[] = [
  // Dongbei (Northeast): 88 — CPC 48, CDL 5, CNDCA 4, non-party 31
  { state: "DB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 48 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 5 },
  { state: "DB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 4 },
  { state: "DB", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 31 },

  // Huabei (North): 129 — CPC 71, CDL 8, CNDCA 5, non-party 45
  { state: "HB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 71 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 8 },
  { state: "HB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 5 },
  { state: "HB", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 45 },

  // Huadong (East): 379 — CPC 208, CDL 23, CNDCA 15, non-party 133
  { state: "HD", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 208 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 23 },
  { state: "HD", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 15 },
  { state: "HD", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 133 },

  // Huazhong (Central): 215 — CPC 118, CDL 13, CNDCA 9, non-party 75
  { state: "HZ", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 118 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 13 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 9 },
  { state: "HZ", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 75 },

  // Huanan (South): 118 — CPC 65, CDL 7, CNDCA 5, non-party 41
  { state: "HN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 65 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 7 },
  { state: "HN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 5 },
  { state: "HN", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 41 },

  // Xinan (Southwest): 219 — CPC 120, CDL 13, CNDCA 9, non-party 77
  { state: "XN", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 120 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 13 },
  { state: "XN", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 9 },
  { state: "XN", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 77 },

  // Xibei (Northwest): 78 — CPC 43, CDL 5, CNDCA 3, non-party 27
  { state: "XB", officeType: "npcDelegate", party: "cn_ccp", seatsHeld: 43 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cdl", seatsHeld: 5 },
  { state: "XB", officeType: "npcDelegate", party: "cn_cndca", seatsHeld: 3 },
  { state: "XB", officeType: "npcDelegate", party: "cn_independent", seatsHeld: 27 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1979 Cold-War one-party legislatures (single National Front lists). The
// multiparty players (US/UK) and economy-only democracies (FR/IT/ES/SE/TR) start
// with vacant legislatures — their per-state/per-region 1979 results are a
// separate historical-data task and are deliberately not estimated here. The
// one-party states ARE seated because single-list dominance is a historical fact.
// officeType "chamber" = a multi-seat proportional lower chamber (the BR pattern).

// USSR — Supreme Soviet single-list: CPSU members ~75%, non-party (independent) ~25%.
// Soviet of the Union: 559 seats across all 14 RU regions; every region's
// delegation equals its `houseDistricts` in ruRegions — asserted in
// sovietSeatMap.test.ts, so reapportioning requires regenerating this list.
// The real 1979 chamber seated 750; the missing 191 belong to Ukraine,
// Byelorussia and the Baltics, which are their own countries with their own
// chambers now, so their rows left this list.
// Soviet of Nationalities: 515 republic-weighted delegations from
// RU_NATIONALITIES_SEATS (ruSeats.ts, D11), likewise down from 640 for the same
// reason. Both chambers: CPSU share = round(seats * 0.75).
export const SU_SUPREME_SOVIET_1979: HistoricalSeat[] = [
  { state: "CEN", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 61 },
  { state: "CEN", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 20 },
  { state: "NWR", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 29 },
  { state: "NWR", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 9 },
  { state: "NOR", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 13 },
  { state: "NOR", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 4 },
  { state: "CBE", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "CBE", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 6 },
  { state: "VOL", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 44 },
  { state: "VOL", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 14 },
  { state: "NCA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 32 },
  { state: "NCA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 11 },
  { state: "URA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 41 },
  { state: "URA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 14 },
  { state: "WSB", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 26 },
  { state: "WSB", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 9 },
  { state: "ESB", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "ESB", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 6 },
  { state: "FEA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "FEA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 5 },
  { state: "KAZ", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 32 },
  { state: "KAZ", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 10 },
  { state: "TRA", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 30 },
  { state: "TRA", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 10 },
  { state: "CAS", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 55 },
  { state: "CAS", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 18 },
  { state: "MOL", officeType: "supremeSovietDeputy", party: "su_cpsu", seatsHeld: 8 },
  { state: "MOL", officeType: "supremeSovietDeputy", party: "independent", seatsHeld: 3 },
  // ── Soviet of Nationalities (RU_NATIONALITIES_SEATS, D11) — republic-weighted,
  // same CPSU share convention: round(seats * 0.75). The D11 map is
  // population-independent, so the delegation matches the 1953 block. ──
  { state: "CEN", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "CEN", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  { state: "NWR", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "NWR", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "NOR", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "NOR", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "CBE", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "CBE", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "VOL", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 33 },
  { state: "VOL", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 11 },
  { state: "NCA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 25 },
  { state: "NCA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 8 },
  { state: "URA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 17 },
  { state: "URA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "WSB", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "WSB", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "ESB", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "ESB", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "FEA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 15 },
  { state: "FEA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 5 },
  { state: "KAZ", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "KAZ", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  { state: "TRA", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 81 },
  { state: "TRA", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 27 },
  { state: "CAS", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 83 },
  { state: "CAS", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 28 },
  { state: "MOL", officeType: "nationalitiesDeputy", party: "su_cpsu", seatsHeld: 19 },
  { state: "MOL", officeType: "nationalitiesDeputy", party: "independent", seatsHeld: 6 },
  // ── Executive (US_EXECUTIVE_1953 pattern: national offices use the bare
  // country code as `state`; fictional generated names). The world must not
  // open with a vacant Council of Ministers — seedRUGovernmentFormation links
  // the seeded Premier NPP into a `formed` government doc (D5).
  { state: "RU", officeType: "premier", party: "su_cpsu" },
  { state: "RU", officeType: "chairmanOfPresidium", party: "su_cpsu" },
];

// GDR — Volkskammer National Front fixed allocation (SED + mass orgs ~58%, each
// bloc party ~10.4%). Allocated across the eastern Länder (sum = 500, matching
// ddRegions houseDistricts): BEO 35, MV 64, BB 81, ST 91, SN 153, TH 76.
export const DD_VOLKSKAMMER_1979: HistoricalSeat[] = [
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 20 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 4 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 4 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 4 },
  { state: "BEO", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 3 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 37 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 7 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 7 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 7 },
  { state: "MV", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 6 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 47 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 8 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 8 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 8 },
  { state: "BB", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 10 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 53 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 9 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 9 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 9 },
  { state: "ST", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 11 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 89 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 16 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 16 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 16 },
  { state: "SN", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 16 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_sed", seatsHeld: 44 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_cdu", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_ldpd", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_ndpd", seatsHeld: 8 },
  { state: "TH", officeType: "volkskammerDeputy", party: "dd_dbd", seatsHeld: 8 },
];

// Other Warsaw-Pact one-party states — single National Front list, ruling party holds the chamber.
// Byelorussia and the Baltics are NOT here either: they are separate playable
// countries (BLR/BAL) with their own chambers, not part of the bloc-satellite
// pattern this list encodes.
export const BLOC_CHAMBERS_1979: HistoricalSeat[] = [
  { state: "HU_BUD", officeType: "chamber", party: "hu_mszmp", seatsHeld: 68 },
  { state: "HU_PES", officeType: "chamber", party: "hu_mszmp", seatsHeld: 32 },
  { state: "HU_TRW", officeType: "chamber", party: "hu_mszmp", seatsHeld: 71 },
  { state: "HU_TRS", officeType: "chamber", party: "hu_mszmp", seatsHeld: 35 },
  { state: "HU_NOR", officeType: "chamber", party: "hu_mszmp", seatsHeld: 46 },
  { state: "HU_ALF", officeType: "chamber", party: "hu_mszmp", seatsHeld: 100 },
  { state: "PL_MAZ", officeType: "chamber", party: "pl_pzpr", seatsHeld: 63 },
  { state: "PL_LOD", officeType: "chamber", party: "pl_pzpr", seatsHeld: 49 },
  { state: "PL_MAL", officeType: "chamber", party: "pl_pzpr", seatsHeld: 63 },
  { state: "PL_SLK", officeType: "chamber", party: "pl_pzpr", seatsHeld: 71 },
  { state: "PL_DSL", officeType: "chamber", party: "pl_pzpr", seatsHeld: 48 },
  { state: "PL_WLK", officeType: "chamber", party: "pl_pzpr", seatsHeld: 66 },
  { state: "PL_POM", officeType: "chamber", party: "pl_pzpr", seatsHeld: 57 },
  { state: "PL_EAS", officeType: "chamber", party: "pl_pzpr", seatsHeld: 43 },
  { state: "RO_BUC", officeType: "chamber", party: "ro_pcr", seatsHeld: 35 },
  { state: "RO_MUN", officeType: "chamber", party: "ro_pcr", seatsHeld: 78 },
  { state: "RO_OLT", officeType: "chamber", party: "ro_pcr", seatsHeld: 40 },
  { state: "RO_TRA", officeType: "chamber", party: "ro_pcr", seatsHeld: 77 },
  { state: "RO_VST", officeType: "chamber", party: "ro_pcr", seatsHeld: 50 },
  { state: "RO_MOL", officeType: "chamber", party: "ro_pcr", seatsHeld: 74 },
  { state: "RO_DOB", officeType: "chamber", party: "ro_pcr", seatsHeld: 15 },
  { state: "YU_SLO", officeType: "chamber", party: "yu_skj", seatsHeld: 26 },
  { state: "YU_CRO", officeType: "chamber", party: "yu_skj", seatsHeld: 63 },
  { state: "YU_BIH", officeType: "chamber", party: "yu_skj", seatsHeld: 57 },
  { state: "YU_SRB", officeType: "chamber", party: "yu_skj", seatsHeld: 79 },
  { state: "YU_VOJ", officeType: "chamber", party: "yu_skj", seatsHeld: 28 },
  { state: "YU_KOS", officeType: "chamber", party: "yu_skj", seatsHeld: 21 },
  { state: "YU_MNE", officeType: "chamber", party: "yu_skj", seatsHeld: 8 },
  { state: "YU_MKD", officeType: "chamber", party: "yu_skj", seatsHeld: 26 },
  { state: "BG_SOF", officeType: "chamber", party: "bg_bkp", seatsHeld: 58 },
  { state: "BG_NOR", officeType: "chamber", party: "bg_bkp", seatsHeld: 130 },
  { state: "BG_COA", officeType: "chamber", party: "bg_bkp", seatsHeld: 58 },
  { state: "BG_THR", officeType: "chamber", party: "bg_bkp", seatsHeld: 118 },
  { state: "BG_SW", officeType: "chamber", party: "bg_bkp", seatsHeld: 36 },
  { state: "CS_PRG", officeType: "chamber", party: "cs_ksc", seatsHeld: 16 },
  { state: "CS_BOH", officeType: "chamber", party: "cs_ksc", seatsHeld: 68 },
  { state: "CS_MOR", officeType: "chamber", party: "cs_ksc", seatsHeld: 51 },
  { state: "CS_SVK", officeType: "chamber", party: "cs_ksc", seatsHeld: 65 },
];

export const RESET_PRESETS: ResetPreset[] = [
  {
    id: "1953-default",
    name: "1953 Start Date - Early Cold War",
    description:
      "The Early Cold War world: US/UK and the USSR are player-enabled (Stalin died March 1953; Khrushchev consolidating). France/Italy/Spain/Sweden/Turkey + Japan/China/West Germany(FRG)/Brazil/Ireland are economy-enabled. East Germany (June 17 uprising 1953!) and the Stalinist bloc (Poland/Romania/Yugoslavia/Hungary/Czechoslovakia/Bulgaria) are NPP-run one-party states; Byelorussia and the Baltics are Soviet union republics inside the USSR, not separate states. Nigeria is a British colony (coming-soon). Real ~1953 demographics, metrics and budgets per country. One-party legislatures start seated; democracies start vacant.",
    countries: [
      "US",
      "UK",
      "RU",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "DE",
      "JP",
      "CN",
      "NG",
      "BR",
      "IE",
      "DD",
      "PL",
      "RO",
      "YU",
      "HU",
      "CS",
      "BG",
    ],
  },
  {
    id: "2023-default",
    name: "2023 Start Date - Default Parties",
    description:
      "US 118th Congress (Jan 2023, post-2022 midterms) — Biden presidency, divided government (Republican House / Democratic Senate). Real 2023 Census/BEA/BLS state data + FY2023 budget. Non-US countries fall back to their 2019 bundles.",
    countries: ["US", "UK", "JP", "DE", "CN", "IE"],
  },
  {
    id: "2019-default",
    name: "2019 Start Date - Default Parties",
    description:
      "US 116th Congress (Feb 2020) + UK post-2019 election + JP National Diet (Jan 2020) + DE 19th Bundestag scaled + 2019 Ministerpräsidenten + CN 13th NPC + IE 33rd Dáil (2020).",
    countries: ["US", "UK", "JP", "DE", "CN", "IE"],
  },
  {
    id: "1991-default",
    name: "1991 Start Date - Default Parties",
    description:
      "US 102nd Congress (1991-93) + UK post-1992 election + JP post-1990 election + DE 12th Bundestag + CN 7th NPC + BR 49th Congress + IE 27th Dáil. Reg/Org seeded from 1988-92 election baselines.",
    countries: ["US", "UK", "JP", "DE", "CN", "BR", "IE"],
  },
  {
    id: "1979-default",
    name: "1979 Start Date - Cold War",
    description:
      "The Cold War world: US/UK and the USSR are player-enabled; France/Italy/Spain/Sweden/Turkey + China/Japan/Germany(FRG)/Brazil/Nigeria are economy-enabled; East Germany and the Warsaw-Pact bloc (Poland/Romania/Yugoslavia/Hungary/Czechoslovakia/Bulgaria) are NPP-run one-party states; Byelorussia and the Baltics are Soviet union republics inside the USSR, not separate states. Real ~1979 demographics, metrics and budgets per country. Legislatures start vacant (historical seat maps are a follow-up).",
    countries: [
      "US",
      "UK",
      "RU",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "DE",
      "JP",
      "CN",
      "NG",
      "BR",
      "IE",
      "DD",
      "PL",
      "RO",
      "YU",
      "HU",
      "CS",
      "BG",
    ],
  },
  {
    id: "empty",
    name: "2019 Start Date - No NPPs",
    description: "Start with no seated officials. All seats vacant for player elections.",
    countries: [],
  },
  {
    id: "2019-no-parties",
    name: "2019 Start Date - No Parties",
    description: "No NPPs, no default parties. Clean slate for player-created parties.",
    countries: [],
    deleteDefaultParties: true,
  },
];

/**
 * Get seats for a specific preset
 */
export function getPresetSeats(presetId: string): HistoricalSeat[] {
  switch (presetId) {
    case "2019-default":
      return [
        ...US_HOUSE_2020,
        ...US_SENATE_2020,
        ...US_STATE_SENATE_2020,
        ...US_GOVERNORS_2020,
        ...UK_COMMONS_2020,
        ...UK_REGIONAL_COUNCIL_2020,
        ...UK_FIRST_MINISTERS_2020,
        ...JP_SHUGIIN_2020,
        ...JP_SANGIIN_2020,
        ...JP_GOVERNORS_2020,
        ...JP_REGIONAL_COUNCIL_2020,
        ...DE_BUNDESTAG_2021,
        ...DE_LANDTAG_2020,
        ...DE_MINISTERPRAESIDENTEN_2020,
        ...splitCNNPCDelegates(CN_NPC_2020),
        ...splitCNNPCDelegates(CN_PEOPLES_CONGRESS_2020),
        ...CN_GOVERNORS_2020,
        ...IE_DAIL_2020,
        ...IE_SEANAD_2020,
      ];
    case "1991-default":
      return [
        ...US_HOUSE_1992,
        ...US_SENATE_1992,
        ...US_STATE_SENATE_1990,
        ...US_GOVERNORS_1992,
        ...UK_COMMONS_1992,
        ...UK_REGIONAL_COUNCIL_1992,
        ...UK_FIRST_MINISTERS_1992,
        ...JP_SHUGIIN_1990,
        ...JP_SANGIIN_1989,
        ...JP_GOVERNORS_1991,
        ...JP_REGIONAL_COUNCIL_1991,
        ...DE_BUNDESTAG_1990,
        ...DE_LANDTAG_1990,
        ...DE_MINISTERPRAESIDENTEN_1992,
        ...splitCNNPCDelegates(CN_NPC_1991),
        ...splitCNNPCDelegates(CN_PEOPLES_CONGRESS_1991),
        ...CN_GOVERNORS_1991,
        ...BR_CHAMBER_1991,
        ...BR_SENATE_1991,
        ...IE_DAIL_1991,
        ...IE_SEANAD_1991,
      ];
    case "1953-default":
      // One-party states seated (USSR/GDR/PRC/bloc). The US federal legislature
      // is ALSO fully seated — the 83rd Congress is authored per state below.
      // The remaining democratic legislatures (UK/FR/IT/ES/SE/TR/DE/JP/BR/IE)
      // start vacant; NG is colonial/coming-soon.
      // Presidential EXECUTIVES are seeded as generic NPPs on the historically
      // correct governing ticket (US Republican from the 1952 landslide; BR PTB
      // from the 1950 election) so presidential countries don't open vacant —
      // there is no near-term presidential race to fill them (US cycle anchors
      // to 1956; BR only spawns chamber races). The UK PM is intentionally NOT
      // seeded — the PM derives from the Commons majority via government
      // formation, and the 1953 Commons seat map is a separate historical-data
      // task.
      return [
        ...US_EXECUTIVE_1953,
        ...BR_EXECUTIVE_1953,
        // US legislature: COMPLETE 83rd Congress — every state's real 1952
        // delegation is authored (House 213 D / 221 R / 1 I = 435 over the
        // 1950-census apportionment; Senate 47 D / 48 R / 1 I = 96 over 48
        // states, AK/HI still territories). Nothing here is estimated and
        // nothing is left for backfillMissingSeats to fill.
        ...US_HOUSE_1953,
        ...US_SENATE_1953,
        ...US_GOVERNOR_1953,
        ...SU_SUPREME_SOVIET_1953,
        ...DD_VOLKSKAMMER_1953,
        // PRC: the national chamber only, same as GDR/bloc. Provincial People's
        // Congresses are NOT seated — they did not exist until 1954 either, and
        // no other 1953 one-party state seats a sub-national chamber.
        ...splitCNNPCDelegates(CN_NPC_1953),
        ...BLOC_CHAMBERS_1953,
      ];
    case "1979-default":
      // One-party states are seated (single-list dominance is historical fact).
      // The multiparty players (US/UK) + economy-only democracies (FR/IT/ES/SE/TR)
      // start vacant — their per-state/per-region 1979 results are a separate
      // historical-data task and are deliberately not estimated.
      return [...SU_SUPREME_SOVIET_1979, ...DD_VOLKSKAMMER_1979, ...BLOC_CHAMBERS_1979];
    case "empty":
      return [];
    default:
      // ⚠️ SILENT 2020 FALLBACK — recorded, not hidden.
      //
      // Any preset without a case above lands here and receives the ENTIRE 2020
      // chamber roster. That is how 1999-default, 2007-default and 2023-default
      // came to report 1,004 seats byte-identical to 2019-default: they are not
      // reusing these arrays by design, they are unrecognised. Downstream that
      // shows up as 192 jp_* and 187 de_* seats naming parties whose
      // `validForPresets` excludes those eras, so `resolvePartyId` misses and
      // folds them to "independent" — the failure `seedHistorical.test.ts`
      // already guards for 1991's de_spd.
      //
      // Authoring real 1999/2007 rosters is a historical-data task. Until then
      // the fallback at least announces itself, via the same mechanism
      // `selectPresetBundle` uses, so `runSeed`'s closing "⚠ N seed lane(s) had
      // no bundle and used 2019 data" line names it.
      recordPresetFallback("historicalSeats:getPresetSeats", presetId);
      return [
        ...US_HOUSE_2020,
        ...US_SENATE_2020,
        ...US_STATE_SENATE_2020,
        ...US_GOVERNORS_2020,
        ...UK_COMMONS_2020,
        ...UK_REGIONAL_COUNCIL_2020,
        ...UK_FIRST_MINISTERS_2020,
        ...JP_SHUGIIN_2020,
        ...JP_SANGIIN_2020,
        ...JP_GOVERNORS_2020,
        ...JP_REGIONAL_COUNCIL_2020,
        ...DE_BUNDESTAG_2021,
        ...DE_LANDTAG_2020,
        ...DE_MINISTERPRAESIDENTEN_2020,
        ...splitCNNPCDelegates(CN_NPC_2020),
        ...splitCNNPCDelegates(CN_PEOPLES_CONGRESS_2020),
        ...CN_GOVERNORS_2020,
        ...IE_DAIL_2020,
        ...IE_SEANAD_2020,
      ];
  }
}

/**
 * Get a preset by ID
 */
export function getPresetById(presetId: string): ResetPreset | undefined {
  return RESET_PRESETS.find((p) => p.id === presetId);
}
