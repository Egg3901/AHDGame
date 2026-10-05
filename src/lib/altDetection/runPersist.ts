import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { AltCluster, AltLink } from "@/lib/db/types/altDetection";
import { getAltClustersCollection, getAltLinksCollection } from "@/lib/db/collections/altDetection";
import {
  buildRunMetrics,
  LINK_ESCALATION_DELTA,
  recordAltScoringRun,
  type RunMetricsInput,
} from "./runMetrics";
import { IDENTITY_SIGNAL_MAX_AGE_MS } from "@/lib/auth/identitySignals";

/** Cap on persisted `altLinks` rows per run — guards against a pathological
 * shared-subnet blowup (e.g. a university NAT) writing tens of thousands of
 * near-zero-value rows. Weakest links are dropped first. */
const MAX_LINKS_PERSISTED = 3000;

/** Minimum member-set Jaccard overlap to treat a newly computed cluster as
 * "the same ring" as an existing `altClusters` doc, so we update in place
 * (preserving `status`/`reviewedBy`/`reviewNote`) instead of inserting a
 * duplicate. Majority overlap in either direction. */
const CLUSTER_MATCH_MIN_OVERLAP = 0.5;

/** A stored match must be reproduced from current evidence within the same
 * 30-day window used by Duplicate Groups. Otherwise it is stale output, not
 * an active moderation lead. */
const STALE_MATCH_MAX_AGE_MS = IDENTITY_SIGNAL_MAX_AGE_MS;

function pairKey(userA: ObjectId, userB: ObjectId): string {
  return `${userA.toString()}_${userB.toString()}`;
}

interface LinkUpsertSummary {
  written: number;
  /** Links whose confidence rose by >= `LINK_ESCALATION_DELTA` this run. */
  escalations: number;
  /** Links scored for the first time. */
  newLinks: number;
}

/**
 * Upsert links, maintaining the longitudinal tracking fields
 * (`firstDetectedAt`/`peakConfidence`/`previousConfidence`/
 * `observationCount`/`escalatedAt`).
 *
 * This needs the PRIOR value of each pair, so it reads the existing rows
 * for the candidate set first. That read is bounded by the same candidate
 * pool the rest of the run is (indexed on `userA`/`userB`) — it is not a
 * scan. Without it, `confidence` is overwritten every hour and a link that
 * climbed from 0.20 to 0.95 overnight is indistinguishable from one that
 * has sat at 0.95 for a month, which is exactly the distinction a
 * moderator triaging a ranked list needs.
 *
 * Escalation/new-link counts are returned rather than logged so the run
 * record can carry them (`runMetrics.ts`).
 */
