import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type {
  AltLink,
  AltLinkSignal,
  AltScoringRunRecord,
  AltSignal,
} from "@/lib/db/types/altDetection";
import {
  buildMetricsReport,
  buildRunMetrics,
  buildSignalStats,
  confidenceBucket,
  CONFIDENCE_BUCKET_COUNT,
  TREND_WINDOW_RUNS,
  type RunMetricsInput,
} from "./runMetrics";

const NOW = new Date("2026-07-20T12:00:00Z");

function signal(type: AltSignal, weight: number, contribution = weight): AltLinkSignal {
  return { type, weight, contribution, evidence: `${type} evidence`, detectedAt: NOW };
}

function link(confidence: number, signals: AltLinkSignal[] = []): AltLink {
  return {
    _id: new ObjectId(),
    userA: new ObjectId(),
    userB: new ObjectId(),
    confidence,
    signals,
    updatedAt: NOW,
    turn: 1,
  };
}

function runInput(overrides: Partial<RunMetricsInput> = {}): RunMetricsInput {
  return {
    turn: 1,
    enabled: true,
    dryRun: false,
    candidateCount: 10,
    candidatePoolTruncated: false,
    links: [],
    linksWritten: 0,
    clustersComputed: 0,
    clustersWritten: 0,
    clustersOpened: 0,
    durationMs: 100,
    escalationCount: 0,
    newLinkCount: 0,
    at: NOW,
    ...overrides,
  };
}

describe("confidenceBucket", () => {
  it("maps a confidence to its 0.1-wide bucket", () => {
    expect(confidenceBucket(0)).toBe(0);
    expect(confidenceBucket(0.05)).toBe(0);
    expect(confidenceBucket(0.35)).toBe(3);
    expect(confidenceBucket(0.99)).toBe(9);
  });

  it("puts a perfect 1.0 in the top bucket rather than off the end", () => {
    expect(confidenceBucket(1)).toBe(CONFIDENCE_BUCKET_COUNT - 1);
  });

  it("clamps out-of-range values instead of producing a bad index", () => {
    expect(confidenceBucket(-2)).toBe(0);
    expect(confidenceBucket(4)).toBe(CONFIDENCE_BUCKET_COUNT - 1);
  });
});

describe("buildSignalStats", () => {
  it("separates signals that fired from ones a guard zeroed", () => {
    const links = [
      link(0.9, [signal("ip_exact_nonCF", 0.35), signal("device_fingerprint_exact", 0.95)]),
      // Same signal type, but guarded to zero (CF-edge IP / degenerate hash).
      link(0.2, [signal("ip_exact_nonCF", 0), signal("device_fingerprint_exact", 0)]),
      link(0.4, [signal("ip_exact_nonCF", 0.35)]),
    ];
    const stats = buildSignalStats(links);
    const ip = stats.find((s) => s.type === "ip_exact_nonCF")!;
    expect(ip.firedCount).toBe(2);
    expect(ip.guardedZeroCount).toBe(1);
    expect(ip.meanWeight).toBeCloseTo(0.35, 5);
  });

  it("averages weight and contribution only over the links where it fired", () => {
    const links = [
      link(0.5, [signal("wire_graph_link", 0.2, 0.1)]),
      link(0.5, [signal("wire_graph_link", 0.4, 0.3)]),
      link(0.5, [signal("wire_graph_link", 0)]), // guarded — must not drag the mean down
    ];
    const stat = buildSignalStats(links).find((s) => s.type === "wire_graph_link")!;
    expect(stat.meanWeight).toBeCloseTo(0.3, 5);
    expect(stat.meanContribution).toBeCloseTo(0.2, 5);
  });

  it("reports nothing for a signal that never appeared", () => {
    const stats = buildSignalStats([link(0.5, [signal("oauth_shared", 0.97)])]);
    expect(stats.map((s) => s.type)).toEqual(["oauth_shared"]);
  });

  it("sorts by firing volume, most active first", () => {
    const links = [
      link(0.5, [signal("ip_exact_nonCF", 0.35), signal("oauth_shared", 0.97)]),
      link(0.5, [signal("ip_exact_nonCF", 0.35)]),
    ];
    expect(buildSignalStats(links)[0].type).toBe("ip_exact_nonCF");
  });
});

