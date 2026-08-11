import { describe, it, expect } from "vitest";
import type { AltSignal } from "@/lib/db/types/altDetection";
import {
  computeCalibration,
  MIN_CALIBRATION_SAMPLES,
  type DispositionedCluster,
} from "./calibration";

function sample(
  confidence: number,
  confirmed: boolean,
  signals: AltSignal[] = []
): DispositionedCluster {
  return { confidence, confirmed, signals };
}

/** `n` rings at `confidence`, of which `confirmedCount` were confirmed. */
function bucket(
  confidence: number,
  n: number,
  confirmedCount: number,
  signals: AltSignal[] = []
): DispositionedCluster[] {
  return Array.from({ length: n }, (_, i) => sample(confidence, i < confirmedCount, signals));
}

describe("computeCalibration — empty and thin corpora", () => {
  it("reports a zeroed, low-confidence report with no recommendation when nothing is dispositioned", () => {
    const report = computeCalibration([], 0.6);
    expect(report.sampleSize).toBe(0);
    expect(report.brierScore).toBe(0);
    expect(report.skillScore).toBe(0);
    expect(report.lowConfidence).toBe(true);
    expect(report.recommendedClusterThreshold).toBeNull();
    expect(report.verdict).toMatch(/No rings have been confirmed or dismissed/i);
  });

  it("withholds a threshold recommendation below the sample floor", () => {
    const samples = bucket(0.9, 5, 5);
    expect(samples.length).toBeLessThan(MIN_CALIBRATION_SAMPLES);
    const report = computeCalibration(samples, 0.6);
    expect(report.lowConfidence).toBe(true);
    expect(report.recommendedClusterThreshold).toBeNull();
    expect(report.verdict).toMatch(/below the \d+-sample floor/i);
  });

  it("does not divide by zero on a single-class corpus", () => {
    const report = computeCalibration(bucket(0.9, 30, 30), 0.6);
    expect(report.baseRate).toBe(1);
    // Every ring confirmed => the base-rate baseline is a perfect predictor,
    // so skill is undefined rather than infinite.
    expect(report.brierScoreBaseline).toBe(0);
    expect(report.skillScore).toBe(0);
    expect(Number.isFinite(report.brierScore)).toBe(true);
  });
});

describe("computeCalibration — reliability bins", () => {
  it("bins by predicted confidence and measures the gap to the observed rate", () => {
    // 10 rings at 0.85, 5 confirmed => observed 0.5 against a predicted
    // 0.85: badly overconfident.
    const report = computeCalibration(bucket(0.85, 10, 5), 0.6);
    const bin = report.bins.find((b) => b.lower === 0.8);
    expect(bin).toBeDefined();
    expect(bin!.count).toBe(10);
    expect(bin!.confirmedCount).toBe(5);
    expect(bin!.meanPredicted).toBe(0.85);
    expect(bin!.observedRate).toBe(0.5);
    expect(bin!.gap).toBeCloseTo(-0.35, 5);
    expect(report.calibrationBias).toBeLessThan(0);
  });

  it("places a perfectly-confident ring in the top bin rather than dropping it", () => {
    const report = computeCalibration(bucket(1, 4, 4), 0.6);
    const top = report.bins[report.bins.length - 1];
    expect(top.upper).toBe(1);
    expect(top.count).toBe(4);
    expect(report.bins.reduce((sum, b) => sum + b.count, 0)).toBe(4);
  });

  it("flags thin bins and excludes them from the expected calibration error", () => {
    const samples = [
      ...bucket(0.85, 20, 17), // well-populated, gap = 0.85 - 0.85 = 0
      ...bucket(0.15, 1, 1), // single ring, wildly off — must not dominate
    ];
    const report = computeCalibration(samples, 0.6);
    const thin = report.bins.find((b) => b.lower === 0.1);
    expect(thin!.lowSample).toBe(true);
    expect(Math.abs(thin!.gap)).toBeGreaterThan(0.8);
    // ECE comes only from the populated bin, whose gap is essentially zero.
    expect(report.expectedCalibrationError).toBeLessThan(0.05);
  });

  it("scores a well-calibrated corpus with a low Brier score and a positive skill score", () => {
    const samples = [
      ...bucket(0.9, 20, 18), // predicted 0.9, observed 0.9
      ...bucket(0.5, 20, 10), // predicted 0.5, observed 0.5
      ...bucket(0.1, 20, 2), // predicted 0.1, observed 0.1
    ];
    const report = computeCalibration(samples, 0.6);
    expect(report.expectedCalibrationError).toBeLessThan(0.02);
    expect(report.skillScore).toBeGreaterThan(0.4);
    expect(report.brierScore).toBeLessThan(report.brierScoreBaseline);
    expect(report.verdict).toMatch(/Well calibrated/i);
  });

  it("reports no skill when confidence is unrelated to the outcome", () => {
    // Every bucket confirmed at the same 50% rate regardless of confidence:
    // the score carries no information about the label.
    const samples = [...bucket(0.9, 20, 10), ...bucket(0.5, 20, 10), ...bucket(0.1, 20, 10)];
    const report = computeCalibration(samples, 0.6);
    expect(report.skillScore).toBeLessThanOrEqual(0);
    expect(report.verdict).toMatch(/not beating the base rate/i);
  });
});

