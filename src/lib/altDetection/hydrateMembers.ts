// Batch-hydrate alt-cluster members with the fields the bounty-board UI
// needs: in-game character (name / avatar / profile href), Discord identity
// and snowflake age, plus the peek-card identity (email / IP / tracking
// cookie). Callers (ranked list + cluster detail) must not N+1.
//
// `revealNetwork` is admin-only. Moderators get masked IPs, a masked email,
// and no tracking cookie — same split as the Users / dossier surfaces.

import type { Db, ObjectId } from "mongodb";
import type { Character, User } from "@/lib/db/types";
import { discordCreatedAtFromSnowflake, getDiscordAvatarUrl } from "@/lib/discord";
import { maskEmail, maskIp } from "@/lib/altDetection/signals";

export interface HydratedAltMember {
  userId: string;
  name: string | null;
  banned: boolean;
  characterName: string | null;
  characterId: string | null;
  sequentialId: number | null;
  avatarUrl: string | null;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  discordCreatedAt: string | null;
  email: string | null;
  lastKnownIp: string | null;
  registrationIp: string | null;
  trackingId: string | null;
}

export interface HydrateAltMembersOpts {
  /** Un-redacted email / IP / tracking cookie. Admins only. */
  revealNetwork?: boolean;
}

const USER_PROJECTION = {
  username: 1,
  isBanned: 1,
  email: 1,
  lastKnownIp: 1,
  registrationIp: 1,
  trackingId: 1,
  discordId: 1,
  discordUsername: 1,
  discordAvatar: 1,
  activeCharacterId: 1,
} as const;

const CHARACTER_PROJECTION = {
  userId: 1,
  name: 1,
  avatarUrl: 1,
  sequentialId: 1,
} as const;

export function emptyAltMember(userId: string): HydratedAltMember {
  return {
    userId,
    name: null,
    banned: false,
    characterName: null,
    characterId: null,
    sequentialId: null,
    avatarUrl: null,
    discordId: null,
    discordUsername: null,
    discordAvatar: null,
    discordCreatedAt: null,
    email: null,
    lastKnownIp: null,
    registrationIp: null,
    trackingId: null,
  };
}

function pickCharacter(
  user: Pick<User, "_id" | "activeCharacterId">,
  chars: Character[]
): Character | undefined {
  if (user.activeCharacterId) {
    const active = chars.find((c) => c._id.equals(user.activeCharacterId!));
    if (active) return active;
  }
  return chars[0];
}

function toHydrated(
  user: User,
  character: Character | undefined,
  revealNetwork: boolean
): HydratedAltMember {
  const discordId = user.discordId ?? null;
  const discordAvatar = user.discordAvatar ?? null;
  const created = discordId ? discordCreatedAtFromSnowflake(discordId) : null;
  const characterAvatar = character?.avatarUrl?.trim() || null;
  const discordPfp =
    discordId && !characterAvatar ? getDiscordAvatarUrl(discordId, discordAvatar) : null;

  const email = user.email ?? null;
  const lastKnownIp = user.lastKnownIp ?? null;
  const registrationIp = user.registrationIp ?? null;
  const trackingId = user.trackingId ?? null;

  return {
    userId: user._id.toString(),
    name: user.username ?? null,
    banned: user.isBanned ?? false,
    characterName: character?.name ?? null,
    characterId: character?._id?.toString() ?? null,
    sequentialId: typeof character?.sequentialId === "number" ? character.sequentialId : null,
    avatarUrl: characterAvatar ?? discordPfp,
    discordId,
    discordUsername: user.discordUsername ?? null,
    discordAvatar,
    discordCreatedAt: created ? created.toISOString() : null,
    email: email ? (revealNetwork ? email : maskEmail(email)) : null,
    lastKnownIp: lastKnownIp ? (revealNetwork ? lastKnownIp : maskIp(lastKnownIp)) : null,
    registrationIp: registrationIp
      ? revealNetwork
        ? registrationIp
        : maskIp(registrationIp)
      : null,
    trackingId: revealNetwork ? trackingId : null,
  };
}

/**
 * Hydrate a set of user ids into bounty-board member rows. Missing users still
 * get a stub row keyed by id so the cluster roster never has holes.
 */
export async function hydrateAltMembers(
  db: Db,
  userIds: ObjectId[],
  opts: HydrateAltMembersOpts = {}
): Promise<Map<string, HydratedAltMember>> {
  const out = new Map<string, HydratedAltMember>();
  if (userIds.length === 0) return out;

  const revealNetwork = opts.revealNetwork === true;
  const unique = [...new Map(userIds.map((id) => [id.toString(), id])).values()];

  const [users, characters] = await Promise.all([
    db
      .collection<User>("users")
      .find({ _id: { $in: unique } }, { projection: USER_PROJECTION })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({ userId: { $in: unique } }, { projection: CHARACTER_PROJECTION })
      .toArray(),
  ]);

  const charsByUser = new Map<string, Character[]>();
  for (const char of characters) {
    const key = char.userId.toString();
    const list = charsByUser.get(key);
    if (list) list.push(char);
    else charsByUser.set(key, [char]);
  }

  for (const user of users) {
    const chars = charsByUser.get(user._id.toString()) ?? [];
    out.set(user._id.toString(), toHydrated(user, pickCharacter(user, chars), revealNetwork));
  }

  for (const id of unique) {
    const key = id.toString();
    if (!out.has(key)) out.set(key, emptyAltMember(key));
  }

  return out;
}
