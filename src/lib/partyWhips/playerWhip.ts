import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { Character, ElectedOfficial, User } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

/**
 * Returns characterIds of seated, non-NPP, non-banned party members eligible
 * to be Player-Whipped in the given chamber.
 *
 * Banned-user filtering matches CLAUDE.md's banned-user policy: banned
 * accounts never receive whips and never have their votes touched.
 */
export async function getEligibleCharactersForWhip(
  db: Db,
  countryId: CountryId,
  partyId: string,
  chamber: string
): Promise<ObjectId[]> {
  // Resolve the chamber key to the office type seated members are stored under.
  // For most countries these are identical; CN is the exception (chamber key
  // "npc" vs office type "npcDelegate"), so querying by the raw key would match
  // zero delegates and silently whip nobody.
  const officeType = getOfficeTypeForChamber(countryId, chamber);
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      isNPP: false,
      party: partyId,
      officeType,
      countryId,
    })
    .toArray();

  if (officials.length === 0) return [];

  const characterIds = officials
    .map((o) => o.characterId)
    .filter((id): id is ObjectId => id != null);

  if (characterIds.length === 0) return [];

  // Resolve characters → users so we can filter out banned users.
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const userIdsByChar = new Map(characters.map((c) => [c._id.toString(), c.userId]));
  const userIds = Array.from(new Set(characters.map((c) => c.userId.toString()))).map(
    (s) => characters.find((c) => c.userId.toString() === s)!.userId
  );

  const bannedUsers = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds }, isBanned: true })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const bannedUserIds = new Set(bannedUsers.map((u) => u._id.toString()));

  return characterIds.filter((charId) => {
    const userId = userIdsByChar.get(charId.toString());
    if (!userId) return false;
    return !bannedUserIds.has(userId.toString());
  });
}
