import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import { checkPersistedSectorTypes } from "@/lib/corporations/checkPersistedSectorTypes";
import {
  getEffectiveStrategyRates,
  getMediaOperatingModelStrategies,
  getSectorStrategies,
  getStrategy,
  SECTOR_STRATEGIES,
} from "./sectorStrategies";
import { COMMODITY_TYPES } from "./commodities";
import { MEDIA_OPERATING_MODELS } from "@/lib/mediaOperatingModels/catalog";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

describe("startup sector type diagnostics", () => {
  it("logs unknown type counts without changing persisted sectors", async () => {
    const unknownTypes = [
      { _id: "retired_sector", count: 3 },
      { _id: null, count: 1 },
    ];
    const aggregate = vi.fn(() => ({ toArray: async () => unknownTypes }));
    const collection = vi.fn(() => ({ aggregate }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await checkPersistedSectorTypes({ collection } as unknown as Db);
      expect(collection).toHaveBeenCalledExactlyOnceWith("corporateSectors");
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "[sector-types] unknown persisted types in corporateSectors:",
        unknownTypes
      );
    } finally {
      log.mockRestore();
    }
  });

  it("stays quiet when every persisted sector type is recognized", async () => {
    const db = { collection: () => ({ aggregate: () => ({ toArray: async () => [] }) }) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await checkPersistedSectorTypes(db as unknown as Db);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("unknown persisted sector types", () => {
  it("uses empty rates and reports the type only once across repeated turn reads", () => {
    vi.mocked(Sentry.captureMessage).mockClear();
    const rates = getEffectiveStrategyRates("retired_sector", "legacy", null, null, 1065);
    expect(rates).toEqual({ supply: {}, demand: {}, isTransitioning: false });
    expect(getEffectiveStrategyRates("retired_sector", "legacy", null, null, 1066)).toEqual(rates);
    expect(Sentry.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "Unknown persisted sector type: using inert strategy",
      { level: "error", extra: { sectorType: "retired_sector" } }
    );
  });

  it("handles unknown types during an active strategy transition", () => {
    expect(getEffectiveStrategyRates("removed_sector", "new", "old", 1060, 1065)).toEqual({
      supply: {},
      demand: {},
      isTransitioning: true,
    });
  });

  it.each(["__proto__", "constructor", "toString"])("rejects inherited key %s", (sectorType) => {
    expect(getEffectiveStrategyRates(sectorType, "standard", null, null, 1065)).toEqual({
      supply: {},
      demand: {},
      isTransitioning: false,
    });
  });

  it("preserves the first-strategy fallback for a known type with an unknown strategy", () => {
    expect(getStrategy("media", "removed_strategy")).toBe(SECTOR_STRATEGIES.media[0]);
  });
});

describe("media operating model strategies", () => {
  it.each([
    ["media", "newspaper", 0.5],
    ["media", "cable_tv", 0.5],
    ["media", "streaming_platform", 0.5],
    ["media_entertainment", "film_studio", 0.6],
    ["media_entertainment", "streaming_platform", 0.6],
  ])("resolves active virtual strategy %s:%s through legacy readers", (sectorType, id, budget) => {
    const strategy = getStrategy(sectorType, id);
    expect(strategy.mediaOperatingModelId).toBe(id);
    expect(Object.values(strategy.supply).reduce((sum, rate) => sum + (rate ?? 0), 0)).toBeCloseTo(
      budget
    );
    expect(getEffectiveStrategyRates(sectorType, id, null, null, 500).supply).toEqual(
      strategy.supply
    );
  });

  it("keeps models out of the existing selectable strategy list unless the gate is on", () => {
    expect(getSectorStrategies("media").some((strategy) => strategy.mediaOperatingModelId)).toBe(
      false
    );
    expect(
      getSectorStrategies("media", true).filter((strategy) => strategy.mediaOperatingModelId)
    ).toEqual(getMediaOperatingModelStrategies("media"));
  });

  it("dual-reads a persisted model id even when the model selector gate is off", () => {
    const streamingMedia = getMediaOperatingModelStrategies("media").find(
      (strategy) => strategy.id === "streaming_platform"
    )!;
    expect(getSectorStrategies("media", false).map((strategy) => strategy.id)).not.toContain(
      "streaming_platform"
    );
    expect(getEffectiveStrategyRates("media", "streaming_platform", null, null, 500)).toEqual({
      supply: streamingMedia.supply,
      demand: streamingMedia.demand,
      isTransitioning: false,
    });
  });

  it("uses the catalog's named existing input strategy for every lane recipe", () => {
    for (const model of MEDIA_OPERATING_MODELS) {
      for (const sectorType of model.sectorTypes) {
        const recipe = model.recipes[sectorType]!;
        const existingInput = SECTOR_STRATEGIES[sectorType].find(
          (strategy) => strategy.id === recipe.inputStrategyId
        )!;
        const modelStrategy = getMediaOperatingModelStrategies(sectorType).find(
          (strategy) => strategy.id === model.id
        )!;

        expect(modelStrategy.demand, `${sectorType}:${model.id}`).toEqual(existingInput.demand);
      }
    }
  });
});

describe("persisted media and entertainment sectors", () => {
  it("resolves their existing strategies while the product rollout is withdrawn", () => {
    expect(() =>
      getEffectiveStrategyRates("media", "legacy_broadcast", null, null, 1065)
    ).not.toThrow();
    expect(() =>
      getEffectiveStrategyRates("media_entertainment", "live_service", null, null, 1065)
    ).not.toThrow();
    expect(SECTOR_STRATEGIES.media).toBeDefined();
    expect(SECTOR_STRATEGIES.media_entertainment).toBeDefined();
  });
});

describe("telecom wireline lean recipe (demand audit step 5)", () => {
  const telecom = SECTOR_STRATEGIES.telecommunications;
  const wireline = telecom.find((s) => s.id === "wireline")!;
  const standard = telecom.find((s) => s.id === "standard")!;

  it("exists, needs no tech unlock, and keeps the standard default untouched", () => {
    expect(wireline).toBeDefined();
    expect(wireline.requiresTechUnlock ?? false).toBe(false);
    expect(standard).toBeDefined();
  });

  it("cuts the dearest component inputs hardest versus standard", () => {
    for (const c of ["rare_earth", "electronics", "construction_services", "energy"] as const) {
      expect(wireline.demand[c] ?? 0, `wireline ${c}`).toBeLessThan(standard.demand[c] ?? 0);
    }
    // Same output composition (network + software), smaller level.
    expect(Object.keys(wireline.supply).sort()).toEqual(Object.keys(standard.supply).sort());
  });
});

describe("defence strategies cover every arsenal domain", () => {
  const defence = SECTOR_STRATEGIES.defense;

  it("offers a strategy for naval, missile and aerospace lines", () => {
    const ids = defence.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["naval_systems", "missile_systems", "aerospace"]));
  });

  // The existing five are load-bearing: sectors already store these ids, so a rename
  // orphans live plants onto an unknown strategy.
  it("keeps every pre-existing defence strategy id", () => {
    const ids = defence.map((s) => s.id);
    for (const id of ["standard", "directed_energy", "cyber", "heavy_armor", "munitions"]) {
      expect(ids).toContain(id);
    }
  });

  it("gives every defence strategy a supply and a demand mix", () => {
    for (const s of defence) {
      expect(Object.keys(s.supply).length, `${s.id} supply`).toBeGreaterThan(0);
      expect(Object.keys(s.demand).length, `${s.id} demand`).toBeGreaterThan(0);
    }
  });

  it("uses only real commodities on both sides", () => {
    const known = new Set<string>(COMMODITY_TYPES);
    for (const s of defence) {
      for (const c of [...Object.keys(s.supply), ...Object.keys(s.demand)]) {
        expect(known.has(c), `${s.id} references unknown commodity ${c}`).toBe(true);
      }
    }
  });

  it("has unique ids", () => {
    const ids = defence.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Measured on the live testing world before authoring these: energy sits at D/S 2.25 and
  // freight at 1.612, the two tightest markets a defence plant touches. A new line that
  // leaned on either the way the existing entries do would tighten an already-short market
  // for every sector, not just defence ones.
  it("keeps the new lines off the two tightest commodity markets", () => {
    for (const id of ["naval_systems", "missile_systems", "aerospace"]) {
      const s = defence.find((x) => x.id === id)!;
      expect(s.demand.energy ?? 0, `${id} energy demand`).toBeLessThanOrEqual(0.1);
      expect(s.demand.freight ?? 0, `${id} freight demand`).toBeLessThanOrEqual(0.1);
    }
  });

  // rare_earth carries a structural-shortage warning in commodities.ts. The live world
  // does not currently show it price-short, but the ceiling stays at the level the most
  // rare-earth-hungry existing defence line already sets.
  it("never demands more rare_earth than the existing munitions line", () => {
    const munitions = defence.find((s) => s.id === "munitions")!;
    const ceiling = munitions.demand.rare_earth ?? 0;
    for (const id of ["naval_systems", "missile_systems", "aerospace"]) {
      const s = defence.find((x) => x.id === id)!;
      expect(s.demand.rare_earth ?? 0, `${id} rare_earth`).toBeLessThanOrEqual(ceiling);
    }
  });
});
