/**
 * Grant Patreon tier to a user by username (manual ops; requires MONGODB_URI in .env.local).
 *
 * Usage:
 *   npx tsx scripts/grant-patreon-tier.ts <username> supporter|supporter-plus
 */
import { connectDb, closeDb } from "./utils/db";
import { applyPatreonStatus } from "../src/lib/patreon/service";
import type { PatreonTier, User } from "../src/lib/db/types";

const tierArg = process.argv[3];
const username = process.argv[2];

const VALID: PatreonTier[] = ["supporter", "supporter-plus"];

function usage(): void {
  console.error("Usage: npx tsx scripts/grant-patreon-tier.ts <username> supporter|supporter-plus");
}

async function main() {
  if (!username || !tierArg) {
    usage();
    process.exit(1);
  }
  if (!VALID.includes(tierArg as PatreonTier)) {
    console.error(`Invalid tier "${tierArg}". Use supporter or supporter-plus.`);
    process.exit(1);
  }

  const db = await connectDb();
  try {
    const user = await db.collection<User>("users").findOne({
      username: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
    if (!user) {
      console.error(`No user found with username: ${username}`);
      process.exit(1);
    }
    await applyPatreonStatus(db, {
      userId: user._id,
      tier: tierArg as Exclude<PatreonTier, null>,
      expiresAt: null,
      adsDisabledDefault: true,
    });
    console.log(`Updated ${user.username} (${user._id.toString()}) → ${tierArg}`);
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
