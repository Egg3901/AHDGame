/**
 * Finish the German reunification that half-executed on the live world at turn 539.
 *
 * WHAT WENT WRONG. The `reunification` peace term was dictated through the terms
 * route, which applies its term SYNCHRONOUSLY on the request. That term runs a
 * whole country merge: every region transferred one at a time, each transfer
 * recomputing the world's national metrics. East Berlin took about 4.6 seconds and
 * the request was killed early into Mecklenburg-Vorpommern. Because actuation used
 * to claim the reopen cooldown as its FIRST act, the half-done merge looked
 * finished to every sweep and nothing retried it.
 *
 * WHY THIS RUNS THE REAL PIPELINE. Everything below is the shipped code, called
 * from a machine that has no request timeout instead of from a web request. A
 * bespoke script that hand-wrote the remaining steps would be a second
 * implementation of the merge, and the one thing this world does not need is two
 * of those disagreeing. `actuateSettlementOutcome` is re-enterable as of the fix
 * this script ships alongside, so it RESUMES: regions already moved are skipped,
 * the party migration rebuilds its map from the `mergedFrom` stamps, and the fisc
 * block is gated on `mergedInto`.
 *
 * WHAT IT ALSO REPAIRS. The terms route stamps the war `resolved` BEFORE applying
 * the term and calls `resolveConflict` AFTER, so the death in between left the war
 * resolved with no victor, no `endTurn`, both rosters intact and none of the
 * cross-side truces written. Any of the sixteen belligerents could have
 * re-declared at once. That call is replayed here, after the merge, in the order
 * the route intended.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write. Run against MONGODB_URI_LIVE.
 */
import { MongoClient, type Db } from "mongodb";
import fs from "node:fs";
import { actuateSettlementOutcome } from "@/lib/settlement/actuate";
import { resolveConflict } from "@/lib/military/resolveConflict";
import { emitSettlementWire } from "@/lib/settlement/emitWire";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";

const CONFLICT_ID = "war_us_dd_415";
const APPLY = process.argv.includes("--apply");
/** The wire dispatch is a real announcement to players; opt in separately. */
const POST_WIRE = process.argv.includes("--wire");
/**
 * Drop an actuation lease this operator KNOWS is dead.
 *
 * The lease expires on its own after ten minutes, which is the right behaviour
 * for a process nobody watched. Pass this only when you saw the previous attempt
 * die — it exists so a heal does not have to sit and wait out a window whose
 * holder is provably gone, and never to muscle past a run that may still be live.
 */
const STEAL_LEASE = process.argv.includes("--steal-lease");

function liveUri(): string {
  const env = fs.readFileSync(".env.local", "utf8");
  const raw = (env.match(/^MONGODB_URI_LIVE=(.*)$/m) ?? [])[1]?.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error("MONGODB_URI_LIVE not found in .env.local");
  // Railway's Mongo needs a direct connection; a replica-set discovery hangs.
  return raw + (raw.includes("?") ? "&" : "?") + "directConnection=true";
}

/** A before/after picture of everything this heal is meant to move. */
async function snapshot(db: Db, label: string): Promise<void> {
  const crisis = await (await getSettlementCrisesCollection(db)).findOne({});
  const war = await getConflictsCollection(db).findOne({ _id: CONFLICT_ID });
  const ddRegions = await db.collection("states").countDocuments({ countryId: "DD" });
  const deRegions = await db.collection("states").countDocuments({ countryId: "DE" });
  const ddParties = await db.collection("politicalParties").countDocuments({ countryId: "DD" });
  const ddChars = await db.collection("characters").countDocuments({ countryId: "DD" });
  const ddGameState = await db.collection("countryGameStates").findOne({ _id: "DD" });
  const deState = await db.collection("countryState").findOne({ _id: "DE" });
  const deBudget = await db.collection("federalBudget").findOne({ _id: "DE" });
  const truces = await db.collection("truces").countDocuments({});

  console.log(`\n──────── ${label} ────────`);
  console.log(
    `crisis      status=${crisis?.status} outcome=${crisis?.outcome} ` +
      `completed=${crisis?.actuationCompletedTurn ?? "(unset)"} ` +
      `claimed=${crisis?.actuationClaimedAt ?? "(unset)"} cooldown=${crisis?.cooldownUntilTurn}`
  );
  console.log(
    `war         status=${war?.status} winner=${war?.outcome?.winner ?? "(none)"} ` +
      `endTurn=${war?.endTurn ?? "(none)"} sideA=${war?.sideA.countries.length} sideB=${war?.sideB.countries.length}`
  );
  console.log(`regions     DD=${ddRegions} DE=${deRegions}   (target: DD=0 DE=16)`);
  console.log(
    `DD          parties=${ddParties} characters=${ddChars} dissolvedTurn=${ddGameState?.dissolvedTurn ?? "(none)"}`
  );
  console.log(
    `DE          governmentType=${deState?.governmentType} rulingPartyId=${deState?.rulingPartyId} ` +
      `mergedInto=${deBudget?.mergedInto ? "yes" : "no"}`
  );
  console.log(`truces      ${truces}`);
}

