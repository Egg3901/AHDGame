/**
 * Daily "new suspicious rings" digest (forensics/alt-detection rework plan,
 * forensics-v2 Wave 2 — scale/learning §C). Summarizes `altClusters` that
 * became newly notable since the last digest run and posts a summary to a
 * Discord webhook for moderators. Best-effort, like `run.ts`'s
 * `runAltScoring`: gated on `isAltScoringEnabled()`, and the whole entry
 * point is wrapped so a throw here never propagates to the daily cron
 * (`src/lib/cron.ts`) or the manual trigger route
 * (`src/app/api/admin/alts/digest/route.ts`).
 *
 * ── "New since last digest" tracking ──────────────────────────────────────
 * A dedicated single-doc `altDigestState` collection (`_id:"default"`)
 * stores `reportedClusterIds` — the set of `altClusters._id`s already
 * surfaced in a past digest. A cluster counts as newly notable when it is
 * `status:"open"`, `confidence >= thresholds.cluster` (the same auto-open
 * bar `run.ts` uses), and its id is NOT in that set.
 *
 * This is deliberately id-membership based, not an `updatedAt > lastRunAt`
 * timestamp filter: the *hourly* `altScoringCron` (`run.ts`) re-touches
 * `updatedAt` on every already-known open cluster on every recompute (it
 * refreshes confidence/evidence in place), so a naive timestamp cutoff
 * would re-report the same rings on every single daily digest. Tracking by
 * id instead means a ring is reported exactly once — unless it leaves
 * `open` status (reviewed/confirmed/dismissed) and is later reopened by a
 * moderator, at which point it's pruned from the tracked set (see
 * `pruneReportedIds`) and will show up again as "new".
 *
 * The marker only advances after a successful run: a failed Discord POST
 * leaves `reportedClusterIds` untouched so the same "new" set is retried
 * next time (idempotent). A run with nothing new to report, or one where no
 * webhook is configured, still counts as "successful" (there's nothing to
 * retry) and advances bookkeeping fields.
 */

