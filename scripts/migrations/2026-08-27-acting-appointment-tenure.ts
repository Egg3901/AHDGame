/**
 * Give pre-existing acting cabinet members a tenure.
 *
 * Acting appointments shipped with no expiry at all. Rows written before this
 * change carry no `actingSinceTurn` or `actingExpiresOnTurn`, so the per-turn
 * sweep in `expireLapsedActingAppointments` would never match them and they
 * would sit in their seats forever.
 *
 * Each affected row is stamped as if seated on the current turn, giving it a
 * full ACTING_TENURE_TURNS from deploy. Deliberately generous: expiring them
 * immediately would vacate live seats the moment this ships, which is a worse
 * outcome for players than a slightly long first term.
 *
 * No charge rows are written, so every affected President keeps their
 * acting appointment for those seats. Also deliberate: charging players
 * retroactively for an appointment made under different rules is unfair.
 *
 * Baseline measured against production on 2026-08-27 (turn 436): 118 cabinet
 * members, **0** with `acting: true`, 0 existing charge rows. So this is
 * expected to be a no-op. It ships anyway because the legacy
 * `POST /api/whitehouse/cabinet/acting` endpoint stays reachable until this
 * work deploys, and a President may use it in the meantime.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/2026-08-27-acting-appointment-tenure.ts          # dry-run
 *   npx tsx scripts/migrations/2026-08-27-acting-appointment-tenure.ts --apply  # commit
 *
 * Rollback
 * --------
 *   Unset the two fields and drop the ledger:
 *     db.cabinetMembers.updateMany({}, { $unset: { actingSinceTurn: "", actingExpiresOnTurn: "" } })
 *     db.actingAppointmentCharges.drop()
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { ACTING_TENURE_TURNS } from "../../src/lib/cabinet/actingScope";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const rawUri = process.env.MONGODB_URI_LIVE;
if (!rawUri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
// The live Railway replica set is only reachable directly; without this the
// driver tries to resolve advertised hosts it cannot route to and the
// connection is refused.
const uri = rawUri.includes("directConnection")
  ? rawUri
  : rawUri + (rawUri.includes("?") ? "&" : "?") + "directConnection=true";
const APPLY = process.argv.includes("--apply");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db("a-house-divided");

    const gs = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = gs?.currentTurn;
    if (currentTurn == null) {
      throw new Error("gameState.currentTurn missing; refusing to stamp a tenure without a turn");
    }

    const filter = { acting: true, actingExpiresOnTurn: { $exists: false } };
    const affected = await db.collection("cabinetMembers").find(filter).toArray();

    console.log(`Current turn: ${currentTurn}`);
    console.log(`Acting members without a tenure: ${affected.length}`);
    for (const row of affected) {
      console.log(
        `  ${row.countryId} ${row.positionId} ${row.characterName ?? "?"} ` +
          `-> expires on turn ${currentTurn + ACTING_TENURE_TURNS}`
      );
    }

    if (affected.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    if (!APPLY) {
      console.log("\nDry run only. Re-run with --apply to write.");
      return;
    }

    const result = await db.collection("cabinetMembers").updateMany(filter, {
      $set: {
        actingSinceTurn: currentTurn,
        actingExpiresOnTurn: currentTurn + ACTING_TENURE_TURNS,
        updatedAt: new Date(),
      },
    });
    console.log(`\nStamped ${result.modifiedCount} acting members.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
