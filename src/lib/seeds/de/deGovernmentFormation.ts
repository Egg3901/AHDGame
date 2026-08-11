import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial DE governmentFormations seed document.
 *
 * Created in "pending" status — no Chancellor appointed yet. The turn
 * processor (via runParliamentaryGovernmentPhases) will process Kanzler
 * appointment votes once this document exists.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.DE:
 *   - coalitionThreshold: 316 (630 / 2 + 1 under 2023 Wahlrechtsreform)
 *   - legislature.lowerChamber.seats: 630
 */
export const deGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "DE",
  countryId: "DE",
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
  majorityThreshold: 316,
  seatsByParty: {},
  totalSeats: 630,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