import type { Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { getAltClustersCollection } from "@/lib/db/collections/altDetection";
import type { AltCluster } from "@/lib/db/types/altDetection";
import { isAltScoringEnabled } from "./featureFlag";
import { resolveAltScoringConfig } from "./config";
import { sendDiscordWebhookMultiple, type DiscordEmbed } from "@/lib/discordWebhooks";

/** Env var carrying the mod-facing digest webhook URL. Mirrors the
 * `DISCORD_ALERT_WEBHOOK_URL` pattern in `src/lib/observability/alertOps.ts`
 * (env-var-configured, silently skipped when unset) rather than a
 * `gameConfig` field — this keeps the digest self-contained to this file. */
const WEBHOOK_ENV_VAR = "DISCORD_ALT_DIGEST_WEBHOOK_URL";

/** How many rings get a full field in the embed body; the rest are only
 * counted (Discord embeds cap at 25 fields, and a 9th+ ring rarely needs
 * the same attention as the top ones in a daily summary). */
const TOP_N = 8;

/** Bound on the persisted "already reported" id set so a long-running world
 * can't grow `altDigestState` unboundedly. Generous relative to realistic
 * open-cluster counts (`run.ts` itself caps facet/link volume per hourly
 * pass). */
const REPORTED_ID_CAP = 5000;

/** Amber — distinct from the game-event embed palette in
 * `src/lib/discordWebhooks.ts` (`DISCORD_COLORS`), which this module
 * deliberately doesn't extend (out of file-scope for this change). */
const DIGEST_EMBED_COLOR = 0xe67e22;

// ─── State doc ───────────────────────────────────────────────────────────

interface AltDigestStateDoc {
  _id: "default";
  /** Timestamp of the last run that found >=1 new ring and either posted it
   * or logged the no-webhook fallback. */
  lastDigestAt?: Date;
  /** Timestamp of the most recent run, successful or not (observability). */
  lastRunAt?: Date;
  /** `altClusters._id` hex strings already surfaced in a past digest. */
  reportedClusterIds?: string[];
  /** Set (and left in place) on a failed run; cleared on the next success. */
  lastError?: string;
}

function getDigestStateCollection(db: Db) {
  return db.collection<AltDigestStateDoc>("altDigestState");
}

// ─── Selection (pure, unit-testable) ────────────────────────────────────

export interface AltDigestNewCluster {
  id: string;
  confidence: number;
  size: number;
  /** Up to 3 signal types, strongest contribution first. */
  topSignals: string[];
  /** Up to 2 evidence strings, as stored on the cluster (already
   * PII-masked at write time — see `altClusters` doc comment). */
  topEvidence: string[];
}

export interface AltDigestSelection {
  /** All newly notable rings this run, sorted by confidence desc — not
   * truncated to `TOP_N` (formatting handles that). */
  newClusters: AltDigestNewCluster[];
  /** Every currently-`open` cluster id at or above the confidence floor,
   * regardless of whether it's new — the next run's baseline. */
  openAboveThresholdIds: string[];
  /** Every currently-`open` cluster id, regardless of confidence — used to
   * prune stale entries out of the tracked "reported" set (see module doc
   * comment on reopened rings). */
  allOpenIds: string[];
}

/**
 * Pure selection: given the full current `open` cluster set and the
 * previously-reported id set, determine which clusters are newly notable.
 * Exported for unit tests.
 */
export function selectNewClusters(
  openClusters: AltCluster[],
  reportedIds: ReadonlySet<string>,
  confidenceThreshold: number
): AltDigestSelection {
  const allOpenIds = openClusters.map((c) => c._id.toString());
  const aboveThreshold = openClusters.filter((c) => c.confidence >= confidenceThreshold);
  const openAboveThresholdIds = aboveThreshold.map((c) => c._id.toString());

  const newClusters = aboveThreshold
    .filter((c) => !reportedIds.has(c._id.toString()))
    .sort((a, b) => b.confidence - a.confidence)
    .map((c): AltDigestNewCluster => ({
      id: c._id.toString(),
      confidence: c.confidence,
      size: c.size,
      topSignals: [...c.signalSummary]
        .sort((a, b) => b.maxContribution - a.maxContribution)
        .slice(0, 3)
        .map((s) => s.type),
      topEvidence: c.topEvidence.slice(0, 2),
    }));

  return { newClusters, openAboveThresholdIds, allOpenIds };
}

/**
 * Prune ids that are no longer `open` out of a previously-reported set, so
 * a dismissed-then-reopened ring can be reported again. Exported for unit
 * tests.
 */
export function pruneReportedIds(
  reportedIds: ReadonlySet<string>,
  allOpenIds: readonly string[]
): Set<string> {
  const openSet = new Set(allOpenIds);
  return new Set([...reportedIds].filter((id) => openSet.has(id)));
}

// ─── Formatting (pure, unit-testable) ───────────────────────────────────

/**
 * Build the Discord embed for a digest run. Returns `null` when there's
 * nothing to report — callers should treat that as a no-op, not an error.
 * Exported for unit tests.
 */
export function formatAltDigestEmbed(
  selection: Pick<AltDigestSelection, "newClusters">,
  opts: { adminUrl?: string } = {}
): DiscordEmbed | null {
  if (selection.newClusters.length === 0) return null;

  const shown = selection.newClusters.slice(0, TOP_N);
  const remainder = selection.newClusters.length - shown.length;

  const fields = shown.map((c, i) => {
    const lines: string[] = [];
    if (c.topSignals.length > 0) lines.push(`Signals: ${c.topSignals.join(", ")}`);
    for (const evidence of c.topEvidence) lines.push(`• ${evidence}`);
    return {
      name: `#${i + 1} — ${Math.round(c.confidence * 100)}% confidence · ${c.size} account${c.size === 1 ? "" : "s"}`,
      value: (lines.join("\n") || "(no evidence detail)").slice(0, 1024),
      inline: false,
    };
  });

  const plural = selection.newClusters.length === 1 ? "ring" : "rings";
  const descriptionParts = [
    `**${selection.newClusters.length}** new suspicious ${plural} detected since the last digest.`,
  ];
  if (remainder > 0) {
    descriptionParts.push(`Showing the top ${shown.length}; ${remainder} more not shown.`);
  }
  if (opts.adminUrl) {
    descriptionParts.push(`[Open Alts admin](${opts.adminUrl})`);
  }

  return {
    title: "🕵️ New suspicious rings — daily digest",
    description: descriptionParts.join("\n"),
    color: DIGEST_EMBED_COLOR,
    fields,
    footer: { text: "A House Divided — alt-detection digest" },
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export interface AltDigestRunResult {
  /** Whether `gameConfig.altScoringEnabled` was on for this run. When
   * `false`, no work happened and nothing else in the result is meaningful. */
  enabled: boolean;
  /** Whether `DISCORD_ALT_DIGEST_WEBHOOK_URL` was set. */
  webhookConfigured: boolean;
  /** Count of newly notable rings found this run. */
  newClusterCount: number;
  /** How many of those were included in the embed body (bounded by `TOP_N`). */
  reportedInBody: number;
  /** True only when a Discord POST actually succeeded this run. */
  posted: boolean;
  durationMs: number;
  /** Set only when the run failed partway through (also reported to
   * Sentry) — callers should never throw on this. */
  error?: string;
}

function emptyResult(
  enabled: boolean,
  webhookConfigured: boolean,
  durationMs: number,
  error?: string
): AltDigestRunResult {
  return {
    enabled,
    webhookConfigured,
    newClusterCount: 0,
    reportedInBody: 0,
    posted: false,
    durationMs,
    ...(error ? { error } : {}),
  };
}

/**
 * Run one digest pass: find newly notable open `altClusters`, post a
 * summary to Discord (or log-only when no webhook is configured), and
 * advance the "already reported" marker. Best-effort — gated on
 * `isAltScoringEnabled()`, wrapped in try/catch so a throw here never
 * propagates to the daily cron or the manual trigger route. Errors are
 * reported to Sentry and left on the state doc's `lastError` for
 * visibility.
 *
 * `options.adminUrl`, when provided, is linked from the embed (e.g. the
 * Alts admin page URL) — the cron doesn't have a request-derived origin, so
 * it's optional and typically only set by the manual trigger route.
 */
export async function runAltDigest(
  db: Db,
  options: { now?: Date; adminUrl?: string } = {}
): Promise<AltDigestRunResult> {
  const startedAt = Date.now();
  const webhookUrl = process.env[WEBHOOK_ENV_VAR];
  const webhookConfigured = Boolean(webhookUrl);
  let enabled = false;

  const stateCol = getDigestStateCollection(db);

  try {
    enabled = await isAltScoringEnabled();
    if (!enabled) {
      return emptyResult(false, webhookConfigured, Date.now() - startedAt);
    }

    const now = options.now ?? new Date();

    const [state, configDoc, openClusters] = await Promise.all([
      stateCol.findOne({ _id: "default" }),
      db
        .collection<{ _id: string; altScoring?: unknown }>("gameConfig")
        .findOne({ _id: "default" }, { projection: { altScoring: 1 } })
        .catch(() => null),
      getAltClustersCollection(db).then((col) => col.find({ status: "open" }).toArray()),
    ]);

    const { thresholds } = resolveAltScoringConfig(
      (configDoc?.altScoring as Parameters<typeof resolveAltScoringConfig>[0]) ?? null
    );

    const previouslyReported = new Set(state?.reportedClusterIds ?? []);
    const selection = selectNewClusters(openClusters, previouslyReported, thresholds.cluster);
    const prunedReported = pruneReportedIds(previouslyReported, selection.allOpenIds);

    if (selection.newClusters.length === 0) {
      // Nothing new: still persist the pruned set (self-heals reopened
      // rings) and bump lastRunAt for observability, but there's nothing to
      // send.
      const reportedArray = [...prunedReported].slice(-REPORTED_ID_CAP);
      await stateCol.updateOne(
        { _id: "default" },
        { $set: { lastRunAt: now, reportedClusterIds: reportedArray }, $unset: { lastError: "" } },
        { upsert: true }
      );
      return emptyResult(true, webhookConfigured, Date.now() - startedAt);
    }

    const embed = formatAltDigestEmbed(selection, { adminUrl: options.adminUrl });
    let posted = false;

    if (webhookUrl && embed) {
      // Let a delivery failure propagate to the outer catch — that's the
      // "unsuccessful run" path, which must NOT advance the marker so the
      // same new rings are retried on the next run.
      await sendDiscordWebhookMultiple(webhookUrl, [embed]);
      posted = true;
    } else {
      console.log(
        `[AltDigest] ${selection.newClusters.length} new suspicious ring(s) detected ` +
          `(no ${WEBHOOK_ENV_VAR} configured — logging only).`
      );
    }

    // Advance the marker: every currently-open, above-threshold cluster is
    // now considered "reported" — not just the ones shown in the embed's
    // top-N — so the next digest only surfaces what's genuinely new.
    for (const id of selection.openAboveThresholdIds) prunedReported.add(id);
    const reportedArray = [...prunedReported].slice(-REPORTED_ID_CAP);

    await stateCol.updateOne(
      { _id: "default" },
      {
        $set: { lastDigestAt: now, lastRunAt: now, reportedClusterIds: reportedArray },
        $unset: { lastError: "" },
      },
      { upsert: true }
    );

    return {
      enabled: true,
      webhookConfigured,
      newClusterCount: selection.newClusters.length,
      reportedInBody: Math.min(selection.newClusters.length, TOP_N),
      posted,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { component: "altDetection", op: "runAltDigest" } });
    const message = error instanceof Error ? error.message : String(error);
    try {
      await stateCol.updateOne(
        { _id: "default" },
        { $set: { lastRunAt: options.now ?? new Date(), lastError: message } },
        { upsert: true }
      );
    } catch {
      // Best-effort within best-effort — never let the failure bookkeeping
      // itself throw out of this function.
    }
    return emptyResult(enabled, webhookConfigured, Date.now() - startedAt, message);
  }
}
