/**
 * One-shot repair for the second forex-deploy lag:
 *
 *   Turns 85, 86, 87 processed against the pre-f858cdc0 code (share price
 *   formula that multiplied income/NPV by FX, storing sharePrice in local
 *   currency). Vercel hadn't finished deploying the corrected formula by
 *   the time cron fired those turns, so their history snapshots are mixed-
 *   unit / JPY-scale for the migrated corps.
 *
 *   We also ran restore-sharePrice-to-anchor *after* turn 85/86 had already
 *   polluted `corp.sharePrice`, so the live value is currently still in the
 *   inflated regime (momentum carrying the JPY multiplier).
 *
 * Phases:
 *   1. Delete turns 85, 86, 87 from every per-turn history collection.
 *   2. Forward-fill those three turn slots from the turn-82 baseline (flat
 *      across the transition window — visually honest, no synthetic prices).
 *   3. Reset `corporation.sharePrice` to ₳ for every migrated corp (divide
 *      by home-currency FX). Next turn processor run (turn 88) uses that
 *      ₳-scale prev and produces correct output from the first tick.
 *
 * Idempotent-safe to re-run; phase 3 divides by FX again though, so DON'T
 * re-run phase 3 if sharePrice is already in ₳.
 *
 * Run: npx tsx scripts/forex/repair-turns-85-87.ts [--dry-run]
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DRY_RUN = process.argv.includes("--dry-run");
const BAD_TURNS = [85, 86, 87];
const SEED_TURN = 82;

const HISTORY_COLLECTIONS = [
  { coll: "corporationHistory", keyFields: ["corporationId"] },
  { coll: "portfolioHistory", keyFields: ["characterId"] },
  { coll: "corporationPortfolioHistory", keyFields: ["corporationId"] },
  { coll: "marketCapHistory", keyFields: [] },
  { coll: "wealthListHistory", keyFields: ["exchange"] },
  { coll: "investorRankingSnapshots", keyFields: [] },
];

type AnyDoc = Record<string, unknown> & { _id?: ObjectId | string; turn: number };

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(
      `Dry run: ${DRY_RUN}  |  Overwriting turns: ${BAD_TURNS.join(", ")}  |  Seed turn: ${SEED_TURN}\n`
    );

    // ── Phase 1+2: delete + forward-fill ──────────────────────────────────────
    console.log("— Phase 1+2: overwrite turn 85/86/87 history with turn-82 flat copies —");
    for (const { coll } of HISTORY_COLLECTIONS) {
      const c = db.collection<AnyDoc>(coll);
      const sourceDocs = (await c.find({ turn: SEED_TURN }).toArray()) as unknown as AnyDoc[];
      if (sourceDocs.length === 0) {
        console.log(`  ${coll}: no source docs at turn ${SEED_TURN} — skipped`);
        continue;
      }

      for (const t of BAD_TURNS) {
        if (DRY_RUN) {
          const existing = await c.countDocuments({ turn: t });
          console.log(`  ${coll} turn ${t}: would delete ${existing}, insert ${sourceDocs.length}`);
          continue;
        }
        const delRes = await c.deleteMany({ turn: t });
        const inserts = sourceDocs.map((src) => {
          const clone: AnyDoc = { ...src, turn: t, createdAt: new Date() };
          delete clone._id;
          return clone;
        });
        const insRes =
          inserts.length > 0 ? await c.insertMany(inserts as unknown as AnyDoc[]) : null;
        console.log(
          `  ${coll} turn ${t}: deleted ${delRes.deletedCount}, inserted ${insRes?.insertedCount ?? 0}`
        );
      }
    }

    // ── Phase 3: reset corp.sharePrice to turn-82 value ───────────────────────
    // This gives the next turn processor a clean ₳-scale `prev` to work from,
    // matching the flat-filled history across the transition window.
    console.log("\n— Phase 3: reset sharePrice to turn-82 history value —");
    const corps = (await db
      .collection<{
        _id: ObjectId;
        name: string;
        countryId: string;
        sharePrice?: number;
      }>("corporations")
      .find({})
      .toArray()) as unknown as {
      _id: ObjectId;
      name: string;
      countryId: string;
      sharePrice?: number;
    }[];

    type BulkOps = Parameters<ReturnType<typeof db.collection>["bulkWrite"]>[0];
    const ops: Array<BulkOps[number]> = [];

    for (const corp of corps) {
      const seed = (await db
        .collection<{ sharePrice?: number }>("corporationHistory")
        .findOne({ corporationId: corp._id, turn: SEED_TURN })) as { sharePrice?: number } | null;
      if (!seed?.sharePrice) continue;
      const oldPrice = corp.sharePrice ?? 0;
      if (Math.abs(seed.sharePrice - oldPrice) < 0.01) continue;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: { $set: { sharePrice: seed.sharePrice, updatedAt: new Date() } },
        },
      });
      console.log(
        `  ${corp.countryId} ${corp.name}: ${oldPrice.toFixed(2)} → ${seed.sharePrice.toFixed(2)} ₳ (turn-82 value)`
      );
    }

    if (DRY_RUN) {
      console.log(`\n${ops.length} corps would be updated (dry run).`);
    } else if (ops.length > 0) {
      const res = await db.collection("corporations").bulkWrite(ops);
      console.log(`\nWrote ${res.modifiedCount} sharePrice updates.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
