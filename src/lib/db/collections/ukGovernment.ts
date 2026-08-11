import type { Db } from "mongodb";
import type { UKGovernment } from "../types/ukGovernment";
import type { ConfidenceVote } from "../types/parliamentaryGovernment";
import type { UKCabinetCooldown } from "../types/ukCabinetCooldown";

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
