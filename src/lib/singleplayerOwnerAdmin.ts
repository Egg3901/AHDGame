import type { Db } from "mongodb";

/**
 * Singleplayer world-owner admin. A local world's first account owns the
 * machine it runs on, so it carries admin in the DB record — the same grant
 * authority the hardening invariant ("DB account record is the sole grant
 * authority") already trusts. Multiplayer is untouched: both entry points
 * require singleplayer mode, so the shared server's ADMIN_REGISTRATION_KEY
 * path stays the only way up there.
 */
export function shouldGrantOwnerAdminOnRegister(args: {
  singleplayer: boolean;
  existingUserCount: number;
}): boolean {
  return args.singleplayer && args.existingUserCount === 0;
}

export async function promoteSingleplayerOwnerIfNoAdmin(
  db: Db
): Promise<{ promoted: boolean; userId?: string }> {
  const users = db.collection("users");
  const adminCount = await users.countDocuments({ isAdmin: true });
  if (adminCount > 0) return { promoted: false };
  const earliest = await users.findOne({}, { sort: { createdAt: 1 }, projection: { _id: 1 } });
  if (!earliest) return { promoted: false };
  // isAdmin only: role stays "player" so gameplay is unaffected, mirroring
  // the register route which stores role "player" alongside the admin flag.
  await users.updateOne({ _id: earliest._id }, { $set: { isAdmin: true, updatedAt: new Date() } });
  return { promoted: true, userId: String(earliest._id) };
}
