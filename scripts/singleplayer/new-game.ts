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
import { isLocalMongoUri } from "@/lib/singleplayer";
import { ensureSingleplayerUser } from "@/lib/singleplayerServer";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  if (!isLocalMongoUri(uri)) {
    throw new Error(
      `Refusing to run: MONGODB_URI does not point at this machine (${uri || "unset"}). ` +
        `Singleplayer setup only ever writes to a local database.`
    );
  }
  const displayName = argValue("--display-name") ?? "Player";
  const db = await connectDb();
  const { created } = await ensureSingleplayerUser(db, displayName);
  console.log(
    created
      ? `Created local player "${displayName}". Start the app and it will take you to character creation.`
      : "Local player already exists. Nothing to do."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
