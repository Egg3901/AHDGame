import { describe, expect, it } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  MEDIA_ENTERTAINMENT_SECTOR_TYPE,
  canonicalMediaStrategyForLegacy,
  canonicalizeMediaSectorType,
  canonicalizeSectorTypeInput,
  canonicalizeSectorWeightMap,
  consolidateMediaTechUnlocks,
  inferredOperatingModelsForLegacyType,
  isLegacyMediaSectorType,
  planCorporationTypeMigration,
  sanitizeOperatingModels,
  unionInferredOperatingModels,
} from "./rules";
import { planMediaSectorMerge, planMediaUnownedMerges, type MediaMergeRow } from "./merge";

const row = (overrides: Partial<MediaMergeRow> & { id: string }): MediaMergeRow => ({
  stateId: "US:CA",
  corporationId: "corp-1",
  sectorType: "media",
  strategyId: "standard",
  revenue: 100,
  workers: 10,
  profitMargin: 20,
  ...overrides,
});

describe("legacy boundary recognition", () => {
  it("canonicalizes both retired labels and the canonical type", () => {
    expect(canonicalizeMediaSectorType("media")).toBe(MEDIA_ENTERTAINMENT_SECTOR_TYPE);
    expect(canonicalizeMediaSectorType("entertainment")).toBe(MEDIA_ENTERTAINMENT_SECTOR_TYPE);
    expect(canonicalizeMediaSectorType("media_entertainment")).toBe(MEDIA_ENTERTAINMENT_SECTOR_TYPE);
  });

  it("rejects unrelated types and non-strings", () => {
    expect(canonicalizeMediaSectorType("energy")).toBeNull();
    expect(canonicalizeMediaSectorType("media_standard")).toBeNull();
    expect(canonicalizeMediaSectorType(undefined)).toBeNull();
    expect(canonicalizeMediaSectorType(null)).toBeNull();
    expect(isLegacyMediaSectorType("media_entertainment")).toBe(false);
    expect(isLegacyMediaSectorType("media")).toBe(true);
    expect(isLegacyMediaSectorType("entertainment")).toBe(true);
  });

  it("passes unrelated input values through untouched", () => {
    expect(canonicalizeSectorTypeInput("energy")).toBe("energy");
    expect(canonicalizeSectorTypeInput("media")).toBe("media_entertainment");
    expect(canonicalizeSectorTypeInput(undefined)).toBeUndefined();
  });
});

