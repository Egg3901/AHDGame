import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ElectedOfficial, State } from "@/lib/db/types";

/**
 * Build the RU governmentFormations doc — unlike CN's `pending` start, RU
 * seeds FORMED (D5): a Cold-War world must not open with a vacant Council of
 * Ministers (same rationale as the seeded US executive). The Premier is the
 * NPP seeded from the SU executive HistoricalSeat rows, linked via `pmNppId`
 * (seeded officeholders are NPPs; `pmCharacterId` is the player path —
 * exactly one of the two is non-null for a formed government).
 *
 * totalSeats / majorityThreshold derive from the seeded Union chamber
 * (`houseDistricts` sum — 526 → 264 under 1953-default, 559 → 280 under
 * 1979-default; D11. The real chambers seated 708 and 750, but Ukraine,
 * Byelorussia and the Baltics are their own countries now and took their
 * districts with them). The static config coalitionThreshold stays nominal.
 *
 * In 1991 the region bundle contains the 1,068-seat RSFSR Congress, but the
 * preset has no historical Russian executive officials. Open a neutral pending
 * formation rather than assigning the already contested government to the
 * Cold War CPSU row. The known Silayev cabinet needs its own authored seat
 * roster; pending describes the game bootstrap, not a historical vacancy.
 * Returns null when the preset seeds no RU regions.
 */
export async function buildRuGovernmentFormation(
  db: Db,
  now: Date,
  preset: string
): Promise<Omit<GovernmentFormation, "createdAt" | "updatedAt"> | null> {
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "RU" }, { projection: { houseDistricts: 1 } })
    .toArray();
  if (regions.length === 0) return null; // RU not seeded in this preset

  const totalSeats = regions.reduce((sum, r) => sum + (r.houseDistricts ?? 0), 0);
  const majorityThreshold = Math.floor(totalSeats / 2) + 1;

  if (preset === "1991-default" || preset === "2027-default") {
    return {
      _id: "RU",
      countryId: "RU",
      cycle: 1,
      status: "pending",
      formationType: null,
      lostMajority: false,
      pmCharacterId: null,
      pmNppId: null,
      pmName: null,
      governingPartyId: null,
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 0,
      majorityThreshold,
      seatsByParty: {},
      totalSeats,
      activeVoteId: null,
      formedAt: null,
      formedTurn: null,
      collapsedAt: null,
      hosCharacterId: null,
      hosNppId: null,
      hosName: null,
    };
  }

  const premier = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId: "RU", officeType: "premier" });
  const chairman = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId: "RU", officeType: "chairmanOfPresidium" });

  const hasPremier = premier?.nppId != null;

  return {
    _id: "RU",
    countryId: "RU",
    cycle: 1,
    status: hasPremier ? "formed" : "pending",
    formationType: hasPremier ? "majority" : null,
    lostMajority: false,
    pmCharacterId: null,
    pmNppId: premier?.nppId ?? null,
    pmName: premier?.characterName ?? null,
    governingPartyId: "1", // CPSU — seeded first, sequentialId 1 (mirrors CN)
    coalitionId: null,
    coalitionPartyIds: null,
    totalSeatsSupporting: totalSeats,
    majorityThreshold,
    seatsByParty: {},
    totalSeats,
    activeVoteId: null,
    formedAt: hasPremier ? now : null,
    formedTurn: hasPremier ? 1 : null,
    collapsedAt: null,
    // Seeded NPC Chairman of the Presidium (4b: legislature-appointment flow
    // replaces him at each convocation; hosNppId parallels pmNppId).
    hosCharacterId: null,
    hosNppId: chairman?.nppId ?? null,
    hosName: chairman?.characterName ?? null,
  };
}
