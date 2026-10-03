import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getCountryConfig } from "@/lib/constants/countries";

/** Open the 1991 Bulgarian Grand National Assembly formation cycle. */
export async function seedBGGovernmentFormation1991(
  db: Db,
  log: (message: string) => void,
  preset: string
): Promise<void> {
  if (preset !== "1991-default") return;
  const config = getCountryConfig("BG", preset);
  const now = new Date();
  const formation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
    _id: "BG",
    countryId: "BG",
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
      { _id: "BG" },
      { $set: { ...formation, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  log("Seeded BG 1991 government formation document (pending, 400 seats)");
}
