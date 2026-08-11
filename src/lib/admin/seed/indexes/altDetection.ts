import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/** How long `altScoringRuns` telemetry is retained, via the TTL index below.
 * 90 days is enough to see a seasonal trend and to answer "did that weight
 * change help?", without accumulating unbounded telemetry. Declared here
 * rather than in `src/lib/altDetection/runMetrics.ts` so the seed path does
 * not import that module (and with it Sentry and the Mongo client) purely to
 * read one number. */
const RUN_RECORD_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Indexes for the alt-detection weighted-evidence confidence model
 * (forensics/alt-detection rework plan §3.2). `altLinks` is a pairwise edge
 * collection (unique on the sorted `(userA, userB)` pair, upserted by
 * `src/lib/altDetection/run.ts`); `altClusters` is the connected-component
 * rollup consumed by the ranked Alts admin view and the `alt_ring_audit` /
 * `alt_rank` MCP tools.
 */
export async function seedAltDetectionIndexes(db: Db, log: (msg: string) => void) {
  log("Alt-detection indexes:");

  await ensureIndex(
    db,
    "altLinks",
    { userA: 1, userB: 1 },
    { name: "altLinks_userA_userB_unique", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "altLinks",
    { confidence: -1 },
    { name: "altLinks_confidence_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "altLinks",
    { userA: 1 },
    { name: "altLinks_userA", background: true },
    log
  );

  await ensureIndex(
    db,
    "altLinks",
    { userB: 1 },
    { name: "altLinks_userB", background: true },
    log
  );

  await ensureIndex(
    db,
    "altLinks",
    { updatedAt: 1 },
    { name: "altLinks_updatedAt", background: true },
    log
  );

  await ensureIndex(
    db,
    "altClusters",
    { confidence: -1 },
    { name: "altClusters_confidence_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "altClusters",
    { status: 1, confidence: -1 },
    { name: "altClusters_status_confidence", background: true },
    log
  );

  await ensureIndex(
    db,
    "altClusters",
    { memberUserIds: 1 },
    { name: "altClusters_memberUserIds", background: true },
    log
  );

  await ensureIndex(
    db,
    "altClusters",
    { updatedAt: 1 },
    { name: "altClusters_updatedAt", background: true },
    log
  );

  // Escalation feed: "which links got a lot more suspicious recently".
  // Sparse — only links that have actually escalated carry the field, and
  // pre-Wave-3 links never will.
  await ensureIndex(
    db,
    "altLinks",
    { escalatedAt: -1 },
    { name: "altLinks_escalatedAt_desc", background: true, sparse: true },
    log
  );

  // Run telemetry (src/lib/altDetection/runMetrics.ts): newest-first reads
  // for the trend report, plus a TTL so the collection stays bounded
  // without a purge job.
  await ensureIndex(
    db,
    "altScoringRuns",
    { at: -1 },
    { name: "altScoringRuns_at_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "altScoringRuns",
    { at: 1 },
    {
      name: "altScoringRuns_at_ttl",
      background: true,
      expireAfterSeconds: RUN_RECORD_TTL_SECONDS,
    },
    log
  );

  log("Alt-detection indexes ensured");
}
