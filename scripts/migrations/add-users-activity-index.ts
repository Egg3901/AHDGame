/**
 * Migration: Add index on users.lastActivity for /api/players/online
 *
 * The online players endpoint uses countDocuments({ lastActivity: { $gte: ... }, isBanned: { $ne: true } })
 * which was doing a full collection scan. This index enables efficient filtering by lastActivity.
 */

import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  console.log("Adding users.lastActivity index...\n");
  const db = await connectDb();

  try {
    await db
      .collection("users")
      .createIndex({ lastActivity: 1, isBanned: 1 }, { name: "users_lastActivity_isBanned" });
    console.log("✓ users.users_lastActivity_isBanned");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists")) {
      console.log("= users.users_lastActivity_isBanned (already exists)");
    } else {
      console.error("✗ users.users_lastActivity_isBanned:", msg);
      process.exit(1);
    }
  }

  await closeDb();
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
