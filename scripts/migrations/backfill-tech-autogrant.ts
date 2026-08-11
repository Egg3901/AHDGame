/**
 * Migration: backfill auto-granted Corporate tech tree nodes.
 *
 * Late-era worlds (and corps founded before the v2 tech tree shipped) should
 * already own every Corporate-lane node of the decades that have already
 * passed. This grants those nodes (free) and commits the passed decades to the
 * "generic" lane. Idempotent — only adds what's missing.
 *
 * Run: railway run --service "Main Site" npx tsx scripts/migrations/backfill-tech-autogrant.ts
 */
import { connectDb, closeDb } from "../utils/db";
import type { Corporation, GameState } from "@/lib/db/types";
import { autoGrantedCorporateNodeIds, getPassedDecadeIds } from "@/lib/constants/techTree";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

async function main() {
  const db = await connectDb();
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

  const currentTurn = gameState?.currentTurn ?? 0;
  const startingYear = gameState?.startingYear ?? STARTING_YEAR;
  const currentYear =
    gameState?.currentYear ??
    startingYear + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);

  const grantIds = autoGrantedCorporateNodeIds(currentYear);
  const passedDecades = getPassedDecadeIds(currentYear);
  console.log(
    `[backfill-tech-autogrant] currentYear=${currentYear} → ${grantIds.length} corporate nodes across ${passedDecades.length} passed decades`
  );
  if (grantIds.length === 0) {
    console.log("[backfill-tech-autogrant] nothing to grant for this era. Done.");
    await closeDb();
    return;
  }

  const laneSet: Record<string, "generic"> = {};
  for (const d of passedDecades) laneSet[`techDecadeLane.${d}`] = "generic";

  const corps = await db
    .collection<Corporation>("corporations")
    .find({}, { projection: { _id: 1, unlockedTechNodeIds: 1, techDecadeLane: 1 } })
    .toArray();

  let updated = 0;
  for (const corp of corps) {
    const owned = new Set(corp.unlockedTechNodeIds ?? []);
    const missing = grantIds.filter((id) => !owned.has(id));
    const laneMissing = passedDecades.some((d) => (corp.techDecadeLane ?? {})[d] !== "generic");
    if (missing.length === 0 && !laneMissing) continue;

    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $addToSet: { unlockedTechNodeIds: { $each: grantIds } },
        $set: { ...laneSet, updatedAt: new Date() },
      }
    );
    updated++;
  }

  console.log(`[backfill-tech-autogrant] updated ${updated}/${corps.length} corporations. Done.`);
  await closeDb();
}

main().catch((err) => {
  console.error("[backfill-tech-autogrant] failed:", err);
  process.exit(1);
});
