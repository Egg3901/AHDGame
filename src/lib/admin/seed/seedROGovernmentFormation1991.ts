import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getCountryConfig } from "@/lib/constants/countries";

/** Open the 1991 constituent parliament's prime-minister formation cycle. */
export async function seedROGovernmentFormation1991(
  db: Db,
  log: (msg: string) => void,
  preset: string
) {
  if (preset !== "1991-default") return;
  const config = getCountryConfig("RO", preset);
  const now = new Date();
  const formation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
    _id: "RO",
    countryId: "RO",
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
    // The engine's formation vote counts the lower chamber. Historically the
    // 1990 decree submitted the government to both chambers for approval.
    majorityThreshold: config.coalitionThreshold,
    seatsByParty: {},
    totalSeats: config.legislature.lowerChamber.seats,
    activeVoteId: null,
    formedAt: null,
    formedTurn: null,
    collapsedAt: null,
  };
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id: "RO" },
      { $set: { ...formation, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  log("Seeded RO 1991 government formation document (pending)");
}
