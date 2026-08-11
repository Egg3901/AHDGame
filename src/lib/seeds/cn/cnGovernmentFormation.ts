import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial CN governmentFormations seed document.
 *
 * Created in "pending" status — no President appointed yet. The turn
 * processor (via runParliamentaryGovernmentPhases) will process President
 * appointment votes once this document exists.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.CN:
 *   - coalitionThreshold: 1491 (2980 / 2 + 1)
 *   - legislature.lowerChamber.seats: 2980 (National People's Congress)
 */
export const cnGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "CN",
  countryId: "CN",
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
  majorityThreshold: 1491,
  seatsByParty: {},
  totalSeats: 2980,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
