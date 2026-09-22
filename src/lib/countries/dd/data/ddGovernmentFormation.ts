import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial DD (GDR) governmentFormation seed document.
 *
 * Created in "pending" status — no General Secretary appointed yet. The turn
 * processor (via runParliamentaryGovernmentPhases) processes the head-of-government
 * appointment once this document exists, so a freshly-seeded divided-Germany world
 * does not open with a permanently vacant executive. Mirrors cnGovernmentFormation
 * — the sibling one-party, parliamentary-head-of-government state.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.DD:
 *   - coalitionThreshold: 251 (500 / 2 + 1)
 *   - legislature.lowerChamber.seats: 500 (Volkskammer)
 */
export const ddGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "DD",
  countryId: "DD",
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
  majorityThreshold: 251,
  seatsByParty: {},
  totalSeats: 500,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
