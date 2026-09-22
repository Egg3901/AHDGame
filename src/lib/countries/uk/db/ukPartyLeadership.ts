import type { Db } from "mongodb";
import type { UKPartyLeadership, LeadershipChallenge } from "@/lib/uk/leadership/leadershipTypes";

/** Per-party UK leadership-removal state (ticket #861). */
export function getUKPartyLeadershipCollection(db: Db) {
  return db.collection<UKPartyLeadership>("ukPartyLeadership");
}

/** Leadership challenges (letters/nominations + ballots) for UK parties. */
export function getUKLeadershipChallengesCollection(db: Db) {
  return db.collection<LeadershipChallenge>("ukLeadershipChallenges");
}
