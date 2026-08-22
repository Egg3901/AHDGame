/**
 * Migration: backfill per-region board texture onto the live playable boards.
 *
 * Ticket #1129 / issue #704. Every US region's `residuals["order.safety"]` is
 * 51.5, and 47 of 63 US families are byte-identical across all 51 states,
 * because the playable seed branch replicated one NATIONAL value per region.
 * The seed is fixed; this applies the same deviations to a world already
 * running.
 *
 * WRITES TO `residuals`, NOT `values`. `composeTarget` builds the equilibrium
 * from `residuals` and `driftStep` walks `values` toward it, so moving the
 * residual lets the existing dynamics carry each region to its new equilibrium
 * over roughly 20 turns instead of lurching a 318-turn game.
 *
 * MODIFIES THE MAP IN PLACE - NEVER UNSETS IT, NEVER CREATES IT. The "§4 lazy
 * self-heal" in politicalMetricsDynamics.ts fires when `residuals` is absent and
 * adopts the doc's CURRENT values as permanent equilibrium. Removing the field
 * would bake the flatness in irreversibly, so a doc without residuals is skipped
 * rather than seeded.
 *
 * Idempotent: each migrated doc is stamped `textureBackfillTurn` and skipped on
 * a re-run.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-22-ticket-1129-playable-region-texture.ts [--apply] [--live]
 * Defaults to a dry run against MONGODB_URI (the TESTING database). `--live`
 * targets MONGODB_URI_LIVE.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import { REGIONAL_TEXTURE_1953 } from "../../src/lib/politicalMetrics/seeds/regionalTexture1953";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

export interface BackfillCounts {
  scanned: number;
  changed: number;
  skipped: number;
}

export interface BoardDoc {
  _id: string;
  countryId: string;
  residuals?: Record<string, number>;
  textureBackfillTurn?: number;
}

export interface BackfillOp {
  _id: string;
  /** The COMPLETE merged residuals map, to be $set whole. See below. */
  residuals: Record<string, number>;
  /** How many families the texture actually moved, for reporting. */
  touched: number;
}

/**
 * Plan the per-doc rewrite.
 *
 * Returns the WHOLE residuals map, not a dotted `$set` patch. `residuals` is
 * keyed by literal dotted family ids ("order.safety"), so
 * `$set: { "residuals.order.safety": v }` is read by Mongo as a NESTED path: it
 * creates `residuals: { order: { safety: v } }` and never touches the real key.
 * The write is silently lost and nothing errors. That failure has shipped three
 * times in this codebase and is now caught by the `local/no-dotted-board-path`
 * eslint rule, which caught this migration too. Merging in JS and $setting the
 * whole object is the sanctioned form for a multi-family write.
 */
export function planTextureBackfill(docs: BoardDoc[]): BackfillOp[] {
  const ops: BackfillOp[] = [];
  for (const doc of docs) {
    if (doc.textureBackfillTurn !== undefined) continue;
    if (!doc.residuals) continue; // never create the field; see the self-heal note
    const texture = (
      REGIONAL_TEXTURE_1953 as Record<string, Record<string, Record<string, number>>>
    )[doc.countryId]?.[doc._id];
    if (!texture) continue;

    const residuals: Record<string, number> = { ...doc.residuals };
    let touched = 0;
    for (const [family, deviation] of Object.entries(texture)) {
      const current = doc.residuals[family];
      // A family the live doc has no residual for is left alone rather than
      // invented: the deviation is meaningful only against an existing baseline.
      if (typeof current !== "number" || !Number.isFinite(current)) continue;
      residuals[family] = current + deviation;
      touched++;
    }
    if (touched > 0) ops.push({ _id: doc._id, residuals, touched });
  }
  return ops;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const live = process.argv.includes("--live");
  const uri = live ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error(`Missing ${live ? "MONGODB_URI_LIVE" : "MONGODB_URI"} in .env.local`);

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 30000,
    ...(live ? { directConnection: true } : {}),
  });
  await client.connect();
  const db = live ? client.db("a-house-divided") : client.db();
  console.log(`target: ${live ? "LIVE" : "testing"} | mode: ${apply ? "APPLY" : "dry run"}`);

  const gameState = await db.collection("gameState").findOne({});
  const currentTurn = (gameState?.currentTurn as number) ?? 0;
  console.log(`current turn: ${currentTurn}`);

  const docs = (await db
    .collection("politicalMetrics")
    .find({ countryId: { $in: Object.keys(REGIONAL_TEXTURE_1953) } })
    .toArray()) as unknown as BoardDoc[];

  const ops = planTextureBackfill(docs);
  const counts: BackfillCounts = {
    scanned: docs.length,
    changed: ops.length,
    skipped: docs.length - ops.length,
  };
  console.log(counts);

  const byCountry: Record<string, number> = {};
  for (const op of ops) {
    const country = docs.find((d) => d._id === op._id)?.countryId ?? "?";
    byCountry[country] = (byCountry[country] ?? 0) + 1;
  }
  console.log("changed by country:", byCountry);

  for (const op of ops.slice(0, 5)) {
    const before = docs.find((d) => d._id === op._id)?.residuals ?? {};
    const sample = Object.keys(op.residuals)
      .filter((f) => op.residuals[f] !== before[f])
      .slice(0, 3)
      .map((f) => `${f} ${before[f]?.toFixed(2)} -> ${op.residuals[f].toFixed(2)}`);
    console.log(` sample ${op._id} (${op.touched} families): ${sample.join(", ")}`);
  }

  if (!apply) {
    console.log("\nDry run - nothing written. Pass --apply to write.");
    await client.close();
    return;
  }

  // $set the WHOLE residuals map. Never a dotted "residuals.<family>" path -
  // those family ids contain literal dots and Mongo would read them as nesting.
  await db.collection("politicalMetrics").bulkWrite(
    ops.map((op) => ({
      updateOne: {
        filter: { _id: op._id as never },
        update: { $set: { residuals: op.residuals, textureBackfillTurn: currentTurn } },
      },
    }))
  );
  console.log(`applied ${ops.length} updates`);
  await client.close();
}

if (process.argv[1]?.includes("2026-08-22-ticket-1129")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
