/**
 * Backfill turn-based deadline mirrors for the Phase 4 wall-clock holdouts:
 *   - partyCharters: expiresOnTurn (from expiresAt),
 *                    founderReplacementDeadlineTurn (from founderReplacementDeadline)
 *   - ukCabinetCooldowns: cooldownUntilTurn (from cooldownUntil)
 *
 *   npx tsx scripts/backfill-charter-cabinet-turns.ts            # dry-run
 *   npx tsx scripts/backfill-charter-cabinet-turns.ts --apply    # write
 *
 * After the migration the server resolves these deadlines from the turn fields
 * (Dates kept for display + as a fallback for un-backfilled rows). New docs set
 * the turn fields at creation; this stamps in-flight rows that pre-date the
 * migration so they freeze on pause too. Idempotent: only fills missing turn
 * fields whose Date exists. Targets MONGODB_URI_LIVE (production).
 *
 *   turn = currentTurn + round((Date - effectiveNow) / MS_PER_TURN)
 *
 * effectiveNow = pausedAt ?? lastTurnProcessed (the game clock the Date was
 * anchored to; 1 turn = 1 game-hour).
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MS_PER_TURN = 60 * 60 * 1000;

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const gs = await db
      .collection<{
        _id: string;
        currentTurn: number;
        lastTurnProcessed: Date;
        pausedAt: Date | null;
      }>("gameState")
      .findOne({ _id: "current" });
    if (!gs) throw new Error("gameState/current not found");
    const currentTurn = gs.currentTurn;
    const effectiveNow = gs.pausedAt ? new Date(gs.pausedAt) : new Date(gs.lastTurnProcessed);
    console.log(
      `currentTurn=${currentTurn} effectiveNow=${effectiveNow.toISOString()} (${gs.pausedAt ? "paused" : "active"})`
    );

    const dateToTurn = (d: Date): number =>
      currentTurn + Math.round((new Date(d).getTime() - effectiveNow.getTime()) / MS_PER_TURN);

    let total = 0;

    // ── partyCharters ────────────────────────────────────────────────────────
    const charters = await db
      .collection<{
        _id: unknown;
        status: string;
        expiresAt?: Date | null;
        expiresOnTurn?: number | null;
        founderReplacementDeadline?: Date | null;
        founderReplacementDeadlineTurn?: number | null;
      }>("partyCharters")
      .find({
        status: { $in: ["draft", "pending-signatures", "founder-replacement"] },
        $or: [
          { expiresOnTurn: { $exists: false }, expiresAt: { $ne: null, $exists: true } },
          {
            founderReplacementDeadlineTurn: { $exists: false },
            founderReplacementDeadline: { $ne: null, $exists: true },
          },
        ],
      })
      .toArray();
    for (const c of charters) {
      const set: Record<string, number> = {};
      if (typeof c.expiresOnTurn !== "number" && c.expiresAt)
        set.expiresOnTurn = dateToTurn(c.expiresAt);
      if (typeof c.founderReplacementDeadlineTurn !== "number" && c.founderReplacementDeadline)
        set.founderReplacementDeadlineTurn = dateToTurn(c.founderReplacementDeadline);
      if (Object.keys(set).length === 0) continue;
      const parts = Object.entries(set)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`partyCharters ${String(c._id)} [${c.status}]: ${parts}`);
      total++;
      if (apply)
        await db.collection("partyCharters").updateOne({ _id: c._id as never }, { $set: set });
    }

    // ── ukCabinetCooldowns ───────────────────────────────────────────────────
    // Only still-active cooldowns matter; lapsed ones never gate again.
    const cooldowns = await db
      .collection<{ _id: unknown; cooldownUntil: Date; cooldownUntilTurn?: number }>(
        "ukCabinetCooldowns"
      )
      .find({ cooldownUntilTurn: { $exists: false }, cooldownUntil: { $gt: effectiveNow } })
      .toArray();
    for (const cd of cooldowns) {
      const cooldownUntilTurn = dateToTurn(cd.cooldownUntil);
      console.log(`ukCabinetCooldowns ${String(cd._id)}: cooldownUntilTurn=${cooldownUntilTurn}`);
      total++;
      if (apply)
        await db
          .collection("ukCabinetCooldowns")
          .updateOne({ _id: cd._id as never }, { $set: { cooldownUntilTurn } });
    }

    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"}: ${total} document(s)${apply ? " updated" : " would be updated"}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
