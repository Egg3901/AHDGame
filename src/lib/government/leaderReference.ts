/**
 * Government leader identity. Players and NPPs use distinct references and
 * leader-state keys, while the same confidence and legitimacy rules apply.
 */
import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type LeaderReference = ObjectId | { kind: "npp"; id: ObjectId };

export function leaderStateId(countryId: CountryId, leader: LeaderReference): string {
  return "kind" in leader
    ? `${countryId}_npp_${leader.id.toString()}`
    : `${countryId}_${leader.toString()}`;
}

export function leaderStateIdentity(leader: LeaderReference): {
  leaderCharacterId: ObjectId | null;
  leaderNppId?: ObjectId;
} {
  return "kind" in leader
    ? { leaderCharacterId: null, leaderNppId: leader.id }
    : { leaderCharacterId: leader };
}

export function governmentLeaderReference(
  government: {
    pmCharacterId?: ObjectId | null;
    pmNppId?: ObjectId | null;
  } | null
): LeaderReference | null {
  if (government?.pmCharacterId) return government.pmCharacterId;
  if (government?.pmNppId) return { kind: "npp", id: government.pmNppId };
  return null;
}

export function decisionLeaderReference(decision: {
  leaderCharacterId: ObjectId | null;
  leaderNppId?: ObjectId | null;
}): LeaderReference {
  if (decision.leaderCharacterId) return decision.leaderCharacterId;
  if (decision.leaderNppId) return { kind: "npp", id: decision.leaderNppId };
  throw new Error("The regime decision has no leader identity");
}
