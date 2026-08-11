import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial IE governmentFormations seed document.
 *
 * Created in "pending" status — no Taoiseach appointed yet. The turn
 * processor (via runParliamentaryGovernmentPhases) will process Taoiseach
 * appointment votes once this document exists.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.IE:
 *   - coalitionThreshold: 81 (160 / 2 + 1)
 *   - legislature.lowerChamber.seats: 160 (Dáil Éireann)
 */
export const ieGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "IE",
  countryId: "IE",
  cycle: 1,
  status: "pending",
  formationType: null,
  lostMajority: false,
  pmCharacterId: null,
  pmName: null,
  governingPartyId: null,
  coalitionId: null,
  coalitionPartyIds: null,
  totalSeatsSupporting: 0,
  majorityThreshold: 81,
  seatsByParty: {},
  totalSeats: 160,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
