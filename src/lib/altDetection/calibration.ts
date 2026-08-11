import type { Db } from "mongodb";
import type { AltCluster, AltClusterStatus, AltSignal } from "@/lib/db/types/altDetection";
import type { GameConfig } from "@/lib/db/types";
import { DEFAULT_ALT_SCORING_WEIGHTS, resolveAltScoringConfig } from "./config";

/**
 * Confidence calibration (forensics-v2 Wave 3).
 *
 * `tuning.ts` already asks "which SIGNALS discriminate?". This module asks
 * the prior question, about the number the whole system is built on: **when
 * we say a ring is 80% likely to be alts, is it?**
 *
 * A noisy-OR score is only meaningful if it is calibrated. If rings scored
 * 0.8 turn out to be confirmed 40% of the time, the model is systematically
 * overconfident and every threshold downstream of it — the 0.6 auto-open
 * gate, the moderator's own read of "very high" — is mis-set. Nothing in the
 * system surfaced that before this module: dispositions were used to tune
 * individual weights but never to score the aggregate.
 *
 * ## Ground truth and its limits
 * The only labels available are moderator dispositions on `altClusters`:
 * `status: "confirmed"` (treated as a true alt ring) and `"dismissed"`
 * (treated as a false positive). Both are noisy — a moderator can be wrong,
 * and "dismissed" sometimes means "real but harmless" rather than "not
 * alts". `"open"`/`"reviewed"` rings are unlabeled and excluded entirely.
 * Every number here inherits that noise, which is why the report is
 * advisory and carries explicit `lowConfidence` flags rather than driving
 * anything automatically.
 *
 * ## What is computed
 *  - **Reliability bins** — dispositioned rings bucketed by predicted
 *    confidence, each bin's mean prediction against its observed confirmed
 *    rate. The classic calibration plot, as data.
 *  - **Brier score** — mean squared error of the probability, in [0,1],
 *    lower is better. The single headline number for "is the confidence
 *    any good".
 *  - **Expected / maximum calibration error** — sample-weighted mean and
 *    worst-case gap between predicted and observed across bins.
 *  - **Threshold sweep** — precision/recall/F1 if the auto-open cluster
 *    threshold were set at each candidate value, plus the F1-maximizing
 *    recommendation. Answers "should the 0.6 gate move?" with evidence.
 *  - **Per-signal precision** — of dispositioned rings containing a signal,
 *    what share were confirmed. Complements `tuning.ts`'s discrimination
 *    score: discrimination says "does this signal separate the classes",
 *    precision says "how often is it right when it fires".
 *
 * Report-only, like the rest of `altDetection/` — pure reads, no writes.
 */

/** Number of equal-width reliability bins over [0,1]. Ten 0.1-wide buckets
 * matches the confidence histogram in `runMetrics.ts` so the two reports
 * line up visually. */
export const CALIBRATION_BIN_COUNT = 10;

/** Minimum dispositioned rings before the report is a reliable read. Below
 * this, a single moderator decision moves every number materially. */
export const MIN_CALIBRATION_SAMPLES = 20;

/** Minimum rings in a bin before its gap counts toward the expected
 * calibration error. Prevents one ring in an otherwise empty bin from
 * dominating a sample-weighted average. */
export const MIN_BIN_SAMPLES = 3;

/** Candidate cluster thresholds swept for the precision/recall trade-off. */
const THRESHOLD_SWEEP = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

export interface CalibrationBin {
  /** Inclusive lower edge of the bin. */
  lower: number;
  /** Exclusive upper edge (inclusive at 1.0 for the top bin). */
  upper: number;
  count: number;
  confirmedCount: number;
  /** Mean predicted confidence of the rings in this bin. */
  meanPredicted: number;
  /** Share of this bin's rings that were confirmed — the observed
   * frequency the prediction is supposed to match. */
  observedRate: number;
  /** `observedRate - meanPredicted`. Negative = overconfident (we predicted
   * more alts than the moderators confirmed); positive = underconfident. */
  gap: number;
  /** True when `count < MIN_BIN_SAMPLES` — shown, but excluded from ECE. */
  lowSample: boolean;
}