describe("computeCalibration — threshold sweep", () => {
  it("computes precision/recall/F1 at each candidate threshold", () => {
    // Confirmed rings sit at 0.9, dismissed at 0.5. A 0.6 threshold is
    // perfect; 0.4 admits every false positive.
    const samples = [...bucket(0.9, 15, 15), ...bucket(0.5, 15, 0)];
    const report = computeCalibration(samples, 0.9);

    const at60 = report.thresholdSweep.find((p) => p.threshold === 0.6)!;
    expect(at60.truePositives).toBe(15);
    expect(at60.falsePositives).toBe(0);
    expect(at60.falseNegatives).toBe(0);
    expect(at60.precision).toBe(1);
    expect(at60.recall).toBe(1);
    expect(at60.f1).toBe(1);

    const at40 = report.thresholdSweep.find((p) => p.threshold === 0.4)!;
    expect(at40.falsePositives).toBe(15);
    expect(at40.precision).toBe(0.5);
    expect(at40.recall).toBe(1);
  });

  it("recommends the nearest F1-maximizing threshold when the configured one is not optimal", () => {
    const samples = [...bucket(0.9, 15, 15), ...bucket(0.5, 15, 0)];
    // Classes separate cleanly at 0.5/0.9, so every threshold from 0.55
    // upward scores F1 = 1. Configured at 0.4 (admits every dismissed ring),
    // so the recommendation is the nearest optimal point — the smallest
    // change that fixes it, not an arbitrary pick from the tied set.
    const report = computeCalibration(samples, 0.4);
    expect(report.currentClusterThreshold).toBe(0.4);
    expect(report.recommendedClusterThreshold).toBe(0.55);
  });

  it("suppresses a recommendation when the configured threshold is already among the optimal set", () => {
    const samples = [...bucket(0.9, 15, 15), ...bucket(0.5, 15, 0)];
    // 0.6 ties with 0.55/0.65/... at F1 = 1. Recommending any of the others
    // would be pure churn, so the tie-break keeps the current value and the
    // recommendation is suppressed.
    const report = computeCalibration(samples, 0.6);
    expect(report.thresholdSweep.find((p) => p.threshold === 0.6)!.f1).toBe(1);
    expect(report.recommendedClusterThreshold).toBeNull();
  });

  it("suppresses a recommendation when no threshold separates anything", () => {
    // Nothing confirmed at all: every F1 in the sweep is 0, so the
    // 'best' point is meaningless.
    const report = computeCalibration(bucket(0.9, 25, 0), 0.6);
    expect(report.thresholdSweep.every((p) => p.f1 === 0)).toBe(true);
    expect(report.recommendedClusterThreshold).toBeNull();
  });
});

describe("computeCalibration — per-signal precision", () => {
  it("ranks signals by lift over the base rate", () => {
    const samples = [
      ...bucket(0.9, 10, 10, ["device_fingerprint_exact"]), // always right
      ...bucket(0.7, 10, 0, ["subnet_/24_share"]), // always wrong
      ...bucket(0.5, 10, 5, ["ip_exact_nonCF"]), // coin flip
    ];
    const report = computeCalibration(samples, 0.6);
    expect(report.baseRate).toBe(0.5);

    const byName = new Map(report.signalPrecision.map((s) => [s.signal, s]));
    expect(byName.get("device_fingerprint_exact")!.precision).toBe(1);
    expect(byName.get("device_fingerprint_exact")!.lift).toBe(0.5);
    expect(byName.get("subnet_/24_share")!.precision).toBe(0);
    expect(byName.get("subnet_/24_share")!.lift).toBe(-0.5);
    expect(byName.get("ip_exact_nonCF")!.lift).toBe(0);

    // Sorted most-useful-first, with thin-sample signals pushed to the back.
    const confident = report.signalPrecision.filter((s) => !s.lowConfidence);
    expect(confident[0].signal).toBe("device_fingerprint_exact");
    const firstLowIdx = report.signalPrecision.findIndex((s) => s.lowConfidence);
    expect(report.signalPrecision.slice(firstLowIdx).every((s) => s.lowConfidence)).toBe(true);
  });

  it("reports never-seen signals with zero occurrences and zero lift, not negative lift", () => {
    const report = computeCalibration(bucket(0.9, 20, 10, ["oauth_shared"]), 0.6);
    const unseen = report.signalPrecision.find((s) => s.signal === "session_handoff")!;
    expect(unseen.occurrences).toBe(0);
    expect(unseen.lift).toBe(0);
    expect(unseen.lowConfidence).toBe(true);
  });

  it("covers every signal in the weight table so the UI never has a hole", () => {
    const report = computeCalibration(bucket(0.9, 20, 10), 0.6);
    expect(report.signalPrecision.length).toBeGreaterThanOrEqual(21);
    expect(report.signalPrecision.map((s) => s.signal)).toContain("activity_rhythm");
  });
});

describe("computeCalibration — input hygiene", () => {
  it("clamps out-of-range confidences into the bins instead of losing them", () => {
    const report = computeCalibration(
      [{ confidence: 1.4, confirmed: true, signals: [] }, sample(0.5, false)],
      0.6
    );
    expect(report.bins.reduce((sum, b) => sum + b.count, 0)).toBe(2);
  });
});
