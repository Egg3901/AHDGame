import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * Initial US governmentFormations seed document.
 *
 * Created in "pending" status, matching Brazil and Nigeria — the other two
 * presidential countries, both of which have carried one since the initial
 * release. The US was the only seeded country without one, which the admin
 * readiness report flagged as missing on every reset.
 *
 * ⚠️ THIS IS NOT WHERE THE PRESIDENT LIVES, and seeding it does not seat one.
 * For a presidential system `getHeadOfGovernmentCharacterId` reads
 * `electedOfficials` with `officeType: "president"`; only parliamentary and
 * one-party countries resolve through `governmentFormations.pmCharacterId`.
 * `pmCharacterId` stays null here forever, deliberately. The row exists so the
 * legislature's majority arithmetic has somewhere to live and so every seeded
 * country answers the same diagnostic the same way.
 *
 * ⚠️ NOTHING CREATES THIS LAZILY, unlike the UK's. `runParliamentaryCountry`
 * seeds a missing row on the first processed turn, but it only runs for
 * countries `isParliamentarySystem` accepts, and the US is not one. Without a
 * seed step the row never appears at all.
 *
 * majorityThreshold and totalSeats track the House of Representatives:
 *   - totalSeats: 435, which every shipping preset agrees on
 *   - majorityThreshold: 218 (435 / 2 + 1)
 *
 * The Senate is deliberately absent from both numbers, matching Nigeria: the
 * threshold is a lower-chamber majority, not a total of both chambers.
 */
export const usGovernmentFormation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
  _id: "US",
  countryId: "US",
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
  majorityThreshold: 218,
  seatsByParty: {},
  totalSeats: 435,
  activeVoteId: null,
  formedAt: null,
  formedTurn: null,
  collapsedAt: null,
};
