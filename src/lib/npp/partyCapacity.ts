import type { Db, ObjectId } from "mongodb";
import type { ActivityLog, Character, User } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * NPP slots each active member adds, with gentle diminishing returns. Small
 * parties get the full 5 per member; larger parties keep growing at a slower
 * rate so one player cannot field an army. Tiers apply in order: `upTo` is the
 * last member count in a tier.
 */
export const NPP_CAPACITY_TIERS: ReadonlyArray<{ upTo: number; slotsPerMember: number }> = [
  { upTo: 5, slotsPerMember: 5 },
  { upTo: 10, slotsPerMember: 4 },
  { upTo: 20, slotsPerMember: 3 },
  { upTo: Number.POSITIVE_INFINITY, slotsPerMember: 2 },
];
/**
 * The party-wide ceiling scales with the size of the country, so a big party in
 * the US is not held to the same total as one in a 12-region country.
 */
export const NPP_CEILING_PER_REGION = 6;
/** No country's ceiling falls below this, so small countries keep today's limit. */
export const NPP_CEILING_FLOOR = 25;
/** Activity must be recent enough to count toward NPP capacity. */
export const NPP_ACTIVE_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** A member needs more than a login or a single click to support NPP capacity. */
export const NPP_ACTIVE_MEMBER_MIN_ACTIONS = 2;

export interface PartyNppCapacity {
  activeMemberCount: number;
  maxNpps: number;
  /** Country-scaled ceiling the member-based capacity is clamped to. */
  ceiling: number;
}

export function calculateNppCeiling(regionCount: number): number {
  return Math.max(NPP_CEILING_FLOOR, Math.max(0, Math.floor(regionCount)) * NPP_CEILING_PER_REGION);
}

export function calculatePartyNppCapacity(
  activeMemberCount: number,
  ceiling = Number.POSITIVE_INFINITY
): number {
  const members = Math.max(0, Math.floor(activeMemberCount));
  let capacity = 0;
  let counted = 0;
  for (const tier of NPP_CAPACITY_TIERS) {
    if (counted >= members) break;
    const inTier = Math.min(members, tier.upTo) - counted;
    capacity += inTier * tier.slotsPerMember;
    counted += inTier;
  }
  return Math.min(capacity, ceiling);
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
  const [members, regionCount] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ countryId, party: partyId }, { projection: { userId: 1 } })
      .project<Pick<Character, "userId">>({ userId: 1 })
      .toArray(),
    db.collection("states").countDocuments({ countryId }),
  ]);
  const ceiling = calculateNppCeiling(regionCount);

  const userIds = [
    ...new Map(members.map((member) => [member.userId.toString(), member.userId])).values(),
  ];
  if (userIds.length === 0) {
    return { activeMemberCount: 0, maxNpps: 0, ceiling };
  }

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds }, isBanned: { $ne: true } }, { projection: { _id: 1 } })
    .project<Pick<User, "_id">>({ _id: 1 })
    .toArray();
  const eligibleUserIds = users.map((user) => user._id);
  if (eligibleUserIds.length === 0) {
    return { activeMemberCount: 0, maxNpps: 0, ceiling };
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
    maxNpps: calculatePartyNppCapacity(activeMembers.length, ceiling),
    ceiling,
  };
}

export function partyNppCapacityError(
  capacity: PartyNppCapacity,
  partyNppCount: number
): string | null {
  if (partyNppCount < capacity.maxNpps) return null;
  return `Party NPP capacity reached (${partyNppCount}/${capacity.maxNpps}). Capacity is 5 NPPs for each of the first 5 active members, 4 each for the next 5, 3 each up to 20, then 2 each, up to ${capacity.ceiling} in this country (${NPP_CEILING_PER_REGION} per region, at least ${NPP_CEILING_FLOOR}); active members need 2 game actions in the last 14 days.`;
}
