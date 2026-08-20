/**
 * One-time corrective heal for the Vietnam escalation ladder, which raced ahead
 * of its historical arc before the earliestYear rung floor shipped. The live
 * world reached level 3 (Naval incident, 1964) by ~1957, roughly seven years
 * early, because rung climbs were gated only by support pressure and nothing
 * anchored a rung to its year.
 *
 * This clamps the ladder to the highest rung the current year actually allows
 * (advisors in 1957) and zeroes the accumulated support pressure so the next
 * pledge does not immediately re-climb. Money already spent (westSpend /
 * eastSpend) is left as sunk, by decision.
 *
 * Deliberately minimal: it does NOT touch crisis documents or re-open the chain.
 * The active rung crisis finishes on its own duration; when it expires the chain
 * reads the clamped ladder and spawns the matching lower rung. That avoids
 * re-firing the "war begins" wire into the live community. RUN ONLY AFTER the
 * earliestYear-gate code has deployed, so the ladder cannot re-escalate before
 * the calendar catches up.
 *
 * Target DB: MONGODB_URI in .env.local (Railway prod). The replica set advertises
 * internal hostnames, so append ?directConnection=true when running from the box.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-20-clamp-vietnam-ladder.ts           # dry-run
 *   npx tsx scripts/migrations/2026-08-20-clamp-vietnam-ladder.ts --apply   # writes
 */

import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  VIETNAM_ESCALATION_COLLECTION,
  VIETNAM_ESCALATION_ID,
  VIETNAM_RUNGS,
} from "../../src/lib/crises/vietnamEscalation";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");

/** Highest rung whose earliestYear has passed; at least 1 once the chain opened. */
function allowedLevelForYear(year: number): number {
  let level = 1;
  for (const rung of VIETNAM_RUNGS) {
    if (rung.earliestYear <= year) level = Math.max(level, rung.level);
  }
  return level;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db: Db = client.db();
    const gs = await db
      .collection<{ _id: string; currentYear?: number; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, currentTurn: 1 } });
    const year = gs?.currentYear;
    if (typeof year !== "number") throw new Error("gameState.currentYear missing");

    const ladder = await db
      .collection(VIETNAM_ESCALATION_COLLECTION)
      .findOne({ _id: VIETNAM_ESCALATION_ID });
    if (!ladder) {
      console.log("No vietnamEscalation doc; nothing to clamp.");
      return;
    }

    const target = allowedLevelForYear(year);
    console.log(`year=${year} currentLevel=${ladder.level} -> clampedLevel=${target}`);
    console.log(
      `support before: west=${ladder.westSupport} east=${ladder.eastSupport} warTurns=${ladder.warTurns}`
    );

    if (ladder.level <= target) {
      console.log("Ladder already at or below the year-allowed rung; no change.");
      return;
    }

    if (!APPLY) {
      console.log("DRY RUN: would set level, zero support/warTurns, keep spend. Pass --apply.");
      return;
    }

    await db
      .collection(VIETNAM_ESCALATION_COLLECTION)
      .updateOne(
        { _id: VIETNAM_ESCALATION_ID },
        {
          $set: {
            level: target,
            westSupport: 0,
            eastSupport: 0,
            warTurns: 0,
            updatedAt: new Date(),
          },
        }
      );
    console.log(`APPLIED: ladder clamped to level ${target}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
