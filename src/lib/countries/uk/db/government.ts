import type { Db } from "mongodb";
import type { UKGovernment } from "@/lib/db/types/ukGovernment";
import type { ConfidenceVote } from "@/lib/db/types/parliamentaryGovernment";
import type { UKCabinetCooldown } from "@/lib/db/types/ukCabinetCooldown";

export function getUKGovernmentCollection(db: Db) {
  return db.collection<UKGovernment>("ukGovernment");
}

/** Country-agnostic confidence vote collection for PM/Chancellor succession */
export function getConfidenceVotesCollection(db: Db) {
  return db.collection<ConfidenceVote>("confidenceVotes");
}

export function getUKCabinetCooldownsCollection(db: Db) {
  return db.collection<UKCabinetCooldown>("ukCabinetCooldowns");
}
