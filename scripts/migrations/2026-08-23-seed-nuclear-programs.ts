/**
 * Live-world migration: seed historical nuclear programmes for the capable
 * cold-war powers (US, RU, UK) at the world's current game year.
 *
 * Delegates to the same seedNuclearPrograms helper the core seed pipeline
 * uses, which skips any country whose nuclearPrograms doc already has adopted
 * nodes: live player progress is never clobbered; re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-23-seed-nuclear-programs.ts
 */

import { connectDb, closeDb } from "../utils/db";
import { resolveGameYear } from "../../src/lib/era/era";
import { seedNuclearPrograms } from "../../src/lib/admin/seed/seedNuclearPrograms";

async function main() {
  const db = await connectDb();
  try {
    const gs = await db.collection("gameState").findOne<{
      currentYear?: number;
      currentTurn?: number;
      startingYear?: number;
    }>({ _id: "current" as never });
    if (!gs) throw new Error("gameState doc _id:'current' not found");
    const year = resolveGameYear(gs);
    if (year == null) throw new Error("could not resolve game year from gameState");

    console.log(`Resolved live game year: ${year}`);
    const result = await seedNuclearPrograms(db, { year });
    console.log(
      `nuclearPrograms seeded=[${result.seeded.join(", ") || "(none)"}] ` +
        `skipped (already had adopted nodes)=[${result.skipped.join(", ") || "(none)"}]`
    );
    for (const countryId of result.seeded) {
      const doc = await db.collection("nuclearPrograms").findOne({ _id: countryId as never });
      console.log(
        `  ${countryId}: warheads=${doc?.warheads}, nodes=${Object.keys(doc?.adopted ?? {}).join(", ")}`
      );
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
