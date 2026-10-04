import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getCountryConfig } from "@/lib/constants/countries";

/** Open the 1991 Czechoslovak federal parliamentary formation cycle. */
export async function seedCSGovernmentFormation1991(
  db: Db,
  log: (msg: string) => void,
  preset: string
) {
  if (preset !== "1991-default") return;
  const config = getCountryConfig("CS", preset);
  const now = new Date();
  const formation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
    _id: "CS",
    countryId: "CS",
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
      { _id: "CS" },
      { $set: { ...formation, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  log("Seeded CS 1991 government formation document (pending)");
}