export interface ThresholdPoint {
  threshold: number;
  /** Confirmed rings at or above the threshold — correctly surfaced. */
  truePositives: number;
  /** Dismissed rings at or above the threshold — noise shown to moderators. */
  falsePositives: number;
  /** Confirmed rings BELOW the threshold — real rings that would be hidden. */
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface SignalPrecision {
  signal: AltSignal;
  /** Dispositioned rings containing this signal. */
  occurrences: number;
  confirmedCount: number;
  /** `confirmedCount / occurrences` — how often the signal is right when it
   * fires, given a disposition exists. */
  precision: number;
  /** Precision minus the corpus base rate. Positive = this signal beats
   * guessing; near zero = it adds nothing over the prior. */
  lift: number;
  lowConfidence: boolean;
}

export interface CalibrationReport {
  generatedAt: Date;
  sampleSize: number;
  confirmedTotal: number;
  dismissedTotal: number;
  /** Share of dispositioned rings that were confirmed — the prior a
   * threshold has to beat to be worth anything. */
  baseRate: number;
  /** Mean squared error of the predicted confidence, [0,1], lower better. */
  brierScore: number;
  /** Brier score of always predicting `baseRate`. The model is only earning
   * its keep when `brierScore < brierScoreBaseline`. */
  brierScoreBaseline: number;
  /** `1 - brierScore / brierScoreBaseline` — the Brier skill score. Positive
   * means the confidence beats the naive prior; <= 0 means it does not. */
  skillScore: number;
  /** Sample-weighted mean |gap| across bins clearing `MIN_BIN_SAMPLES`. */
  expectedCalibrationError: number;
  /** Worst |gap| among those same bins. */
  maxCalibrationError: number;
  /** Signed mean gap: negative = systematically overconfident. */
  calibrationBias: number;
  bins: CalibrationBin[];
  thresholdSweep: ThresholdPoint[];
  /** F1-maximizing threshold from the sweep, or `null` when the corpus is
   * too thin to recommend one. */
  recommendedClusterThreshold: number | null;
  /** The threshold currently configured (`gameConfig.altScoring`). */
  currentClusterThreshold: number;
  signalPrecision: SignalPrecision[];
  lowConfidence: boolean;
  /** Plain-English verdict for the admin UI header. */
  verdict: string;
  method: string;
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** One dispositioned ring reduced to what calibration needs. */
export interface DispositionedCluster {
  confidence: number;
  confirmed: boolean;
  signals: AltSignal[];
}

function toDispositioned(cluster: Pick<AltCluster, "status" | "confidence" | "signalSummary">) {
  return {
    confidence: Math.min(1, Math.max(0, cluster.confidence)),
    confirmed: cluster.status === "confirmed",
    signals: (cluster.signalSummary ?? []).filter((s) => s.count > 0).map((s) => s.type),
  };
}

function buildBins(samples: DispositionedCluster[]): CalibrationBin[] {
  const width = 1 / CALIBRATION_BIN_COUNT;
  const bins: CalibrationBin[] = [];

  for (let i = 0; i < CALIBRATION_BIN_COUNT; i++) {
    const lower = i * width;
    const upper = (i + 1) * width;
    // Top bin is inclusive at 1.0 so a perfectly-confident ring lands
    // somewhere rather than falling off the end.
    const inBin = samples.filter((s) =>
      i === CALIBRATION_BIN_COUNT - 1
        ? s.confidence >= lower && s.confidence <= upper
        : s.confidence >= lower && s.confidence < upper
    );
    const confirmedCount = inBin.filter((s) => s.confirmed).length;
    const meanPredicted = safeDiv(
      inBin.reduce((sum, s) => sum + s.confidence, 0),
      inBin.length
    );
    const observedRate = safeDiv(confirmedCount, inBin.length);
    bins.push({
      lower: round(lower, 2),
      upper: round(upper, 2),
      count: inBin.length,
      confirmedCount,
      meanPredicted: round(meanPredicted),
      observedRate: round(observedRate),
      gap: round(observedRate - meanPredicted),
      lowSample: inBin.length < MIN_BIN_SAMPLES,
    });
  }
  return bins;
}

function sweepThresholds(samples: DispositionedCluster[]): ThresholdPoint[] {
  return THRESHOLD_SWEEP.map((threshold) => {
    const surfaced = samples.filter((s) => s.confidence >= threshold);
    const truePositives = surfaced.filter((s) => s.confirmed).length;
    const falsePositives = surfaced.length - truePositives;
    const falseNegatives = samples.filter((s) => s.confidence < threshold && s.confirmed).length;
    const precision = safeDiv(truePositives, truePositives + falsePositives);
    const recall = safeDiv(truePositives, truePositives + falseNegatives);
    const f1 = safeDiv(2 * precision * recall, precision + recall);
    return {
      threshold,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
    };
  });
}

function buildSignalPrecision(
  samples: DispositionedCluster[],
  baseRate: number
): SignalPrecision[] {
  const signals = Object.keys(DEFAULT_ALT_SCORING_WEIGHTS) as AltSignal[];
  return signals
    .map((signal) => {
      const withSignal = samples.filter((s) => s.signals.includes(signal));
      const confirmedCount = withSignal.filter((s) => s.confirmed).length;
      const precision = safeDiv(confirmedCount, withSignal.length);
      return {
        signal,
        occurrences: withSignal.length,
        confirmedCount,
        precision: round(precision),
        lift: round(withSignal.length === 0 ? 0 : precision - baseRate),
        lowConfidence: withSignal.length < MIN_BIN_SAMPLES,
      };
    })
    .sort((a, b) => {
      if (a.lowConfidence !== b.lowConfidence) return a.lowConfidence ? 1 : -1;
      return b.lift - a.lift;
    });
}

function buildVerdict(args: {
  sampleSize: number;
  skillScore: number;
  calibrationBias: number;
  expectedCalibrationError: number;
}): string {
  const { sampleSize, skillScore, calibrationBias, expectedCalibrationError } = args;
  if (sampleSize === 0) {
    return "No rings have been confirmed or dismissed yet — calibration cannot be measured until moderators start dispositioning clusters.";
  }
  if (sampleSize < MIN_CALIBRATION_SAMPLES) {
    return `Only ${sampleSize} dispositioned ring(s) — below the ${MIN_CALIBRATION_SAMPLES}-sample floor. Treat every figure below as directional, not settled.`;
  }
  if (skillScore <= 0) {
    return `Confidence scores are not beating the base rate (skill score ${round(skillScore)}). Predicting the corpus average for every ring would be at least as accurate — the weights likely need work before the thresholds do.`;
  }
  const direction = calibrationBias < 0 ? "overconfident" : "underconfident";
  if (expectedCalibrationError <= 0.1) {
    return `Well calibrated (expected calibration error ${round(expectedCalibrationError)}, skill score ${round(skillScore)}) — a ring's stated confidence is close to how often rings at that confidence are confirmed.`;
  }
  return `Systematically ${direction} by ${round(Math.abs(calibrationBias))} on average (expected calibration error ${round(expectedCalibrationError)}). Confidence figures are directionally useful but should not be read as literal probabilities.`;
}

/**
 * Pure calibration maths over an already-labeled sample. Split out from the
 * DB read so it is directly testable and so callers with their own corpus
 * (a backfill script, a what-if analysis) can reuse it.
 */
export function computeCalibration(
  rawSamples: DispositionedCluster[],
  currentClusterThreshold: number
): CalibrationReport {
  // Clamp defensively so the bins always account for every sample. The DB
  // path already clamps, but a caller passing its own corpus should not be
  // able to make a ring vanish from the reliability plot by handing over an
  // out-of-range confidence.
  const samples = rawSamples.map((s) => ({
    ...s,
    confidence: Math.min(1, Math.max(0, s.confidence)),
  }));

  const confirmedTotal = samples.filter((s) => s.confirmed).length;
  const dismissedTotal = samples.length - confirmedTotal;
  const baseRate = safeDiv(confirmedTotal, samples.length);

  const brierScore = safeDiv(
    samples.reduce((sum, s) => sum + (s.confidence - (s.confirmed ? 1 : 0)) ** 2, 0),
    samples.length
  );
  const brierScoreBaseline = safeDiv(
    samples.reduce((sum, s) => sum + (baseRate - (s.confirmed ? 1 : 0)) ** 2, 0),
    samples.length
  );
  // Brier skill score. When the baseline is 0 the corpus is single-class
  // (every ring confirmed, or every ring dismissed) and skill is undefined —
  // report 0 rather than dividing by zero and claiming infinite skill.
  const skillScore = brierScoreBaseline === 0 ? 0 : 1 - brierScore / brierScoreBaseline;

  const bins = buildBins(samples);
  const scoredBins = bins.filter((bin) => !bin.lowSample && bin.count > 0);
  const scoredTotal = scoredBins.reduce((sum, bin) => sum + bin.count, 0);
  const expectedCalibrationError = safeDiv(
    scoredBins.reduce((sum, bin) => sum + bin.count * Math.abs(bin.gap), 0),
    scoredTotal
  );
  const maxCalibrationError = scoredBins.reduce((max, bin) => Math.max(max, Math.abs(bin.gap)), 0);
  const calibrationBias = safeDiv(
    scoredBins.reduce((sum, bin) => sum + bin.count * bin.gap, 0),
    scoredTotal
  );

  const thresholdSweep = sweepThresholds(samples);
  const lowConfidence = samples.length < MIN_CALIBRATION_SAMPLES;
  // Ties on F1 are common — with cleanly separated classes, every threshold
  // in the gap between them scores identically. Break the tie toward the
  // threshold CLOSEST to what is currently configured, so a setting that is
  // already optimal is never reported as something to change; only a
  // genuinely better threshold surfaces as a recommendation. Remaining ties
  // go to the lower threshold, which surfaces more rings for review — in a
  // report-only system a missed ring costs more than an extra review.
  const best = lowConfidence
    ? null
    : thresholdSweep.reduce<ThresholdPoint | null>((bestSoFar, point) => {
        if (bestSoFar === null || point.f1 > bestSoFar.f1) return point;
        if (point.f1 < bestSoFar.f1) return bestSoFar;
        const pointDistance = Math.abs(point.threshold - currentClusterThreshold);
        const bestDistance = Math.abs(bestSoFar.threshold - currentClusterThreshold);
        if (pointDistance < bestDistance) return point;
        return bestSoFar;
      }, null);

  return {
    generatedAt: new Date(),
    sampleSize: samples.length,
    confirmedTotal,
    dismissedTotal,
    baseRate: round(baseRate),
    brierScore: round(brierScore),
    brierScoreBaseline: round(brierScoreBaseline),
    skillScore: round(skillScore),
    expectedCalibrationError: round(expectedCalibrationError),
    maxCalibrationError: round(maxCalibrationError),
    calibrationBias: round(calibrationBias),
    bins,
    thresholdSweep,
    // A "recommendation" identical to the current setting is noise, and one
    // derived from an all-zero sweep (no confirmed rings at all) is
    // meaningless — suppress both.
    recommendedClusterThreshold:
      best === null || best.f1 === 0 || best.threshold === currentClusterThreshold
        ? null
        : best.threshold,
    currentClusterThreshold,
    signalPrecision: buildSignalPrecision(samples, baseRate),
    lowConfidence,
    verdict: buildVerdict({
      sampleSize: samples.length,
      skillScore,
      calibrationBias,
      expectedCalibrationError,
    }),
    method:
      "Ground truth is moderator disposition on altClusters: confirmed = true alt ring, dismissed = false positive; open/reviewed rings are unlabeled and excluded. " +
      "Reliability bins group dispositioned rings into ten 0.1-wide confidence buckets and compare each bucket's mean predicted confidence against its observed confirmed rate. " +
      "Brier score is the mean squared error of the predicted confidence (lower is better); the skill score compares it against always predicting the corpus base rate. " +
      "Expected calibration error is the sample-weighted mean absolute gap across bins with at least 3 rings. " +
      "The threshold sweep reports precision/recall/F1 for each candidate cluster auto-open threshold. Advisory only — apply any threshold change via PUT /api/admin/alts/config.",
  };
}

/**
 * Read dispositioned rings and the configured threshold, then compute the
 * calibration report. Pure read — never writes to `gameConfig` or
 * `altClusters`.
 */
export async function computeCalibrationReport(db: Db): Promise<CalibrationReport> {
  const [clusters, gameConfig] = await Promise.all([
    db
      .collection<AltCluster>("altClusters")
      .find(
        { status: { $in: ["confirmed", "dismissed"] as AltClusterStatus[] } },
        { projection: { status: 1, confidence: 1, signalSummary: 1 } }
      )
      .toArray(),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { altScoring: 1 } }),
  ]);

  const { thresholds } = resolveAltScoringConfig(gameConfig?.altScoring);
  return computeCalibration(clusters.map(toDispositioned), thresholds.cluster);
}
