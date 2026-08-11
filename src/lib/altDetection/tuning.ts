import type { Db } from "mongodb";
import type { AltCluster, AltClusterStatus, AltSignal } from "@/lib/db/types/altDetection";
import type { GameConfig } from "@/lib/db/types";
import {
  DEFAULT_ALT_SCORING_WEIGHTS,
  resolveAltScoringConfig,
  type AltSignalWeights,
} from "./config";

/**
 * Learning loop (forensics-v2 Wave 2): turn moderator dispositions
 * (confirmed vs. dismissed alt rings) into ADVISORY weight-tuning
 * suggestions for the alt-detection scoring config
 * (`gameConfig.altScoring`, forensics/alt-detection rework plan §3.2).
 *
 * Report-only, same doctrine as the rest of `altDetection/`: nothing here
 * writes to `gameConfig`. `GET /api/admin/alts/tuning` surfaces this report
 * to an admin, who applies (or ignores) any of it through the existing
 * `PUT /api/admin/alts/config`.
 *
 * ## Method
 * The sample unit is the CLUSTER (ring), not the pairwise link — moderator
 * disposition (`AltCluster.status: "confirmed" | "dismissed"`) lives on
 * `altClusters`, so that's the natural unit to measure signal
 * discrimination against. We use `AltCluster.signalSummary[].type`
 * (presence of a signal type in the ring, already rolled up across the
 * ring's member links by `src/lib/altDetection/cluster.ts`) rather than raw
 * per-link signal counts — that keeps one ring with five
 * `login_time_cluster` links from outweighing nine independent rings each
 * with one.
 *
 * For each signal type:
 *
 *   confirmedRate   = (confirmed rings containing the signal) / (all confirmed rings)
 *   dismissedRate   = (dismissed rings containing the signal) / (all dismissed rings)
 *   discrimination  = confirmedRate - dismissedRate            (range [-1, 1])
 *
 * A signal that shows up in most confirmed rings and few dismissed ones has
 * discrimination near +1 — it's pulling its weight, finding real alts. One
 * that shows up mostly in dismissed rings has discrimination near -1 —
 * it's mostly firing on rings moderators decided were false positives, i.e.
 * likely over-weighted noise.
 *
 * ## Weight delta mapping
 * The suggestion nudges the *currently configured* weight (admin overrides
 * via `resolveAltScoringConfig`, not just the hardcoded defaults) toward the
 * discrimination score, capped at `MAX_WEIGHT_DELTA` per run — deliberately
 * conservative since this is advisory and dispositions are a noisy signal,
 * not ground truth:
 *
 *   suggestedWeight = clamp(currentWeight + MAX_WEIGHT_DELTA * discrimination, 0, 1)
 *
 * ## Min-sample guard
 * A signal needs at least `MIN_SIGNAL_SAMPLES` total occurrences (confirmed
 * + dismissed rings containing it, combined) before its discrimination
 * score is trusted. Below that, `lowConfidence: true` and no weight change
 * is suggested (`suggestedWeight === currentWeight`) — a single confirmed
 * ring with a rare signal shouldn't swing its weight. Separately, the
 * report-level `lowConfidence` flag fires when the overall
 * confirmed+dismissed corpus is thin (`< MIN_TOTAL_CLUSTERS`), so an admin
 * can tell "no rings reviewed yet" apart from "reviewed, and this signal
 * specifically has few examples."
 */

/** Minimum confirmed+dismissed rings containing a given signal before its
 * discrimination score is trusted enough to suggest a weight change. */
export const MIN_SIGNAL_SAMPLES = 5;

/** Minimum confirmed+dismissed rings overall before the report is
 * considered a reliable read (flagged at the report level, independent of
 * the per-signal guard). */
export const MIN_TOTAL_CLUSTERS = 10;

/** Maximum weight nudge suggested per run, in either direction. */
export const MAX_WEIGHT_DELTA = 0.15;

export interface SignalTuningSuggestion {
  signal: AltSignal;
  currentWeight: number;
  suggestedWeight: number;
  confirmedCount: number;
  dismissedCount: number;
  confirmedRate: number;
  dismissedRate: number;
  /** confirmedRate - dismissedRate, in [-1, 1]. Positive = associated with
   * confirmed (true-positive) rings; negative = associated with dismissed
   * (false-positive) rings. */
  discrimination: number;
  lowConfidence: boolean;
  rationale: string;
}