async function main(): Promise<void> {
  const client = new MongoClient(liveUri());
  await client.connect();
  const db = client.db();

  try {
    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    console.log(`LIVE turn ${currentTurn}   mode: ${APPLY ? "APPLY (writing)" : "DRY RUN"}`);

    await snapshot(db, "BEFORE");

    const crises = await getSettlementCrisesCollection(db);
    const crisis = (await crises.findOne({
      kind: "settlement.germanQuestion",
    })) as SettlementCrisisDoc | null;
    if (!crisis) throw new Error("no German Question crisis found");
    if (crisis.status !== "resolved" || crisis.outcome !== "challenger") {
      throw new Error(`crisis is ${crisis.status}/${crisis.outcome}, refusing to touch it`);
    }
    if (crisis.actuationCompletedTurn != null) {
      console.log("\nAlready completed. Nothing to resume.");
      return;
    }

    if (!APPLY) {
      console.log(
        "\nDRY RUN. With --apply this would:\n" +
          "  1. resume actuateSettlementOutcome (moves DD's remaining regions, heals the\n" +
          "     Mecklenburg-Vorpommern tear, then runs the fisc/military/economy carries,\n" +
          "     the East Berlin fuse and the one-party install)\n" +
          `  2. replay resolveConflict(${CONFLICT_ID}, winner "B") to stamp the victor and\n` +
          "     write the cross-side truces the interrupted request never wrote\n" +
          (POST_WIRE
            ? "  3. post the settled dispatch to World News\n"
            : "  (wire post skipped; pass --wire to include it)\n")
      );
      return;
    }

    if (STEAL_LEASE && crisis.actuationClaimedAt) {
      console.log(`\nDropping a dead lease taken at ${crisis.actuationClaimedAt.toISOString()}`);
      await crises.updateOne({ _id: crisis._id }, { $set: { actuationClaimedAt: null } });
      crisis.actuationClaimedAt = null;
    }

    console.log("\n[1/2] resuming actuation…");
    const result = await actuateSettlementOutcome(db, crisis, currentTurn);
    console.log("      ", JSON.stringify(result));
    if (!result.actuated) {
      console.log("\nActuation did NOT complete. The claim has been released, so the next");
      console.log("turn tick will resume it. Not replaying resolveConflict against a");
      console.log("half-merged world. Re-run this script to try again.");
      await snapshot(db, "AFTER (incomplete)");
      return;
    }

    console.log("\n[2/2] replaying the war resolution the interrupted request never reached…");
    const war = await getConflictsCollection(db).findOne({ _id: CONFLICT_ID });
    if (!war) throw new Error(`conflict ${CONFLICT_ID} not found`);
    if (war.outcome?.winner) {
      console.log("       already stamped, skipping");
    } else {
      // "B" is the challenger roster, which `conflictSides` stamps on this crisis
      // and which the front reaching control 100 independently confirms.
      await resolveConflict(db, war, "B", currentTurn);
      console.log("       victor stamped, belligerents stood down, truces written");
    }

    if (POST_WIRE) {
      const fresh = (await crises.findOne({ _id: crisis._id })) as SettlementCrisisDoc;
      const wire = await emitSettlementWire(db, fresh, currentTurn, { events: ["settled"] });
      console.log(`\n       wire posts: ${wire.posts}`);
    }

    await snapshot(db, "AFTER");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
