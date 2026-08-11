import { ObjectId, type Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type {
  AltLink,
  AltRunSignalStat,
  AltScoringRunRecord,
  AltSignal,
} from "@/lib/db/types/altDetection";
import { getAltScoringRunsCollection } from "@/lib/db/collections/altDetection";

/**
 * Run telemetry (forensics-v2 Wave 3).
 *
 * The alt-scoring pass is a best-effort hourly cron whose failures are, by
 * design, silent — `runAltScoring` swallows every throw so it can never
 * break the cron. That safety property has a cost: a run that scores zero
 * links because an upstream field stopped being populated looks exactly
 * like a quiet hour. This module makes each run leave a record behind, so
 * "the detector stopped detecting" is a visible trend rather than something
 * discovered weeks later.
 *
 * Everything here is derived from data the run already has in memory —
 * building a record costs one pass over the links and no extra queries.
 */

/** Confidence rise, within a single run, that marks a link as escalated.
 * 0.25 is roughly "gained a corroborating signal it did not have before" —
 * large enough that ordinary jitter (one extra shared login timestamp
 * nudging a weight) does not trip it. */
export const LINK_ESCALATION_DELTA = 0.25;

/** Buckets in the confidence histogram — ten 0.1-wide bins, matching
 * `calibration.ts`'s reliability bins so the two line up. */
export const CONFIDENCE_BUCKET_COUNT = 10;

// Retention for run records is a TTL index, so its constant lives with the
// index definition in `src/lib/admin/seed/indexes/altDetection.ts` — keeping
// it there means the seed path does not have to import this module (and with
// it Sentry and the Mongo client) just to read one number.

export interface RunMetricsInput {
  turn: number;
  enabled: boolean;
  dryRun: boolean;
  candidateCount: number;
  candidatePoolTruncated: boolean;
  links: AltLink[];
  linksWritten: number;
  clustersComputed: number;
  clustersWritten: number;
  clustersOpened: number;
  durationMs: number;
  /** Links whose confidence rose by >= `LINK_ESCALATION_DELTA` this run. */
  escalationCount: number;
  /** Links scored for the first time this run. */
  newLinkCount: number;
  at: Date;
  error?: string;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Bucket index for a confidence in [0,1]; 1.0 lands in the top bucket. */
export function confidenceBucket(confidence: number): number {
  const clamped = Math.min(1, Math.max(0, confidence));
  return Math.min(CONFIDENCE_BUCKET_COUNT - 1, Math.floor(clamped * CONFIDENCE_BUCKET_COUNT));
}

function buildHistogram(links: AltLink[]): number[] {
  const histogram = new Array<number>(CONFIDENCE_BUCKET_COUNT).fill(0);
  for (const link of links) histogram[confidenceBucket(link.confidence)] += 1;
  return histogram;
}

/** 95th percentile by nearest-rank over the sorted confidences. */
function percentile95(links: AltLink[]): number {
  if (links.length === 0) return 0;
  const sorted = links.map((l) => l.confidence).sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

/**
 * Per-signal firing stats. Splits fired-non-zero from guarded-to-zero
 * deliberately: a guard that suddenly starts zeroing every
 * `ip_exact_nonCF` match (say, a Cloudflare range list update that
 * over-matches) would otherwise present as "that signal just stopped
 * existing" with no way to tell the two apart.
 */
export function buildSignalStats(links: AltLink[]): AltRunSignalStat[] {
  const byType = new Map<
    AltSignal,
    { fired: number; guarded: number; weightSum: number; contributionSum: number }
  >();

  for (const link of links) {
    for (const signal of link.signals) {
      const entry = byType.get(signal.type) ?? {
        fired: 0,
        guarded: 0,
        weightSum: 0,
        contributionSum: 0,
      };
      if (signal.weight > 0) {
        entry.fired += 1;
        entry.weightSum += signal.weight;
        entry.contributionSum += signal.contribution;
      } else {
        entry.guarded += 1;
      }
      byType.set(signal.type, entry);
    }
  }

  return [...byType.entries()]
    .map(([type, agg]) => ({
      type,
      firedCount: agg.fired,
      guardedZeroCount: agg.guarded,
      meanWeight: agg.fired === 0 ? 0 : round(agg.weightSum / agg.fired),
      meanContribution: agg.fired === 0 ? 0 : round(agg.contributionSum / agg.fired),
    }))
    .sort((a, b) => b.firedCount - a.firedCount);
}

/** Assemble the run record. Pure — no DB, no clock read (`at` is passed in). */
export function buildRunMetrics(input: RunMetricsInput): AltScoringRunRecord {
  const { links } = input;
  const meanLinkConfidence =
    links.length === 0 ? 0 : round(links.reduce((sum, l) => sum + l.confidence, 0) / links.length);

  return {
    _id: new ObjectId(),
    at: input.at,
    turn: input.turn,
    enabled: input.enabled,
    dryRun: input.dryRun,
    candidateCount: input.candidateCount,
    candidatePoolTruncated: input.candidatePoolTruncated,
    linksComputed: links.length,
    linksWritten: input.linksWritten,
    clustersComputed: input.clustersComputed,
    clustersWritten: input.clustersWritten,
    clustersOpened: input.clustersOpened,
    durationMs: input.durationMs,
    confidenceHistogram: buildHistogram(links),
    meanLinkConfidence,
    p95LinkConfidence: round(percentile95(links)),
    escalationCount: input.escalationCount,
    newLinkCount: input.newLinkCount,
    signalStats: buildSignalStats(links),
    ...(input.error ? { error: input.error } : {}),
  };
}

/**
 * Persist one run record. Best-effort inside an already-best-effort run:
 * telemetry must never be the reason scoring fails, so a write error is
 * reported to Sentry and swallowed.
 */
export async function recordAltScoringRun(db: Db, record: AltScoringRunRecord): Promise<void> {
  try {
    const collection = await getAltScoringRunsCollection(db);
    await collection.insertOne(record);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: "altDetection", op: "recordAltScoringRun" },
      level: "warning",
    });
  }
}