export interface TuningReport {
  generatedAt: Date;
  confirmedTotal: number;
  dismissedTotal: number;
  /** True when the overall confirmed+dismissed corpus is below
   * `MIN_TOTAL_CLUSTERS` — read the suggestions as a rough first read, not
   * a settled recommendation. */
  lowConfidence: boolean;
  minSignalSamples: number;
  minTotalClusters: number;
  maxWeightDelta: number;
  /** Plain-English restatement of the method, for the admin UI. */
  method: string;
  suggestions: SignalTuningSuggestion[];
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clusterHasSignal(cluster: Pick<AltCluster, "signalSummary">, signal: AltSignal): boolean {
  return cluster.signalSummary?.some((entry) => entry.type === signal && entry.count > 0) ?? false;
}

interface RationaleArgs {
  confirmedCount: number;
  dismissedCount: number;
  confirmedTotal: number;
  dismissedTotal: number;
  discrimination: number;
  lowConfidence: boolean;
  currentWeight: number;
  suggestedWeight: number;
}

function buildRationale(args: RationaleArgs): string {
  const {
    confirmedCount,
    dismissedCount,
    confirmedTotal,
    dismissedTotal,
    discrimination,
    lowConfidence,
    currentWeight,
    suggestedWeight,
  } = args;
  const seenIn = `seen in ${confirmedCount}/${confirmedTotal} confirmed and ${dismissedCount}/${dismissedTotal} dismissed rings`;

  if (lowConfidence) {
    return `Only ${confirmedCount + dismissedCount} total occurrence(s) (${seenIn}) — below the min-sample guard (${MIN_SIGNAL_SAMPLES}); no change suggested.`;
  }
  if (discrimination > 0) {
    const magnitude = discrimination >= 0.5 ? "strongly" : "mildly";
    return `${seenIn} — ${magnitude} associated with confirmed rings (discrimination +${round(discrimination)}); suggest raising weight ${currentWeight} -> ${suggestedWeight}.`;
  }
  if (discrimination < 0) {
    const magnitude = discrimination <= -0.5 ? "strongly" : "mildly";
    return `${seenIn} — ${magnitude} associated with dismissed (false-positive) rings (discrimination ${round(discrimination)}); suggest lowering weight ${currentWeight} -> ${suggestedWeight}.`;
  }
  return `${seenIn} — no discrimination between confirmed and dismissed rings; weight left unchanged.`;
}

function buildSuggestion(
  signal: AltSignal,
  weights: AltSignalWeights,
  confirmed: Array<Pick<AltCluster, "signalSummary">>,
  dismissed: Array<Pick<AltCluster, "signalSummary">>
): SignalTuningSuggestion {
  const confirmedTotal = confirmed.length;
  const dismissedTotal = dismissed.length;
  const confirmedCount = confirmed.filter((cluster) => clusterHasSignal(cluster, signal)).length;
  const dismissedCount = dismissed.filter((cluster) => clusterHasSignal(cluster, signal)).length;

  const confirmedRate = confirmedTotal > 0 ? confirmedCount / confirmedTotal : 0;
  const dismissedRate = dismissedTotal > 0 ? dismissedCount / dismissedTotal : 0;
  const discrimination = confirmedRate - dismissedRate;

  const currentWeight = weights[signal];
  const lowConfidence = confirmedCount + dismissedCount < MIN_SIGNAL_SAMPLES;
  const suggestedWeight = lowConfidence
    ? currentWeight
    : round(clamp01(currentWeight + MAX_WEIGHT_DELTA * discrimination));

  return {
    signal,
    currentWeight,
    suggestedWeight,
    confirmedCount,
    dismissedCount,
    confirmedRate: round(confirmedRate),
    dismissedRate: round(dismissedRate),
    discrimination: round(discrimination),
    lowConfidence,
    rationale: buildRationale({
      confirmedCount,
      dismissedCount,
      confirmedTotal,
      dismissedTotal,
      discrimination,
      lowConfidence,
      currentWeight,
      suggestedWeight,
    }),
  };
}

/**
 * Compute the advisory tuning report from `altClusters` dispositions and the
 * currently configured (default-merged-with-admin-override) scoring weights.
 * Pure read — never writes to `gameConfig` or `altClusters`.
 */
export async function computeTuningSuggestions(db: Db): Promise<TuningReport> {
  const [clusters, gameConfig] = await Promise.all([
    db
      .collection<AltCluster>("altClusters")
      .find(
        { status: { $in: ["confirmed", "dismissed"] as AltClusterStatus[] } },
        { projection: { status: 1, signalSummary: 1 } }
      )
      .toArray(),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { altScoring: 1 } }),
  ]);

  const { weights } = resolveAltScoringConfig(gameConfig?.altScoring);

  const confirmed = clusters.filter((cluster) => cluster.status === "confirmed");
  const dismissed = clusters.filter((cluster) => cluster.status === "dismissed");

  const signals = Object.keys(DEFAULT_ALT_SCORING_WEIGHTS) as AltSignal[];
  const suggestions = signals
    .map((signal) => buildSuggestion(signal, weights, confirmed, dismissed))
    // Most actionable first: confident suggestions before thin-sample ones,
    // then by discrimination magnitude.
    .sort((a, b) => {
      if (a.lowConfidence !== b.lowConfidence) return a.lowConfidence ? 1 : -1;
      return Math.abs(b.discrimination) - Math.abs(a.discrimination);
    });

  return {
    generatedAt: new Date(),
    confirmedTotal: confirmed.length,
    dismissedTotal: dismissed.length,
    lowConfidence: confirmed.length + dismissed.length < MIN_TOTAL_CLUSTERS,
    minSignalSamples: MIN_SIGNAL_SAMPLES,
    minTotalClusters: MIN_TOTAL_CLUSTERS,
    maxWeightDelta: MAX_WEIGHT_DELTA,
    method:
      "Per signal: discrimination = (share of confirmed rings containing the signal) minus " +
      "(share of dismissed rings containing the signal), range [-1, 1]. Suggested weight = " +
      "current configured weight + (max delta 0.15 * discrimination), clamped to [0, 1]. " +
      "Signals with fewer than 5 total occurrences across confirmed+dismissed rings are " +
      "flagged low-confidence and left unchanged. Advisory only — apply via PUT /api/admin/alts/config.",
    suggestions,
  };
}
