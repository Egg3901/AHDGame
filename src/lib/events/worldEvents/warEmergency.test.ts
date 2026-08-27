import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { scoreGovernanceStyle } from "@/lib/governanceStyle/score";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import {
  applyCivilLibertiesDelta,
  DEMOCRATIC_HEALTH_METRIC_IDS,
  highTensionSharedGapTurns,
  isHighTensionSharedDue,
} from "./warEmergency";

describe("high-tension society staggering", () => {
  it("stays common while mitigation buys at most four extra turns", () => {
    const unmitigated = highTensionSharedGapTurns("US", 400, 0);
    const fullyMitigated = highTensionSharedGapTurns("US", 400, 45);
    expect(unmitigated).toBeGreaterThanOrEqual(3);
    expect(unmitigated).toBeLessThanOrEqual(6);
    expect(fullyMitigated).toBe(unmitigated + 4);
    expect(fullyMitigated).toBeLessThanOrEqual(10);
  });

  it("allows one first crisis, then enforces the shared country interval", () => {
    expect(isHighTensionSharedDue(400, "US", undefined, 0)).toBe(true);
    const gap = highTensionSharedGapTurns("US", 400, 20);
    expect(isHighTensionSharedDue(400 + gap - 1, "US", 400, 20)).toBe(false);
    expect(isHighTensionSharedDue(400 + gap, "US", 400, 20)).toBe(true);
  });
});

describe("civil-liberties consequences", () => {
  it("persistently lowers the full democratic-health basket", async () => {
    const db = createMockDb();
    db.collection("politicalMetrics");
    const values = Object.fromEntries(DEMOCRATIC_HEALTH_METRIC_IDS.map((id) => [id, 70])) as Record<
      PoliticalMetricId,
      number
    >;
    const residuals = Object.fromEntries(
      DEMOCRATIC_HEALTH_METRIC_IDS.map((id) => [id, 0])
    ) as Record<PoliticalMetricId, number>;
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "NY", countryId: "US", values, residuals, lastUpdated: new Date(0) },
        ]),
    });

    const before = scoreGovernanceStyle(values).democraticHealth.value;
    await applyCivilLibertiesDelta(db as never, "US", -7);

    const operations = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls[0]![0];
    const update = operations[0]!.updateOne.update.$set;
    const after = scoreGovernanceStyle(update.values).democraticHealth.value;
    expect(after).toBe(before - 7);
    for (const metricId of DEMOCRATIC_HEALTH_METRIC_IDS) {
      expect(update.values[metricId]).toBe(63);
      expect(update.residuals[metricId]).toBe(-7);
    }
  });

  it("clamps values and records only the applied structural loss", async () => {
    const db = createMockDb();
    db.collection("politicalMetrics");
    const values = Object.fromEntries(DEMOCRATIC_HEALTH_METRIC_IDS.map((id) => [id, 3])) as Record<
      PoliticalMetricId,
      number
    >;
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "MA", countryId: "US", values, residuals: {}, lastUpdated: new Date(0) },
        ]),
    });

    await applyCivilLibertiesDelta(db as never, "US", -7);

    const update =
      db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls[0]![0][0]!.updateOne.update.$set;
    for (const metricId of DEMOCRATIC_HEALTH_METRIC_IDS) {
      expect(update.values[metricId]).toBe(0);
      expect(update.residuals[metricId]).toBe(-3);
    }
  });
});
