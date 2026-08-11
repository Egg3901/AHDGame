import { describe, expect, it } from "vitest";
import type { StateMetrics } from "@/lib/db/types";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  computeStateMetricMarginModifier,
  getBlendedStrategyMetricMarginProfile,
  getMetricStrategyCoverage,
  getStrategyMetricMarginProfile,
  STATE_METRIC_PER_CHANNEL_CAP,
  STATE_METRIC_PER_METRIC_CAP,
  STATE_METRIC_TOTAL_CAP,
} from "./sectorMetricMarginProfiles";

function partialMetrics(doc: Record<string, unknown>): StateMetrics {
  return {
    _id: "US-CA",
    countryId: "US",
    lastUpdated: new Date(),
    ...doc,
  } as unknown as StateMetrics;
}

function balancedLegacyMetrics(): StateMetrics {
  return partialMetrics({
    economic: {
      unemploymentRate: { value: 3.5 },
      costOfLiving: { value: 98 },
    },
    education: {
      workforceSkill: { value: 53 },
    },
    infrastructure: {
      powerGridReliability: { value: 94.5 },
      broadbandAccess: { value: 68 },
      roadCondition: { value: 63 },
    },
    publicSafety: {
      crimeRate: { value: 1600 },
    },
    environment: {
      carbonEmissions: { value: 4 },
    },
    governance: {
      corruptionIndex: { value: 5 },
    },
  });
}

function extremeMetrics(): StateMetrics {
  const doc: Record<string, unknown> = {
    _id: "US-CA",
    countryId: "US",
    lastUpdated: new Date(),
  };
  for (const category of metricCategories) {
    const categoryDoc: Record<string, { value: number }> = {};
    for (const metric of category.metrics) {
      categoryDoc[metric.id] = {
        value: metric.isHigherBetter ? (metric.maxValue ?? 100) : (metric.minValue ?? 0),
      };
    }
    doc[category.id] = categoryDoc;
  }
  return doc as unknown as StateMetrics;
}

describe("sector metric margin profiles", () => {
  it("gives every official metric an effect or explicit neutral rationale for every strategy", () => {
    for (const [sectorType, strategies] of Object.entries(SECTOR_STRATEGIES) as Array<
      [CorporationType, (typeof SECTOR_STRATEGIES)[CorporationType]]
    >) {
      for (const strategy of strategies) {
        for (const category of metricCategories) {
          for (const metric of category.metrics) {
            const coverage = getMetricStrategyCoverage(
              sectorType,
              strategy.id,
              category.id,
              metric.id
            );
            expect(coverage.rationale.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("blends source and target strategy profiles during transitions", () => {
    const source = getStrategyMetricMarginProfile("retail", "brick_mortar");
    const target = getStrategyMetricMarginProfile("retail", "ecommerce");
    const blended = getBlendedStrategyMetricMarginProfile(
      "retail",
      "ecommerce",
      "brick_mortar",
      0.5
    );

    expect(blended.digitalInfrastructure).toBeCloseTo(
      (source.digitalInfrastructure + target.digitalInfrastructure) / 2
    );
    expect(blended.publicSafety).toBeCloseTo((source.publicSafety + target.publicSafety) / 2);
  });

  it("applies metric, channel, and total caps", () => {
    const result = computeStateMetricMarginModifier({
      sectorType: "technology",
      strategyId: "software",
      stateMetrics: extremeMetrics(),
      countryId: "US",
    });

    const byMetric = new Map<string, number>();
    const byChannel = new Map<string, number>();
    for (const contribution of result.contributions) {
      const metricKey = `${contribution.category}.${contribution.metricId}`;
      byMetric.set(metricKey, (byMetric.get(metricKey) ?? 0) + contribution.modifier);
      byChannel.set(
        contribution.channel,
        (byChannel.get(contribution.channel) ?? 0) + contribution.modifier
      );
    }

    for (const value of byMetric.values()) {
      expect(Math.abs(value)).toBeLessThanOrEqual(STATE_METRIC_PER_METRIC_CAP + 0.01);
    }
    for (const value of byChannel.values()) {
      expect(Math.abs(value)).toBeLessThanOrEqual(STATE_METRIC_PER_CHANNEL_CAP + 0.01);
    }
    expect(Math.abs(result.cappedTotal)).toBeLessThanOrEqual(STATE_METRIC_TOTAL_CAP);
  });

  it("keeps standard strategy close to legacy anchors for existing state metrics", () => {
    const result = computeStateMetricMarginModifier({
      sectorType: "manufacturing",
      strategyId: "standard",
      stateMetrics: balancedLegacyMetrics(),
      countryId: "US",
    });

    expect(Math.abs(result.cappedTotal - result.legacyTotal)).toBeLessThanOrEqual(0.75);
  });

  it("era existence gate: pre-window metrics contribute no signal; flag-off is untouched", () => {
    // Broadband's legacy formula is penalty-only (0 at high values), so use a
    // LOW value that produces a real penalty contribution on the legacy path —
    // exactly the anachronistic malus the gate must remove in a 1953 world.
    const lowBroadband = (): StateMetrics => {
      const m = extremeMetrics();
      (m.infrastructure as Record<string, { value: number }>).broadbandAccess = { value: 10 };
      return m;
    };

    const era1953 = computeStateMetricMarginModifier({
      sectorType: "technology",
      strategyId: "software",
      stateMetrics: lowBroadband(),
      countryId: "US",
      year: 1953,
    });
    expect(era1953.contributions.some((c) => c.metricId === "broadbandAccess")).toBe(false);

    const legacy = computeStateMetricMarginModifier({
      sectorType: "technology",
      strategyId: "software",
      stateMetrics: lowBroadband(),
      countryId: "US",
      year: null,
    });
    expect(legacy.contributions.some((c) => c.metricId === "broadbandAccess")).toBe(true);

    // flag-off result identical to omitting year entirely
    const omitted = computeStateMetricMarginModifier({
      sectorType: "technology",
      strategyId: "software",
      stateMetrics: lowBroadband(),
      countryId: "US",
    });
    expect(legacy.cappedTotal).toBe(omitted.cappedTotal);
  });
});
