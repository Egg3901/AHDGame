import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial JP governmentFormations seed document.
 *
 * Created in "pending" status — no PM appointed yet. The turn processor
 * (via runParliamentaryGovernmentPhases) will process PM appointment votes
 * once this document exists.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.JP:
 *   - coalitionThreshold: 233 (465 / 2 + 1)
 *   - legislature.lowerChamber.seats: 465
 */
export const jpGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "JP",
  countryId: "JP",
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
  majorityThreshold: 233,
  seatsByParty: {},
  totalSeats: 465,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
