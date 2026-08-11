/**
 * Clear `lastRelocatedAt` on a character by display name (case-insensitive exact match).
 *
 * Usage: npx tsx scripts/reset-character-relocation-cooldown.ts "Arsene Kavioris"
 * Requires MONGODB_URI in .env.local (use production URI only when intentionally targeting live).
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const nameArg = process.argv.slice(2).join(" ").trim();
  if (!nameArg) {
    console.error('Usage: npx tsx scripts/reset-character-relocation-cooldown.ts "Character Name"');
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not found in .env.local");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    const escaped = nameArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = await db
      .collection<{ _id: unknown; name: string; lastRelocatedAt?: Date }>("characters")
      .find({ name: { $regex: new RegExp(`^${escaped}$`, "i") } })
      .project({ name: 1, lastRelocatedAt: 1 })
      .toArray();

    if (matches.length === 0) {
      console.error(`No character found with name matching: ${nameArg}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Multiple characters match "${nameArg}". Resolve manually:`);
      for (const m of matches) {
        console.error(`  - ${m.name} (${String(m._id)})`);
      }
      process.exit(1);
    }

    const doc = matches[0]!;
    const result = await db
      .collection("characters")
      .updateOne({ _id: doc._id }, { $unset: { lastRelocatedAt: "" } });

    console.log(
      result.modifiedCount > 0
        ? `Cleared lastRelocatedAt for "${doc.name}" (${String(doc._id)}).`
        : `No lastRelocatedAt field on "${doc.name}" — nothing to clear (matchedCount=${result.matchedCount}).`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