// ─── Trend report (GET /api/admin/alts/metrics) ───────────────────────────

export interface SignalTrendPoint {
  type: AltSignal;
  /** Mean `firedCount` per run over the recent window. */
  recentMeanFired: number;
  /** Mean `firedCount` per run over the older comparison window. */
  priorMeanFired: number;
  /** `recentMeanFired - priorMeanFired`. Sharply negative means the signal
   * is going quiet — usually an upstream data problem, not fewer alts. */
  delta: number;
  /** True when the signal fired in the prior window but not at all in the
   * recent one — the specific failure this whole module exists to catch. */
  wentSilent: boolean;
}

export interface AltMetricsReport {
  generatedAt: Date;
  /** Most recent runs, newest first. */
  runs: AltScoringRunRecord[];
  /** Runs in the recent window used for the trend comparison. */
  windowSize: number;
  latestRun: AltScoringRunRecord | null;
  /** Runs in the window that recorded an error. */
  erroredRuns: number;
  /** Runs in the window whose candidate pool hit the cap. */
  truncatedRuns: number;
  signalTrends: SignalTrendPoint[];
  /** Plain-English health notes for the admin UI. Empty means nothing is
   * obviously wrong. */
  warnings: string[];
}

/** How many recent runs to average for the trend comparison, on each side. */
export const TREND_WINDOW_RUNS = 12;

function meanFiredByType(runs: AltScoringRunRecord[]): Map<AltSignal, number> {
  const totals = new Map<AltSignal, number>();
  for (const run of runs) {
    for (const stat of run.signalStats) {
      totals.set(stat.type, (totals.get(stat.type) ?? 0) + stat.firedCount);
    }
  }
  const means = new Map<AltSignal, number>();
  for (const [type, total] of totals) means.set(type, runs.length === 0 ? 0 : total / runs.length);
  return means;
}

/** Pure trend maths over an already-fetched run list (newest first). */
export function buildMetricsReport(runs: AltScoringRunRecord[]): AltMetricsReport {
  const recent = runs.slice(0, TREND_WINDOW_RUNS);
  const prior = runs.slice(TREND_WINDOW_RUNS, TREND_WINDOW_RUNS * 2);

  const recentMeans = meanFiredByType(recent);
  const priorMeans = meanFiredByType(prior);
  const allTypes = new Set<AltSignal>([...recentMeans.keys(), ...priorMeans.keys()]);

  const signalTrends: SignalTrendPoint[] = [...allTypes]
    .map((type) => {
      const recentMeanFired = round(recentMeans.get(type) ?? 0, 2);
      const priorMeanFired = round(priorMeans.get(type) ?? 0, 2);
      return {
        type,
        recentMeanFired,
        priorMeanFired,
        delta: round(recentMeanFired - priorMeanFired, 2),
        // Only a claim when there IS a prior window to compare against —
        // on a fresh install every signal would otherwise read as silent.
        wentSilent: prior.length > 0 && priorMeanFired > 0 && recentMeanFired === 0,
      };
    })
    .sort((a, b) => a.delta - b.delta);

  const erroredRuns = recent.filter((r) => r.error).length;
  const truncatedRuns = recent.filter((r) => r.candidatePoolTruncated).length;

  const warnings: string[] = [];
  if (erroredRuns > 0) {
    warnings.push(
      `${erroredRuns} of the last ${recent.length} runs recorded an error — scoring was incomplete for those hours.`
    );
  }
  if (truncatedRuns > 0) {
    warnings.push(
      `${truncatedRuns} of the last ${recent.length} runs hit the candidate-pool cap, so some accounts were never scored against each other. Consider raising MAX_CANDIDATES or narrowing the lookback window.`
    );
  }
  for (const trend of signalTrends) {
    if (trend.wentSilent) {
      warnings.push(
        `Signal "${trend.type}" fired ${trend.priorMeanFired}x/run previously and has not fired at all in the last ${recent.length} runs — check whether its upstream data is still being populated.`
      );
    }
  }
  if (recent.length > 0 && recent.every((r) => r.linksComputed === 0)) {
    warnings.push(
      `No links were scored in any of the last ${recent.length} runs. Either there is genuinely no candidate activity, or facet assembly is failing upstream of scoring.`
    );
  }

  return {
    generatedAt: new Date(),
    runs,
    windowSize: recent.length,
    latestRun: runs[0] ?? null,
    erroredRuns,
    truncatedRuns,
    signalTrends,
    warnings,
  };
}

/** Fetch recent run records (newest first) and build the trend report. */
export async function computeMetricsReport(db: Db, limit = 48): Promise<AltMetricsReport> {
  const collection = await getAltScoringRunsCollection(db);
  const runs = await collection.find({}, { sort: { at: -1 }, limit }).toArray();
  return buildMetricsReport(runs);
}
