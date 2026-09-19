import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial NG governmentFormations seed document.
 *
 * Created in "pending" status — no PM appointed yet. The turn
 * processor will handle parliamentary government phases once this document exists.
 *
 * majorityThreshold and totalSeats match the Nigerian House of Representatives:
 *   - majorityThreshold: 181 (360 / 2 + 1, House of Reps majority)
 *   - totalSeats: 360 (House of Representatives)
 *
 * Nigeria is a presidential system; the President is both head of state
 * and head of government. The National Assembly comprises the House of
 * Representatives (lower, 360 seats) and the Senate (upper, 109 seats).
 */
export const ngGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "NG",
  countryId: "NG",
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
  majorityThreshold: 181,
  seatsByParty: {},
  totalSeats: 360,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