describe("selectable types", () => {
  it("offers the canonical type and neither retired label", () => {
    expect(CORPORATION_TYPES).toContain("media_entertainment");
    expect(CORPORATION_TYPES).not.toContain("media");
    expect(CORPORATION_TYPES).not.toContain("entertainment");
  });

  it("authors exactly one runtime strategy catalog for the domain", () => {
    expect(Object.keys(SECTOR_STRATEGIES)).toContain("media_entertainment");
    expect(Object.keys(SECTOR_STRATEGIES)).not.toContain("media");
    expect(Object.keys(SECTOR_STRATEGIES)).not.toContain("entertainment");
    const ids = SECTOR_STRATEGIES.media_entertainment.map((strategy) => strategy.id);
    expect(ids).toContain("standard");
    expect(ids).toContain("diversified");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("strategy mapping", () => {
  it("maps every legacy strategy id without retaining origin", () => {
    expect(canonicalMediaStrategyForLegacy("standard")).toBe("standard");
    expect(canonicalMediaStrategyForLegacy("streaming_media")).toBe("streaming");
    expect(canonicalMediaStrategyForLegacy("digital_first")).toBe("streaming");
    expect(canonicalMediaStrategyForLegacy("legacy_broadcast")).toBe("broadcast");
    expect(canonicalMediaStrategyForLegacy("streaming")).toBe("streaming");
    expect(canonicalMediaStrategyForLegacy("live_service")).toBe("streaming");
    expect(canonicalMediaStrategyForLegacy("live_venue")).toBe("live_venue");
  });

  it("passes canonical ids through and defaults unknown ids to standard", () => {
    for (const id of ["standard", "press", "broadcast", "screen", "studio", "streaming", "live_venue", "diversified"]) {
      expect(canonicalMediaStrategyForLegacy(id)).toBe(id);
    }
    expect(canonicalMediaStrategyForLegacy("media_standard")).toBe("standard");
    expect(canonicalMediaStrategyForLegacy("entertainment_standard")).toBe("standard");
    expect(canonicalMediaStrategyForLegacy(undefined)).toBe("standard");
    expect(canonicalMediaStrategyForLegacy(null)).toBe("standard");
  });

  it("emits no legacy strategy id from any mapping", () => {
    const legacy = ["streaming_media", "digital_first", "legacy_broadcast", "live_service"];
    for (const id of legacy) {
      expect(canonicalMediaStrategyForLegacy(id)).not.toBe(id);
    }
  });
});

describe("operating-model inference", () => {
  it("infers press models from media and stage models from entertainment", () => {
    expect(inferredOperatingModelsForLegacyType("media")).toEqual([
      "newspaper",
      "publishing_house",
      "television_network",
      "radio_network",
      "streaming_platform",
    ]);
    expect(inferredOperatingModelsForLegacyType("entertainment")).toEqual([
      "film_studio",
      "music_label",
      "streaming_platform",
      "live_entertainment",
      "publishing_house",
    ]);
  });

  it("unions both sets on a collision", () => {
    expect(unionInferredOperatingModels(["media", "entertainment"])).toEqual([
      "newspaper",
      "publishing_house",
      "television_network",
      "radio_network",
      "film_studio",
      "music_label",
      "streaming_platform",
      "live_entertainment",
    ]);
  });

  it("ignores unknown inputs and deduplicates", () => {
    expect(unionInferredOperatingModels(["media", "media", "energy", undefined])).toEqual(
      inferredOperatingModelsForLegacyType("media")
    );
    expect(unionInferredOperatingModels([])).toEqual([]);
  });

  it("sanitizes persisted model lists", () => {
    expect(sanitizeOperatingModels(["newspaper", "bogus", "newspaper", 42])).toEqual(["newspaper"]);
  });
});

describe("tech unlock consolidation", () => {
  const mapper = (id: string): string | null => {
    if (id === "media-1940-1") return "media_entertainment-1940-1";
    if (id === "entertainment-1940-1") return "media_entertainment-1940-2";
    return null;
  };

  it("remaps legacy ids, keeps corporate ids, and drops duplicates", () => {
    expect(
      consolidateMediaTechUnlocks(
        ["media-1940-1", "entertainment-1940-1", "corp-1940-1", "media_entertainment-1940-1"],
        mapper
      )
    ).toEqual(["media_entertainment-1940-1", "media_entertainment-1940-2", "corp-1940-1"]);
  });

  it("is a no-op on already-canonical lists", () => {
    const ids = ["media_entertainment-1940-1", "corp-1940-1"];
    expect(consolidateMediaTechUnlocks(ids, mapper)).toEqual(ids);
    expect(consolidateMediaTechUnlocks(undefined, mapper)).toEqual([]);
  });
});

describe("corporation type plan", () => {
  it("canonicalizes primary and secondary legacy types", () => {
    expect(planCorporationTypeMigration("media", null)).toEqual({
      type: "media_entertainment",
      secondaryType: null,
      changed: true,
    });
    expect(planCorporationTypeMigration("entertainment", "technology")).toEqual({
      type: "media_entertainment",
      secondaryType: "technology",
      changed: true,
    });
  });

  it("clears a secondary that collapses onto the primary", () => {
    expect(planCorporationTypeMigration("media", "entertainment")).toEqual({
      type: "media_entertainment",
      secondaryType: null,
      changed: true,
    });
    expect(planCorporationTypeMigration("media_entertainment", "media_entertainment")).toEqual({
      type: "media_entertainment",
      secondaryType: null,
      changed: true,
    });
  });

  it("reports no change for canonical and unrelated rows", () => {
    expect(planCorporationTypeMigration("media_entertainment", null).changed).toBe(false);
    expect(planCorporationTypeMigration("energy", "technology").changed).toBe(false);
    expect(planCorporationTypeMigration("energy", undefined).changed).toBe(false);
  });
});

describe("weight-map canonicalization", () => {
  it("sums legacy weights into the canonical key", () => {
    expect(canonicalizeSectorWeightMap({ media: 2, entertainment: 3, energy: 6 })).toEqual({
      energy: 6,
      media_entertainment: 5,
    });
  });

  it("is idempotent and tolerates non-finite values", () => {
    const once = canonicalizeSectorWeightMap({ media: 2, energy: 6 });
    expect(canonicalizeSectorWeightMap(once)).toEqual(once);
    expect(canonicalizeSectorWeightMap({ media: NaN, energy: 6 })).toEqual({ energy: 6 });
  });
});

describe("collision merge", () => {
  it("merges two legacy rows into one diversified row and conserves economics", () => {
    const plan = planMediaSectorMerge([
      row({
        id: "a",
        sectorType: "media",
        strategyId: "legacy_broadcast",
        revenue: 300,
        workers: 30,
        profitMargin: 10,
        productionPolicyLevel: 4,
        createdAtMs: 2,
        inventoryUnits: { advertising: 5 },
        inventoryValueAnchor: 100,
        realizedRevenue: 290,
        producedUnits: 50,
        soldUnits: 45,
        contractAchievableUnits: 55,
      }),
      row({
        id: "b",
        sectorType: "entertainment",
        strategyId: "live_venue",
        revenue: 100,
        workers: 20,
        profitMargin: 30,
        productionPolicyLevel: 8,
        createdAtMs: 1,
        inventoryUnits: { advertising: 7, entertainment_services: 3 },
        inventoryValueAnchor: 50,
        inventoryDrainedUnits: 4,
        inventorySpoiledUnits: 2,
        realizedRevenue: 90,
        producedUnits: 20,
        soldUnits: 18,
        contractAchievableUnits: 22,
      }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan?.survivorId).toBe("b");
    expect(plan?.loserIds).toEqual(["a"]);
    expect(plan?.sectorType).toBe("media_entertainment");
    expect(plan?.strategyId).toBe("diversified");
    expect(plan?.legacyTypes).toEqual(["media", "entertainment"]);
    expect(plan?.revenue).toBe(400);
    expect(plan?.workers).toBe(50);
    expect(plan?.profitMargin).toBeCloseTo(15);
    expect(plan?.productionPolicyLevel).toBe(5);
    expect(plan?.inventoryUnits).toEqual({ advertising: 12, entertainment_services: 3 });
    expect(plan?.inventoryValueAnchor).toBe(150);
    expect(plan?.inventoryDrainedUnits).toBe(4);
    expect(plan?.inventorySpoiledUnits).toBe(2);
    expect(plan?.realizedRevenue).toBe(380);
    expect(plan?.producedUnits).toBe(70);
    expect(plan?.soldUnits).toBe(63);
    expect(plan?.contractAchievableUnits).toBe(77);
    expect(plan?.rescaleLegs).toEqual([
      { rowId: "b", fromStrategy: "live_venue", toStrategy: "diversified" },
      { rowId: "a", fromStrategy: "broadcast", toStrategy: "diversified" },
    ]);
    expect(plan?.operatingModels).toEqual([
      "newspaper",
      "publishing_house",
      "television_network",
      "radio_network",
      "film_studio",
      "music_label",
      "streaming_platform",
      "live_entertainment",
    ]);
  });

  it("returns null without a same-group legacy collision", () => {
    expect(planMediaSectorMerge([row({ id: "a" })])).toBeNull();
    expect(
      planMediaSectorMerge([row({ id: "a", sectorType: "media_entertainment" })])
    ).toBeNull();
    expect(
      planMediaSectorMerge([
        row({ id: "a", sectorType: "media" }),
        row({ id: "b", sectorType: "energy" }),
      ])
    ).toBeNull();
  });

  it("merges unowned collisions by summing revenue", () => {
    const plans = planMediaUnownedMerges([
      { id: "a", stateId: "US:CA", countryId: "US", sectorType: "media", revenue: 60, createdAtMs: 5 },
      { id: "b", stateId: "US:CA", countryId: "US", sectorType: "entertainment", revenue: 40, createdAtMs: 3 },
      { id: "c", stateId: "US:NY", countryId: "US", sectorType: "media", revenue: 10 },
    ]);
    expect(plans).toEqual([
      {
        stateId: "US:CA",
        countryId: "US",
        survivorId: "b",
        loserIds: ["a"],
        sectorType: "media_entertainment",
        revenue: 100,
      },
    ]);
  });
});