export async function upsertLinks(
  db: Db,
  links: AltLink[],
  candidateUserIds: ObjectId[],
  now: Date,
  dryRun: boolean
): Promise<LinkUpsertSummary> {
  if (links.length === 0) return { written: 0, escalations: 0, newLinks: 0 };
  const toPersist = [...links]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_LINKS_PERSISTED);

  const collection = await getAltLinksCollection(db);
  const existingRows =
    candidateUserIds.length > 0
      ? await collection
          .find(
            { $or: [{ userA: { $in: candidateUserIds } }, { userB: { $in: candidateUserIds } }] },
            { projection: { userA: 1, userB: 1, confidence: 1, peakConfidence: 1 } }
          )
          .toArray()
      : [];
  const existingByPair = new Map(existingRows.map((row) => [pairKey(row.userA, row.userB), row]));

  let escalations = 0;
  let newLinks = 0;
  const ops: AnyBulkWriteOperation<AltLink>[] = [];

  for (const link of toPersist) {
    const existing = existingByPair.get(pairKey(link.userA, link.userB));
    const escalated =
      existing !== undefined && link.confidence - existing.confidence >= LINK_ESCALATION_DELTA;
    if (escalated) escalations += 1;
    if (!existing) newLinks += 1;

    ops.push({
      updateOne: {
        filter: { userA: link.userA, userB: link.userB },
        update: {
          $set: {
            confidence: link.confidence,
            signals: link.signals,
            updatedAt: link.updatedAt,
            turn: link.turn,
            peakConfidence: Math.max(
              link.confidence,
              existing?.peakConfidence ?? existing?.confidence ?? 0
            ),
            // Absent on a first sighting: there is no previous value, and
            // writing the current one would falsely read as "no change".
            ...(existing ? { previousConfidence: existing.confidence } : {}),
            ...(escalated ? { escalatedAt: now } : {}),
            ...(link.iterationKey ? { iterationKey: link.iterationKey } : {}),
          },
          $setOnInsert: {
            _id: link._id,
            userA: link.userA,
            userB: link.userB,
            firstDetectedAt: now,
          },
          $inc: { observationCount: 1 },
        },
        upsert: true,
      },
    });
  }

  if (dryRun) return { written: toPersist.length, escalations, newLinks };

  const result = await collection.bulkWrite(ops, { ordered: false });

  // A link can fall below the persistence cap during a noisy run while still
  // being reproduced by current evidence. Touch any such existing row without
  // upserting or incrementing its observation count so the stale sweep does not
  // mistake "not in the top N" for "not observed".
  const persistedPairs = new Set(toPersist.map((link) => pairKey(link.userA, link.userB)));
  const touchOps: AnyBulkWriteOperation<AltLink>[] = links
    .filter((link) => {
      const key = pairKey(link.userA, link.userB);
      return existingByPair.has(key) && !persistedPairs.has(key);
    })
    .map((link) => ({
      updateOne: {
        filter: { userA: link.userA, userB: link.userB },
        update: { $set: { updatedAt: now } },
        upsert: false,
      },
    }));
  if (touchOps.length > 0) await collection.bulkWrite(touchOps, { ordered: false });

  return {
    written: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0) + (result.matchedCount ?? 0),
    escalations,
    newLinks,
  };
}

// ─── Upsert: altClusters (status-preserving reconciliation) ─────────────

/**
 * Match a freshly computed cluster against an existing `altClusters` doc by
 * member-set overlap (Jaccard >= {@link CLUSTER_MATCH_MIN_OVERLAP}). Cluster
 * `_id`s are freshly generated every run (`cluster.ts`'s own comment), so
 * this is the reconciliation key — NOT `_id` equality.
 */
function matchExistingCluster(cluster: AltCluster, existing: AltCluster[]): AltCluster | undefined {
  const newIds = new Set(cluster.memberUserIds.map((id) => id.toString()));
  let best: AltCluster | undefined;
  let bestScore = 0;
  for (const doc of existing) {
    const existingIds = new Set(doc.memberUserIds.map((id) => id.toString()));
    let intersection = 0;
    for (const id of newIds) if (existingIds.has(id)) intersection++;
    if (intersection === 0) continue;
    const union = newIds.size + existingIds.size - intersection;
    const jaccard = union === 0 ? 0 : intersection / union;
    if (jaccard > bestScore) {
      bestScore = jaccard;
      best = doc;
    }
  }
  return bestScore >= CLUSTER_MATCH_MIN_OVERLAP ? best : undefined;
}

interface ClusterUpsertSummary {
  written: number;
  opened: number;
}

/**
 * Upsert computed clusters. Two paths:
 *  - Matches an existing doc (by member overlap): refresh confidence/
 *    evidence/roles in place, but NEVER touch `status`/`reviewedBy`/
 *    `reviewNote` — a moderator's disposition on a ring is sticky across
 *    hourly recomputes.
 *  - No match (brand-new ring): only persisted if `confidence >=
 *    thresholds.cluster` (auto-open threshold, owner decision: 60%), with
 *    `status:"open"`. Below threshold, the cluster is computed but not
 *    written — this keeps low-confidence noise out of `altClusters`
 *    without overloading the fixed `AltClusterStatus` enum with a 5th
 *    "hidden" state; it will be (re-)written the moment its confidence
 *    crosses the threshold on a later run, or the moment a real match with
 *    an already-reviewed doc appears.
 */
