import type { Db, ObjectId } from "mongodb";
import type { ActivityLog, Character, User } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/** Each currently active player supports this many party NPPs. */
export const NPP_SLOTS_PER_ACTIVE_MEMBER = 5;
/** No party may recruit above this total, regardless of its membership size. */
export const PARTY_NPP_HARD_CAP = 25;
/** Activity must be recent enough to count toward NPP capacity. */
export const NPP_ACTIVE_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** A member needs more than a login or a single click to support NPP capacity. */
export const NPP_ACTIVE_MEMBER_MIN_ACTIONS = 2;

export interface PartyNppCapacity {
  activeMemberCount: number;
  maxNpps: number;
}

export function calculatePartyNppCapacity(activeMemberCount: number): number {
  return Math.min(PARTY_NPP_HARD_CAP, Math.max(0, activeMemberCount) * NPP_SLOTS_PER_ACTIVE_MEMBER);
}

/**
 * Counts non-banned members with at least two meaningful game actions in the
 * preceding 14 days. Turn summaries contribute their number of AP actions;
 * direct game-action audit rows contribute one action each.
 */
export async function getPartyNppCapacity(
  db: Db,
  countryId: CountryId,
  partyId: string,
  now = new Date()
): Promise<PartyNppCapacity> {
  const members = await db
    .collection<Character>("characters")
    .find({ countryId, party: partyId }, { projection: { userId: 1 } })
    .project<Pick<Character, "userId">>({ userId: 1 })
    .toArray();

  const userIds = [
    ...new Map(members.map((member) => [member.userId.toString(), member.userId])).values(),
  ];
  if (userIds.length === 0) {
    return { activeMemberCount: 0, maxNpps: 0 };
  }

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds }, isBanned: { $ne: true } }, { projection: { _id: 1 } })
    .project<Pick<User, "_id">>({ _id: 1 })
    .toArray();
  const eligibleUserIds = users.map((user) => user._id);
  if (eligibleUserIds.length === 0) {
    return { activeMemberCount: 0, maxNpps: 0 };
  }

  const cutoff = new Date(now.getTime() - NPP_ACTIVE_MEMBER_WINDOW_MS);
  const activeMembers = await db
    .collection<ActivityLog>("activityLog")
    .aggregate<{ _id: ObjectId }>([
      {
        $match: {
          userId: { $in: eligibleUserIds },
          countryId,
          timestamp: { $gte: cutoff },
          type: { $in: ["game_action", "turn_summary"] },
        },
      },
      {
        $project: {
          userId: 1,
          actionCount: {
            $cond: [
              { $eq: ["$type", "turn_summary"] },
              { $size: { $ifNull: ["$actions", []] } },
              1,
            ],
          },
        },
      },
      { $match: { actionCount: { $gt: 0 } } },
      { $group: { _id: "$userId", actionCount: { $sum: "$actionCount" } } },
      { $match: { actionCount: { $gte: NPP_ACTIVE_MEMBER_MIN_ACTIONS } } },
    ])
    .toArray();

  return {
    activeMemberCount: activeMembers.length,
    maxNpps: calculatePartyNppCapacity(activeMembers.length),
  };
}

export function partyNppCapacityError(
  capacity: PartyNppCapacity,
  partyNppCount: number
): string | null {
  if (partyNppCount < capacity.maxNpps) return null;
  return `Party NPP capacity reached (${partyNppCount}/${capacity.maxNpps}). Capacity is 5 NPPs per active member, up to ${PARTY_NPP_HARD_CAP}; active members need 2 game actions in the last 14 days.`;
}
