import { describe, expect, it } from "vitest";
import {
  MODEL_ARCHETYPES,
  ECONOMIC_MODEL_IDS,
  KNOWN_SPENDING_CATEGORIES,
  PENDING_SYNERGY_METRICS,
  resolveSeedEconomicModel,
  economicModelEra,
  type EconomicModelId,
} from "./economicModels";
import { CORPORATION_TYPES } from "./corporations";
import { metricCategories } from "./metricDefinitions";
import { getCountryConfig } from "./countries";

const allMetricIds = new Set(metricCategories.flatMap((c) => c.metrics.map((m) => m.id)));
const corpTypes = new Set<string>(CORPORATION_TYPES);

describe("MODEL_ARCHETYPES registry", () => {
  it("defines exactly the 10 declared model ids", () => {
    expect(Object.keys(MODEL_ARCHETYPES).sort()).toEqual([...ECONOMIC_MODEL_IDS].sort());
    expect(ECONOMIC_MODEL_IDS).toHaveLength(10);
  });

  it("mixed is the structureless residual (null primary, no secondaries)", () => {
    expect(MODEL_ARCHETYPES.mixed.primarySector).toBeNull();
    expect(MODEL_ARCHETYPES.mixed.secondarySectors).toHaveLength(0);
  });

  it("every non-mixed model has a valid primary + 2–3 valid secondary CorporationTypes", () => {
    for (const id of ECONOMIC_MODEL_IDS) {
      if (id === "mixed") continue;
      const a = MODEL_ARCHETYPES[id];
      expect(a.primarySector, `${id} primary`).not.toBeNull();
      expect(corpTypes.has(a.primarySector as string), `${id} primary ${a.primarySector}`).toBe(
        true
      );
      expect(a.secondarySectors.length, `${id} #secondaries`).toBeGreaterThanOrEqual(2);
      expect(a.secondarySectors.length, `${id} #secondaries`).toBeLessThanOrEqual(3);
      for (const s of a.secondarySectors) {
        expect(corpTypes.has(s), `${id} secondary ${s}`).toBe(true);
      }
    }
  });

  it("covers all 17 CorporationType sectors across the catalog (≥1×)", () => {
    const covered = new Set<string>();
    for (const id of ECONOMIC_MODEL_IDS) {
      const a = MODEL_ARCHETYPES[id];
      if (a.primarySector) covered.add(a.primarySector);
      a.secondarySectors.forEach((s) => covered.add(s));
    }
    for (const t of CORPORATION_TYPES) expect(covered.has(t), `sector ${t} uncovered`).toBe(true);
  });

  it("every spendingSignature key is a real budget category", () => {
    for (const id of ECONOMIC_MODEL_IDS) {
      for (const cat of Object.keys(MODEL_ARCHETYPES[id].spendingSignature)) {
        expect(KNOWN_SPENDING_CATEGORIES.has(cat), `${id} spending cat ${cat}`).toBe(true);
      }
    }
  });

  it("every metric-synergy target is a known metric or explicitly pending registration", () => {
    for (const id of ECONOMIC_MODEL_IDS) {
      for (const syn of MODEL_ARCHETYPES[id].metricSynergies) {
        const known = allMetricIds.has(syn.metricId) || PENDING_SYNERGY_METRICS.has(syn.metricId);
        expect(known, `${id} synergy target ${syn.metricId}`).toBe(true);
      }
    }
  });
});

describe("per-country, per-era seed models", () => {
  const expected1991: Record<string, EconomicModelId> = {
    US: "militaryIndustrial",
    UK: "financialized",
    DE: "industrialPowerhouse",
    JP: "industrialPowerhouse",
    IE: "agrarian",
    BR: "agrarian",
    CN: "agrarian",
  };
  const expected2019: Record<string, EconomicModelId> = {
    US: "techInnovation",
    UK: "financialized",
    DE: "socialMarket",
    JP: "industrialPowerhouse",
    IE: "techInnovation",
    BR: "resourceExtraction",
    CN: "industrialPowerhouse",
  };
  const ids = new Set<string>(ECONOMIC_MODEL_IDS);
  const seedFor = (country: string, era: "1991" | "2019") =>
    resolveSeedEconomicModel(
      getCountryConfig(country as Parameters<typeof getCountryConfig>[0]).seedEconomicModel,
      era
    );

  it("resolves valid era-specific seeds for every country", () => {
    for (const [country, model] of Object.entries(expected1991)) {
      const seed = seedFor(country, "1991");
      expect(seed, `${country} 1991`).toBe(model);
      expect(ids.has(seed as string)).toBe(true);
    }
    for (const [country, model] of Object.entries(expected2019)) {
      const seed = seedFor(country, "2019");
      expect(seed, `${country} 2019`).toBe(model);
      expect(ids.has(seed as string)).toBe(true);
    }
  });

  it("the era helper maps starting years to presets", () => {
    expect(economicModelEra(1991)).toBe("1991");
    expect(economicModelEra(2019)).toBe("2019");
    expect(economicModelEra(undefined)).toBe("2019"); // default
  });
});
