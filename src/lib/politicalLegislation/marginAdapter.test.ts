import { describe, expect, it } from "vitest";
import {
  METRIC_MARGIN_SIGNALS,
  STATE_METRIC_PER_METRIC_CAP,
  computeStateMetricMarginModifier,
  metricKey,
} from "@/lib/corporations/sectorMetricMarginProfiles";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { StateMetrics } from "@/lib/db/types";
import {
  ADAPTER_TIER1,
  ADAPTER_TIER2_CATEGORY,
  SURVIVOR_SIGNAL_CATEGORIES,
  buildPoliticalBaseModifiers,
  politicalValueForLegacyMetric,
} from "./marginAdapter";

function board(value: number, overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = overrides[f.id] ?? value;
  return out;
}

/** The headline-eight political signals (legacy-formula rows the spec calls out). */
const HEADLINE_POLITICAL = [
  ["publicSafety", "crimeRate"],
  ["governance", "corruptionIndex"],
  ["infrastructure", "powerGridReliability"],
  ["infrastructure", "broadbandAccess"],
  ["infrastructure", "roadCondition"],
  ["environment", "carbonEmissions"],
  ["education", "workforceSkill"],
] as const;

describe("census completeness (spec §4a: no signal silently drops)", () => {
  it("classifies every non-neutral signal row as survivor, tier 1, or tier 2", () => {
    for (const signal of METRIC_MARGIN_SIGNALS) {
      if (Object.keys(signal.channels).length === 0) continue;
      const key = metricKey(signal.category, signal.metricId);
      const classified =
        SURVIVOR_SIGNAL_CATEGORIES.has(signal.category) ||
        ADAPTER_TIER1[key] != null ||
        ADAPTER_TIER2_CATEGORY[signal.category] != null;
      expect(classified, `unclassified margin signal: ${key}`).toBe(true);
    }
  });

  it("tier-1 keys reference real signal rows and real SP1 families; never survivors", () => {
    const signalKeys = new Set(METRIC_MARGIN_SIGNALS.map((s) => metricKey(s.category, s.metricId)));
    const familyIds = new Set(POLITICAL_METRIC_FAMILIES.map((f) => f.id));
    for (const [key, familyId] of Object.entries(ADAPTER_TIER1)) {
      expect(signalKeys.has(key), `tier-1 key has no signal row: ${key}`).toBe(true);
      expect(familyIds.has(familyId), `tier-1 maps to unknown family: ${familyId}`).toBe(true);
      expect(SURVIVOR_SIGNAL_CATEGORIES.has(key.split(".")[0])).toBe(false);
    }
  });

  it("builds an entry for every political signal and none for survivors", () => {
    const overlay = buildPoliticalBaseModifiers(board(50));
    for (const signal of METRIC_MARGIN_SIGNALS) {
      const key = metricKey(signal.category, signal.metricId);
      const expected =
        Object.keys(signal.channels).length > 0 && !SURVIVOR_SIGNAL_CATEGORIES.has(signal.category);
      expect(overlay.has(key), key).toBe(expected);
    }
  });
});

describe("direction fixtures (headline signals + aggregate)", () => {
  it("each headline political signal moves with its mapped family, same sign as quality", () => {
    for (const [category, metricId] of HEADLINE_POLITICAL) {
      const key = `${category}.${metricId}`;
      const familyId = ADAPTER_TIER1[key]!;
      const good = buildPoliticalBaseModifiers(board(50, { [familyId]: 80 })).get(key)!;
      const bad = buildPoliticalBaseModifiers(board(50, { [familyId]: 20 })).get(key)!;
      expect(good.modifier).toBeGreaterThan(0);
      expect(bad.modifier).toBeLessThan(0);
      expect(good.modifier).toBeCloseTo((30 / 50) * STATE_METRIC_PER_METRIC_CAP, 9);
    }
  });

  it("a degraded board lowers the sector margin total vs an improved board (US region)", () => {
    const run = (v: number) =>
      computeStateMetricMarginModifier({
        sectorType: "retail",
        // Demolished doc: only survivor categories present.
        stateMetrics: { _id: "MI", countryId: "US" } as unknown as StateMetrics,
        countryId: "US",
        year: null,
        politicalBaseModifiers: buildPoliticalBaseModifiers(board(v)),
      });
    expect(run(70).cappedTotal).toBeGreaterThan(run(30).cappedTotal);
  });

  it("JP path is byte-identical: no overlay → political signals contribute nothing on a full doc read", () => {
    const jpDoc = {
      _id: "TOK",
      countryId: "JP",
      economic: { unemploymentRate: { value: 4 } },
    } as unknown as StateMetrics;
    const withNull = computeStateMetricMarginModifier({
      sectorType: "retail",
      stateMetrics: jpDoc,
      countryId: "JP",
      year: null,
      politicalBaseModifiers: null,
    });
    const without = computeStateMetricMarginModifier({
      sectorType: "retail",
      stateMetrics: jpDoc,
      countryId: "JP",
      year: null,
    });
    expect(withNull).toEqual(without);
  });
});

describe("politicalSoeInputs (SOE penalty governance reads)", () => {
  it("inverts integrity into the legacy corruption scale and passes openness through", async () => {
    const { politicalSoeInputs } = await import("./marginAdapter");
    const values = board(50, { "governance.integrity": 80, "governance.openness": 65 });
    const inputs = politicalSoeInputs(values);
    // integrity 80 (clean) → corruptionIndex 20 (low corruption).
    expect(inputs.corruptionIndex).toBe(20);
    expect(inputs.governmentTransparency).toBe(65);
  });
});

describe("politicalValueForLegacyMetric (crisis trigger read)", () => {
  it("resolves powerGridReliability from infrastructure.utilities", () => {
    const values = board(50, { "infrastructure.utilities": 72 });
    expect(politicalValueForLegacyMetric(values, "infrastructure", "powerGridReliability")).toBe(
      72
    );
  });

  it("falls back to the SP1 category score for unmapped legacy metrics", () => {
    const values = board(50);
    expect(politicalValueForLegacyMetric(values, "healthcare", "mentalHealthAccess")).toBeCloseTo(
      50,
      9
    );
    expect(politicalValueForLegacyMetric(values, "economic", "gdpGrowth")).toBeNull();
  });
});