describe("buildRunMetrics", () => {
  it("histograms link confidences into ten buckets that sum to the link count", () => {
    const links = [link(0.05), link(0.35), link(0.36), link(0.95), link(1)];
    const record = buildRunMetrics(runInput({ links }));
    expect(record.confidenceHistogram).toHaveLength(CONFIDENCE_BUCKET_COUNT);
    expect(record.confidenceHistogram[0]).toBe(1);
    expect(record.confidenceHistogram[3]).toBe(2);
    expect(record.confidenceHistogram[9]).toBe(2);
    expect(record.confidenceHistogram.reduce((a, b) => a + b, 0)).toBe(links.length);
    expect(record.linksComputed).toBe(links.length);
  });

  it("computes mean and p95 confidence", () => {
    const links = Array.from({ length: 20 }, (_, i) => link((i + 1) / 20));
    const record = buildRunMetrics(runInput({ links }));
    expect(record.meanLinkConfidence).toBeCloseTo(0.525, 3);
    expect(record.p95LinkConfidence).toBeCloseTo(0.95, 3);
  });

  it("zeroes the distribution stats for an empty run rather than producing NaN", () => {
    const record = buildRunMetrics(runInput({ links: [] }));
    expect(record.meanLinkConfidence).toBe(0);
    expect(record.p95LinkConfidence).toBe(0);
    expect(record.confidenceHistogram.every((n) => n === 0)).toBe(true);
  });

  it("carries the operational flags an operator needs to interpret the run", () => {
    const record = buildRunMetrics(
      runInput({
        candidatePoolTruncated: true,
        dryRun: true,
        enabled: false,
        escalationCount: 3,
        newLinkCount: 7,
        error: "boom",
      })
    );
    expect(record.candidatePoolTruncated).toBe(true);
    expect(record.dryRun).toBe(true);
    expect(record.enabled).toBe(false);
    expect(record.escalationCount).toBe(3);
    expect(record.newLinkCount).toBe(7);
    expect(record.error).toBe("boom");
  });

  it("omits `error` entirely on a clean run", () => {
    expect(buildRunMetrics(runInput()).error).toBeUndefined();
  });
});

