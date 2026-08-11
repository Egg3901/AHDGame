import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_ALT_SCORING_WEIGHTS } from "./config";
import {
  computeTuningSuggestions,
  MAX_WEIGHT_DELTA,
  MIN_SIGNAL_SAMPLES,
  MIN_TOTAL_CLUSTERS,
} from "./tuning";
import type { AltClusterStatus, AltSignal } from "@/lib/db/types/altDetection";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("altClusters");
  db.collection("gameConfig");
});

/** Minimal cluster fixture — only the fields `computeTuningSuggestions`
 * reads (`status`, `signalSummary`). */
function makeCluster(status: AltClusterStatus, signals: AltSignal[]) {
  return {
    _id: new ObjectId(),
    status,
    signalSummary: signals.map((type) => ({ type, count: 1, maxContribution: 0.5 })),
  };
}

function mockClusters(clusters: ReturnType<typeof makeCluster>[]) {
  db.collectionMocks.altClusters.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(clusters),
  });
}

function mockNoOverride() {
  db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
}

describe("computeTuningSuggestions", () => {
  it("suggests raising the weight for a signal seen only in confirmed rings, above the sample guard", async () => {
    mockNoOverride();
    const confirmed = Array.from({ length: MIN_SIGNAL_SAMPLES }, () =>
      makeCluster("confirmed", ["email_alias_match"])
    );
    const dismissed = Array.from({ length: MIN_SIGNAL_SAMPLES }, () =>
      makeCluster("dismissed", [])
    );
    mockClusters([...confirmed, ...dismissed]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const s = report.suggestions.find((x) => x.signal === "email_alias_match")!;

    expect(s.lowConfidence).toBe(false);
    expect(s.confirmedCount).toBe(MIN_SIGNAL_SAMPLES);
    expect(s.dismissedCount).toBe(0);
    expect(s.discrimination).toBe(1);
    expect(s.suggestedWeight).toBeGreaterThan(s.currentWeight);
    expect(s.suggestedWeight).toBeCloseTo(Math.min(1, s.currentWeight + MAX_WEIGHT_DELTA * 1), 5);
    expect(s.rationale).toMatch(/confirmed rings/);
    expect(s.rationale).toMatch(/raising weight/);
  });

  it("suggests lowering the weight for a signal seen only in dismissed rings, above the sample guard", async () => {
    mockNoOverride();
    const confirmed = Array.from({ length: MIN_SIGNAL_SAMPLES }, () =>
      makeCluster("confirmed", [])
    );
    const dismissed = Array.from({ length: MIN_SIGNAL_SAMPLES }, () =>
      makeCluster("dismissed", ["referral_link"])
    );
    mockClusters([...confirmed, ...dismissed]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const s = report.suggestions.find((x) => x.signal === "referral_link")!;

    expect(s.lowConfidence).toBe(false);
    expect(s.confirmedCount).toBe(0);
    expect(s.dismissedCount).toBe(MIN_SIGNAL_SAMPLES);
    expect(s.discrimination).toBe(-1);
    expect(s.suggestedWeight).toBeLessThan(s.currentWeight);
    expect(s.suggestedWeight).toBeCloseTo(Math.max(0, s.currentWeight - MAX_WEIGHT_DELTA * 1), 5);
    expect(s.rationale).toMatch(/dismissed \(false-positive\) rings/);
    expect(s.rationale).toMatch(/lowering weight/);
  });

  it("flags low-confidence and suggests no change when a signal's sample is below the min-sample guard", async () => {
    mockNoOverride();
    // Only one occurrence total, well under MIN_SIGNAL_SAMPLES.
    mockClusters([makeCluster("confirmed", ["subnet_/24_share"])]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const s = report.suggestions.find((x) => x.signal === "subnet_/24_share")!;

    expect(s.lowConfidence).toBe(true);
    expect(s.suggestedWeight).toBe(s.currentWeight);
    expect(s.rationale).toMatch(/min-sample guard/);
  });

  it("flags the report itself low-confidence when the overall corpus is below MIN_TOTAL_CLUSTERS", async () => {
    mockNoOverride();
    mockClusters([makeCluster("confirmed", ["oauth_shared"])]);

    const report = await computeTuningSuggestions(db as unknown as Db);

    expect(report.confirmedTotal + report.dismissedTotal).toBeLessThan(MIN_TOTAL_CLUSTERS);
    expect(report.lowConfidence).toBe(true);
  });

  it("does not flag the report low-confidence once the overall corpus clears MIN_TOTAL_CLUSTERS", async () => {
    mockNoOverride();
    const confirmed = Array.from({ length: MIN_TOTAL_CLUSTERS }, () =>
      makeCluster("confirmed", ["device_fingerprint_exact"])
    );
    mockClusters(confirmed);

    const report = await computeTuningSuggestions(db as unknown as Db);
    expect(report.lowConfidence).toBe(false);
  });

  it("covers every signal in the weight registry, exactly once", async () => {
    mockNoOverride();
    mockClusters([]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const registrySignals = Object.keys(DEFAULT_ALT_SCORING_WEIGHTS).sort();
    const suggestedSignals = report.suggestions.map((s) => s.signal).sort();
    expect(suggestedSignals).toEqual(registrySignals);
  });

  it("with zero confirmed and zero dismissed rings, every signal is low-confidence with no change", async () => {
    mockNoOverride();
    mockClusters([]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    expect(report.confirmedTotal).toBe(0);
    expect(report.dismissedTotal).toBe(0);
    expect(report.lowConfidence).toBe(true);
    for (const s of report.suggestions) {
      expect(s.lowConfidence).toBe(true);
      expect(s.suggestedWeight).toBe(s.currentWeight);
    }
  });

  it("clamps the suggested weight to [0, 1] even at the extremes", async () => {
    mockNoOverride();
    // oauth_shared defaults to 0.97 — pushing it up by the full MAX_WEIGHT_DELTA
    // must still clamp at 1, not overshoot.
    const confirmed = Array.from({ length: MIN_SIGNAL_SAMPLES }, () =>
      makeCluster("confirmed", ["oauth_shared"])
    );
    mockClusters(confirmed);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const s = report.suggestions.find((x) => x.signal === "oauth_shared")!;
    expect(s.suggestedWeight).toBeLessThanOrEqual(1);
    expect(s.suggestedWeight).toBeGreaterThanOrEqual(0);
  });

  it("ignores open and reviewed clusters — only confirmed/dismissed feed the analysis", async () => {
    mockNoOverride();
    mockClusters([
      makeCluster("open", ["oauth_shared"]),
      makeCluster("reviewed", ["oauth_shared"]),
    ]);
    // The find() call itself should filter server-side; assert the query shape.
    await computeTuningSuggestions(db as unknown as Db);
    expect(db.collectionMocks.altClusters.find).toHaveBeenCalledWith(
      { status: { $in: ["confirmed", "dismissed"] } },
      expect.objectContaining({ projection: expect.any(Object) })
    );
  });

  it("uses the admin-overridden weight (not the hardcoded default) as currentWeight", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      altScoring: { weights: { oauth_shared: 0.5 } },
    });
    mockClusters([]);

    const report = await computeTuningSuggestions(db as unknown as Db);
    const s = report.suggestions.find((x) => x.signal === "oauth_shared")!;
    expect(s.currentWeight).toBe(0.5);
  });
});
