/**
 * One-shot alt-detection compute pass (forensics/alt-detection rework plan
 * §3.2/§6, Phase 6 T6.1 — this is T9.2 "alt first-pass compute script"
 * pulled forward since it's a natural companion to `src/lib/altDetection/run.ts`).
 *
 * Runs the SAME pipeline as the hourly cron (`src/lib/cron.ts` `altScoringCron`,
 * `runAltScoring`) as a manual one-shot, so `altLinks`/`altClusters` are
 * already populated the moment `gameConfig.altScoringEnabled` is flipped on —
 * otherwise the Alts admin view / `alt_ring_audit` MCP tool are empty until
 * the next :45 cron tick. Passes `force: true` so it computes even while the
 * flag is still OFF (the whole point of a pre-flip backfill).
 *
 * DRY-RUN BY DEFAULT: computes candidates/links/clusters and reports what
 * WOULD be written, but does not touch `altLinks`/`altClusters` unless
 * `--apply` is passed. Uses `directConnection=true` (standalone Mongo
 * replica set — see ops-knowledge "AHD standalone Mongo = no txns"; without
 * it the driver's topology discovery can hang against a single-node rs0).
 *
 * Run:
 *   npx tsx scripts/run-alt-scoring-once.mjs                  # preview (no writes)
 *   npx tsx scripts/run-alt-scoring-once.mjs --apply           # write altLinks/altClusters
 *   npx tsx scripts/run-alt-scoring-once.mjs --reset --apply   # clear then rebuild matches
 *   railway run --service "Main Site" npx tsx scripts/run-alt-scoring-once.mjs --apply
 *
 * Must be run via `tsx` (not plain `node`) — it imports the real scoring
 * pipeline from `src/lib/altDetection/run.ts` via the `@/*` path alias,
 * which only `tsx`/Next resolve. Mirrors `scripts/bootstrap-full.ts`'s
 * `@/lib/...` import pattern for standalone scripts.
 */

const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset");

const MONGO_URL = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGO_URL) {
  throw new Error("Set MONGODB_URI (or MONGO_URL) before running this script.");
}
const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB_NAME || undefined;

function withDirectConnection(uri) {
  if (uri.includes("directConnection=")) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`;
}

// Normalize MONGODB_URI in-process BEFORE the dynamic imports below run, so
// any internal `getDb()` call inside the scoring pipeline (e.g.
// `isAltScoringEnabled()`'s own flag lookup) resolves through the same
// direct-connection URI as this script's own client, rather than racing a
// second, differently-configured connection attempt.
const directUri = withDirectConnection(MONGO_URL);
process.env.MONGODB_URI = directUri;

const { MongoClient } = await import("mongodb");
const { runAltScoring } = await import("../src/lib/altDetection/run.ts");

const client = new MongoClient(directUri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db(DB_NAME);

console.log(
  `DB: ${db.databaseName} | mode=${APPLY ? "APPLY" : "DRY-RUN"}${RESET ? " | reset=true" : ""}`
);
console.log(`Mongo: ${directUri.replace(/\/\/[^@]*@/, "//***:***@")}\n`);

try {
  if (RESET) {
    const [links, clusters] = await Promise.all([
      db.collection("altLinks").countDocuments({}),
      db.collection("altClusters").countDocuments({}),
    ]);
    if (APPLY) {
      await Promise.all([
        db.collection("altLinks").deleteMany({}),
        db.collection("altClusters").deleteMany({}),
      ]);
      console.log(`Reset: deleted ${links} links and ${clusters} clusters before recompute.\n`);
    } else {
      console.log(
        `Reset preview: would delete ${links} links and ${clusters} clusters before recompute.\n`
      );
    }
  }

  const result = await runAltScoring(db, { dryRun: !APPLY, force: true });

  console.log("Result:");
  console.log(`  gameConfig.altScoringEnabled: ${result.enabled}`);
  console.log(`  candidates considered:        ${result.candidateCount}`);
  console.log(
    `  links:    ${result.linksComputed} computed, ${result.linksWritten} ${APPLY ? "written" : "would be written"}`
  );
  console.log(
    `  clusters: ${result.clustersComputed} computed, ${result.clustersWritten} ${
      APPLY ? "written" : "would be written"
    } (${result.clustersOpened} ${APPLY ? "newly opened" : "would be newly opened"})`
  );
  console.log(`  duration: ${result.durationMs}ms`);
  if (result.error) {
    console.error(`  error: ${result.error}`);
    process.exitCode = 1;
  }

  if (!APPLY) {
    console.log(
      "\nDry run only — altLinks/altClusters were NOT written. Re-run with --apply to persist."
    );
  } else if (!result.enabled) {
    console.log(
      "\nNote: gameConfig.altScoringEnabled is currently OFF. This run wrote data anyway " +
        "(--apply + the one-shot's force mode), but the hourly cron will stay a no-op until " +
        "an admin flips the flag via /api/admin/config."
    );
  }
} finally {
  await client.close();
}