describe("buildMetricsReport", () => {
  function record(overrides: Partial<AltScoringRunRecord> & { at: Date }): AltScoringRunRecord {
    return {
      ...buildRunMetrics(runInput({ at: overrides.at })),
      ...overrides,
    };
  }

  /** `count` runs, newest first, each with the given signal firing volume. */
  function runsWithSignal(count: number, type: AltSignal, firedCount: number, startHour: number) {
    return Array.from({ length: count }, (_, i) =>
      record({
        at: new Date(Date.UTC(2026, 6, 20, startHour - i)),
        signalStats: [
          { type, firedCount, guardedZeroCount: 0, meanWeight: 0.5, meanContribution: 0.5 },
        ],
        linksComputed: firedCount,
      })
    );
  }

  it("returns an empty, warning-free report when there is no history yet", () => {
    const report = buildMetricsReport([]);
    expect(report.latestRun).toBeNull();
    expect(report.windowSize).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.signalTrends).toEqual([]);
  });

  it("does not claim a signal went silent when there is no prior window to compare", () => {
    const report = buildMetricsReport(runsWithSignal(3, "ip_exact_nonCF", 5, 12));
    expect(report.signalTrends.every((t) => !t.wentSilent)).toBe(true);
    expect(report.warnings.some((w) => /has not fired at all/i.test(w))).toBe(false);
  });

  it("flags a signal that fired in the prior window and has gone silent", () => {
    const recent = Array.from({ length: TREND_WINDOW_RUNS }, (_, i) =>
      record({
        at: new Date(Date.UTC(2026, 6, 20, 23 - i)),
        signalStats: [
          {
            type: "oauth_shared",
            firedCount: 2,
            guardedZeroCount: 0,
            meanWeight: 0.97,
            meanContribution: 0.97,
          },
        ],
        linksComputed: 2,
      })
    );
    const prior = Array.from({ length: TREND_WINDOW_RUNS }, (_, i) =>
      record({
        at: new Date(Date.UTC(2026, 6, 19, 23 - i)),
        signalStats: [
          {
            type: "oauth_shared",
            firedCount: 2,
            guardedZeroCount: 0,
            meanWeight: 0.97,
            meanContribution: 0.97,
          },
          {
            type: "device_fingerprint_exact",
            firedCount: 6,
            guardedZeroCount: 0,
            meanWeight: 0.95,
            meanContribution: 0.95,
          },
        ],
        linksComputed: 8,
      })
    );

    const report = buildMetricsReport([...recent, ...prior]);
    const silent = report.signalTrends.find((t) => t.type === "device_fingerprint_exact")!;
    expect(silent.priorMeanFired).toBe(6);
    expect(silent.recentMeanFired).toBe(0);
    expect(silent.delta).toBe(-6);
    expect(silent.wentSilent).toBe(true);
    expect(report.warnings.some((w) => /device_fingerprint_exact/.test(w))).toBe(true);

    // The steady signal is not flagged.
    const steady = report.signalTrends.find((t) => t.type === "oauth_shared")!;
    expect(steady.wentSilent).toBe(false);
    expect(steady.delta).toBe(0);
  });

  it("sorts trends by the sharpest decline first", () => {
    const report = buildMetricsReport([
      ...Array.from({ length: TREND_WINDOW_RUNS }, (_, i) =>
        record({
          at: new Date(Date.UTC(2026, 6, 20, 23 - i)),
          signalStats: [
            {
              type: "ip_exact_nonCF",
              firedCount: 1,
              guardedZeroCount: 0,
              meanWeight: 0.35,
              meanContribution: 0.35,
            },
          ],
        })
      ),
      ...Array.from({ length: TREND_WINDOW_RUNS }, (_, i) =>
        record({
          at: new Date(Date.UTC(2026, 6, 19, 23 - i)),
          signalStats: [
            {
              type: "ip_exact_nonCF",
              firedCount: 9,
              guardedZeroCount: 0,
              meanWeight: 0.35,
              meanContribution: 0.35,
            },
          ],
        })
      ),
    ]);
    expect(report.signalTrends[0].type).toBe("ip_exact_nonCF");
    expect(report.signalTrends[0].delta).toBeLessThan(0);
  });

  it("warns about errored and truncated runs in the recent window", () => {
    const report = buildMetricsReport([
      record({ at: new Date(Date.UTC(2026, 6, 20, 12)), error: "boom", linksComputed: 4 }),
      record({
        at: new Date(Date.UTC(2026, 6, 20, 11)),
        candidatePoolTruncated: true,
        linksComputed: 4,
      }),
      record({ at: new Date(Date.UTC(2026, 6, 20, 10)), linksComputed: 4 }),
    ]);
    expect(report.erroredRuns).toBe(1);
    expect(report.truncatedRuns).toBe(1);
    expect(report.warnings.some((w) => /recorded an error/i.test(w))).toBe(true);
    expect(report.warnings.some((w) => /candidate-pool cap/i.test(w))).toBe(true);
  });

  it("warns when every recent run scored zero links", () => {
    const report = buildMetricsReport(
      Array.from({ length: 5 }, (_, i) =>
        record({ at: new Date(Date.UTC(2026, 6, 20, 12 - i)), linksComputed: 0 })
      )
    );
    expect(report.warnings.some((w) => /No links were scored/i.test(w))).toBe(true);
  });

  it("stays quiet on a healthy history", () => {
    const report = buildMetricsReport(runsWithSignal(6, "ip_exact_nonCF", 4, 12));
    expect(report.warnings).toEqual([]);
    expect(report.latestRun).not.toBeNull();
    expect(report.windowSize).toBe(6);
  });
});
