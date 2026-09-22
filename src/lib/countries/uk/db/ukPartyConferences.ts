import type { Db } from "mongodb";
import type { UKPartyConference } from "@/lib/uk/conference/types";
import type { UKPartyPlatform } from "@/lib/uk/conference/types";

/** Annual UK party-conference lifecycle rows (epic #856, ticket #862). */
export function getUKPartyConferencesCollection(db: Db) {
  return db.collection<UKPartyConference>("ukPartyConferences");
}

/** Ratified standing platforms, one row per UK party (ticket #862). */
export function getUKPartyPlatformsCollection(db: Db) {
  return db.collection<UKPartyPlatform>("ukPartyPlatforms");
}
