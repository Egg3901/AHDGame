import type { Db } from "mongodb";
import type { ContestRound } from "@/lib/db/types/contestRound";

export const CONTEST_ROUNDS_COLLECTION = "contestRounds";

export function getContestRoundsCollection(db: Db) {
  return db.collection<ContestRound>(CONTEST_ROUNDS_COLLECTION);
}
