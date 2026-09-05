/**
 * Provision the local player for a singleplayer world.
 *
 * A singleplayer world still has a real user document: every downstream
 * lookup (character ownership, treasury, actions, audit) keys off it. What
 * singleplayer removes is the negotiation, not the record. So this writes
 * exactly one user, under the fixed id `verifyAuth` hands out, and leaves
 * character creation to the game's own /create-character flow.
 *
 * The password field is deliberately unusable rather than absent: the schema
 * requires it, and no login path exists in singleplayer to check it against.
 *
 * Usage, from a worktree with a local .env.local:
 *   npx tsx scripts/singleplayer/new-game.ts [--display-name "Name"]
 */

import { connectDb, closeDb } from "../utils/db";
import { SINGLEPLAYER_USER_ID, isLocalMongoUri } from "@/lib/singleplayer";
import { ObjectId } from "mongodb";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  // The same rule the runtime enforces. A new-game script that can reach a
  // shared cluster would write a fixed-id user into somebody else's world.
  if (!isLocalMongoUri(uri)) {
    throw new Error(
      `Refusing to run: MONGODB_URI does not point at this machine (${uri || "unset"}). ` +
        `Singleplayer setup only ever writes to a local database.`
    );
  }

  const displayName = argValue("--display-name") ?? "Player";
  const db = await connectDb();
  const users = db.collection("users");
  const _id = new ObjectId(SINGLEPLAYER_USER_ID);
  const now = new Date();

  const existing = await users.findOne({ _id });
  if (existing) {
    console.log(`Local player already exists (${existing.username}). Nothing to do.`);
    return;
  }

  await users.insertOne({
    _id,
    email: "player@localhost",
    username: "player",
    displayName,
    // Not a hash of anything. Singleplayer has no login path that reads it.
    password: "!singleplayer-no-login",
    role: "player",
    isAdmin: false,
    hasCompletedSetup: false,
    createdAt: now,
    updatedAt: now,
    lastLogin: now,
    lastActivity: now,
  });

  console.log(`Created local player "${displayName}" (${SINGLEPLAYER_USER_ID}).`);
  console.log(`Start the app and it will take you to character creation.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
