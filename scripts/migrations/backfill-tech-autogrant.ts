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
import { autoGrantedNodeIds, getPassedDecadeIds } from "@/lib/constants/techTree";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

async function main() {
  const db = await connectDb();
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

  const currentTurn = gameState?.currentTurn ?? 0;
  const startingYear = gameState?.startingYear ?? STARTING_YEAR;
  const currentYear =
    gameState?.currentYear ??
    startingYear + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);

  const passedDecades = getPassedDecadeIds(currentYear);
  console.log(
    `[backfill-tech-autogrant] currentYear=${currentYear} → ${passedDecades.length} passed decades (baseline slots, both lanes, per corp type)`
  );
  if (passedDecades.length === 0) {
    console.log("[backfill-tech-autogrant] nothing to grant for this era. Done.");
    await closeDb();
    return;
  }

  const corps = await db
    .collection<Corporation>("corporations")
    .find({}, { projection: { _id: 1, type: 1, unlockedTechNodeIds: 1 } })
    .toArray();

  // Grant set depends on the corp's sector type (its sector lane differs).
  const grantIdsByType = new Map<string, string[]>();
  const grantsFor = (type: Corporation["type"]): string[] => {
    const cached = grantIdsByType.get(type);
    if (cached) return cached;
    const ids = autoGrantedNodeIds(type, currentYear);
    grantIdsByType.set(type, ids);
    return ids;
  };

  let updated = 0;
  for (const corp of corps) {
    const grantIds = grantsFor(corp.type);
    const owned = new Set(corp.unlockedTechNodeIds ?? []);
    const missing = grantIds.filter((id) => !owned.has(id));
    if (missing.length === 0) continue;

    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $addToSet: { unlockedTechNodeIds: { $each: missing } },
        $set: { updatedAt: new Date() },
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