export async function upsertClusters(
  db: Db,
  clusters: AltCluster[],
  clusterThreshold: number,
  candidateUserIds: ObjectId[],
  now: Date,
  dryRun: boolean
): Promise<ClusterUpsertSummary> {
  if (clusters.length === 0) return { written: 0, opened: 0 };
  const collection = await getAltClustersCollection(db);

  const existing =
    candidateUserIds.length > 0
      ? await collection.find({ memberUserIds: { $in: candidateUserIds } }).toArray()
      : [];

  const ops: AnyBulkWriteOperation<AltCluster>[] = [];
  let opened = 0;

  for (const cluster of clusters) {
    const match = matchExistingCluster(cluster, existing);
    if (match) {
      // Weak evidence must not keep a historical cluster alive forever. Only
      // a currently actionable cluster refreshes its staleness clock.
      if (cluster.confidence < clusterThreshold) continue;
      ops.push({
        updateOne: {
          filter: { _id: match._id },
          update: {
            $set: {
              memberUserIds: cluster.memberUserIds,
              confidence: cluster.confidence,
              size: cluster.size,
              signalSummary: cluster.signalSummary,
              roles: cluster.roles,
              topEvidence: cluster.topEvidence,
              updatedAt: now,
              turn: cluster.turn,
              ...(cluster.iterationKey ? { iterationKey: cluster.iterationKey } : {}),
            },
          },
        },
      });
      continue;
    }

    if (cluster.confidence < clusterThreshold) continue;

    ops.push({
      insertOne: {
        document: { ...cluster, status: "open", updatedAt: now },
      },
    });
    opened++;
  }

  if (ops.length === 0) return { written: 0, opened: 0 };
  if (dryRun) return { written: ops.length, opened };
  await collection.bulkWrite(ops, { ordered: false });
  return { written: ops.length, opened };
}

interface PruneSummary {
  links: number;
  clusters: number;
}

/** Drop materialized output from a previous game iteration before matching or
 * upserting. Legacy rows have no iterationKey and are intentionally removed on
 * the first run after this ships. */
export async function prunePriorIterationMatches(
  db: Db,
  iterationKey: string | undefined,
  dryRun: boolean
): Promise<PruneSummary> {
  if (!iterationKey || dryRun) return { links: 0, clusters: 0 };
  const priorIteration = { iterationKey: { $ne: iterationKey } };
  const [links, clusters] = await Promise.all([
    (await getAltLinksCollection(db)).deleteMany(priorIteration),
    (await getAltClustersCollection(db)).deleteMany(priorIteration),
  ]);
  return {
    links: links.deletedCount ?? 0,
    clusters: clusters.deletedCount ?? 0,
  };
}

/**
 * Remove materialized matches that have not been reproduced from current
 * evidence within the identity-evidence window. This is an in-run sweep rather
 * than a TTL index so dry runs remain strictly read-only.
 */
export async function pruneStaleMatches(db: Db, now: Date, dryRun: boolean): Promise<PruneSummary> {
  if (dryRun) return { links: 0, clusters: 0 };
  const cutoff = new Date(now.getTime() - STALE_MATCH_MAX_AGE_MS);
  const stale = {
    $or: [{ updatedAt: { $lt: cutoff } }, { updatedAt: { $exists: false } }],
  };
  const [links, clusters] = await Promise.all([
    (await getAltLinksCollection(db)).deleteMany(stale),
    (await getAltClustersCollection(db)).deleteMany(stale),
  ]);
  return {
    links: links.deletedCount ?? 0,
    clusters: clusters.deletedCount ?? 0,
  };
}

// ─── Run telemetry ───────────────────────────────────────────────────────

/**
 * Write one run record. A dry run is recorded too (flagged as such) so
 * `scripts/run-alt-scoring-once.mjs` previews are distinguishable from real
 * cron passes rather than invisible. Never throws — `recordAltScoringRun`
 * swallows and reports its own errors.
 */
export async function writeRunRecord(db: Db, input: RunMetricsInput): Promise<void> {
  await recordAltScoringRun(db, buildRunMetrics(input));
}
