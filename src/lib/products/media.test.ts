import { describe, expect, it } from "vitest";
import { TECH_TREE } from "@/lib/constants/techTree/nodes";
import { PRODUCT_KINDS, getProductKind } from "./catalog";
import { effectsForStage, processProductLifecycle, startProductDevelopment } from "./lifecycle";
import {
  MEDIA_STUDIO_EXPLAINER,
  coverageAddressableShare,
  hasCatalogTail,
  mediaKindLegalForModels,
  mediaKindProfile,
  mediaLifecycleSchedule,
  mediaModelFitsCorporation,
  mediaModelProfile,
  mediaModelProfiles,
  validateMediaProductStart,
} from "./media";
import { applyProductClearingEffect, resolveProductClearingEffects } from "./productMarketEffects";
import { queryProductCatalog } from "./queries";
import {
  CANONICAL_MEDIA_SECTOR_TYPE,
  LEGACY_MEDIA_SECTOR_TYPES,
  productFamilyForCorporationType,
} from "./types";
import type { CorporationProduct } from "./types";

function devProduct(kindId: string, startedTurn = 100): CorporationProduct {
  return {
    id: `test-${kindId}`,
    corporationId: "corp-1",
    kindId,
    name: `Test ${kindId}`,
    stage: "development",
    startedTurn,
    developmentSpendAnchor: 0,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
  };
}

/** Advances a product turn by turn; R&D and ads accumulate during development. */
function runTurns(kindId: string, turns: number[], startedTurn = 100): CorporationProduct {
  let product = devProduct(kindId, startedTurn);
  for (const turn of turns) {
    const result = processProductLifecycle({
      enabled: true,
      product,
      turn,
      sectorQuality: 60,
      productRnDAnchor: 1000,
      deliveredAdvertisingAnchor: 500,
      unlockedTechnologyIds: [],
      schedule: mediaLifecycleSchedule(kindId),
    });
    product = result.product;
  }
  return product;
}

describe("media operating-model profiles", () => {
  it("covers all eight operating models", () => {
    expect(mediaModelProfiles().map((profile) => profile.model)).toEqual([
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

  it("gives every model a distinct coverage share", () => {
    const shares = mediaModelProfiles().map((profile) => coverageAddressableShare(profile.model));
    for (const share of shares) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    expect(new Set(shares).size).toBe(shares.length);
  });

  it("orders reach from venue print to national broadcast", () => {
    expect(coverageAddressableShare("television_network")).toBeGreaterThan(
      coverageAddressableShare("radio_network")
    );
    expect(coverageAddressableShare("radio_network")).toBeGreaterThan(
      coverageAddressableShare("newspaper")
    );
    expect(coverageAddressableShare("newspaper")).toBeGreaterThan(
      coverageAddressableShare("live_entertainment")
    );
  });

  it("reads unknown models as zero reach", () => {
    expect(coverageAddressableShare("bogus_model")).toBe(0);
    expect(mediaModelProfile("bogus_model")).toBeUndefined();
  });

  it("fits every operating model to the merged media_entertainment type", () => {
    for (const model of [
      "newspaper",
      "publishing_house",
      "television_network",
      "radio_network",
      "film_studio",
      "music_label",
      "streaming_platform",
      "live_entertainment",
    ]) {
      expect(mediaModelFitsCorporation(model, "media_entertainment")).toBe(true);
    }
    expect(mediaModelFitsCorporation("bogus_model", "media_entertainment")).toBe(false);
    expect(mediaModelFitsCorporation("newspaper", "retail")).toBe(false);
  });
});

describe("media technology gates use real tech-tree nodes", () => {
  const EXPECTED_NODES = [
    { id: "media_entertainment-1940-1", name: "Radio Network Dominance" },
    { id: "media_entertainment-1950-1", name: "Television Broadcasting" },
    { id: "media_entertainment-2009-1", name: "Streaming Platforms" },
    { id: "media_entertainment-1940-2", name: "Hollywood Studio System" },
    { id: "media_entertainment-1950-2", name: "Record Labels" },
    { id: "media_entertainment-1960-2", name: "Concert Touring" },
  ] as const;

  for (const expected of EXPECTED_NODES) {
    it(`resolves ${expected.id} in the authored tree`, () => {
      const node = TECH_TREE.media_entertainment.find((candidate) => candidate.id === expected.id);
      expect(node?.name).toBe(expected.name);
    });
  }

  it("lands the streaming strategy unlock on the merged streaming node", () => {
    const node = TECH_TREE.media_entertainment.find(
      (candidate) => candidate.id === "media_entertainment-2009-1"
    );
    expect(node?.effects).toContainEqual({ kind: "unlockStrategy", strategyId: "streaming" });
  });

  it("references only gated ids from model profiles and the catalog", () => {
    const referenced = new Set<string>();
    for (const profile of mediaModelProfiles()) {
      for (const id of Object.values(profile.technologyIdBySector ?? {})) referenced.add(id);
    }
    for (const kind of PRODUCT_KINDS) {
      if ("requiredTechnologyIds" in kind) {
        for (const id of kind.requiredTechnologyIds ?? []) referenced.add(id);
      }
    }
    const known = new Set<string>(EXPECTED_NODES.map((node) => node.id));
    for (const id of referenced) expect(known.has(id)).toBe(true);
  });
});

describe("media kind cadence and tail", () => {
  it("pins every content schedule", () => {
    expect(mediaKindProfile("news_story")?.schedule.developmentTurns).toBe(2);
    expect(mediaKindProfile("radio_program")?.schedule.developmentTurns).toBe(3);
    expect(mediaKindProfile("music_release")?.schedule.developmentTurns).toBe(4);
    expect(mediaKindProfile("television_show")?.schedule.developmentTurns).toBe(6);
    expect(mediaKindProfile("live_production")?.schedule.developmentTurns).toBe(6);
    expect(mediaKindProfile("book")?.schedule.developmentTurns).toBe(8);
    expect(mediaKindProfile("film")?.schedule.developmentTurns).toBe(10);
  });

  it("gives films the longest development and news the shortest", () => {
    const dev = (kindId: string) => mediaLifecycleSchedule(kindId).developmentTurns;
    expect(dev("film")).toBeGreaterThan(dev("book"));
    expect(dev("book")).toBeGreaterThan(dev("news_story"));
  });

  it("falls back to the shared default for industrial kinds", () => {
    expect(mediaKindProfile("truck")).toBeUndefined();
    expect(mediaLifecycleSchedule("truck").developmentTurns).toBe(6);
    expect(mediaLifecycleSchedule("bogus")).toEqual(mediaLifecycleSchedule("truck"));
  });

  it("tails catalog releases but not news or live productions", () => {
    expect(hasCatalogTail("book")).toBe(true);
    expect(hasCatalogTail("television_show")).toBe(true);
    expect(hasCatalogTail("film")).toBe(true);
    expect(hasCatalogTail("music_release")).toBe(true);
    expect(hasCatalogTail("news_story")).toBe(false);
    expect(hasCatalogTail("radio_program")).toBe(false);
    expect(hasCatalogTail("live_production")).toBe(false);
    expect(hasCatalogTail("truck")).toBe(false);
  });
});

describe("validateMediaProductStart", () => {
  it.each([
    {
      kindId: "news_story",
      corporationType: "media_entertainment",
      operatingModels: ["newspaper"],
    },
    {
      kindId: "book",
      corporationType: "media_entertainment",
      operatingModels: ["publishing_house"],
    },
    {
      kindId: "news_story",
      corporationType: "media_entertainment",
      operatingModels: ["television_network"],
    },
    {
      kindId: "radio_program",
      corporationType: "media_entertainment",
      operatingModels: ["radio_network"],
    },
    { kindId: "film", corporationType: "media_entertainment", operatingModels: ["film_studio"] },
    {
      kindId: "film",
      corporationType: "media_entertainment",
      operatingModels: ["streaming_platform"],
    },
    {
      kindId: "music_release",
      corporationType: "media_entertainment",
      operatingModels: ["music_label"],
    },
    {
      kindId: "live_production",
      corporationType: "media_entertainment",
      operatingModels: ["live_entertainment"],
    },
  ])("starts $kindId for a fitting model without year or tech data", (args) => {
    expect(validateMediaProductStart(args)).toMatchObject({ ok: true });
  });

  it("rejects unknown and industrial kinds", () => {
    expect(
      validateMediaProductStart({
        kindId: "bus",
        corporationType: "media_entertainment",
        operatingModels: [],
      })
    ).toMatchObject({ ok: false, reason: "unknown_product_kind" });
    expect(
      validateMediaProductStart({
        kindId: "truck",
        corporationType: "media_entertainment",
        operatingModels: [],
      })
    ).toMatchObject({ ok: false, reason: "unknown_product_kind" });
  });

  it("rejects non-media corporations", () => {
    expect(
      validateMediaProductStart({ kindId: "book", corporationType: "retail", operatingModels: [] })
    ).toMatchObject({ ok: false, reason: "incompatible_corporation_type" });
  });

  it("rejects a missing operating model", () => {
    expect(
      validateMediaProductStart({
        kindId: "news_story",
        corporationType: "media_entertainment",
        operatingModels: [],
      })
    ).toMatchObject({ ok: false, reason: "incompatible_operating_model" });
  });

  it("rejects a model unfitting the corporation type", () => {
    // The merged type owns every real model, so a mismatch means an unknown model.
    const result = validateMediaProductStart({
      kindId: "news_story",
      corporationType: "media_entertainment",
      operatingModels: ["bogus_model"],
    });
    expect(result).toMatchObject({ ok: false, reason: "incompatible_operating_model" });
  });

  it("era-locks television before the 1950s", () => {
    expect(
      validateMediaProductStart({
        kindId: "television_show",
        corporationType: "media_entertainment",
        operatingModels: ["television_network"],
        currentYear: 1945,
        unlockedTechnologyIds: ["media_entertainment-1950-1"],
      })
    ).toMatchObject({ ok: false, reason: "era_locked" });
  });

  it("technology-locks radio without its research", () => {
    expect(
      validateMediaProductStart({
        kindId: "radio_program",
        corporationType: "media_entertainment",
        operatingModels: ["radio_network"],
        currentYear: 1950,
        unlockedTechnologyIds: [],
      })
    ).toMatchObject({ ok: false, reason: "technology_locked" });
  });

  it("unlocks radio with year and research present", () => {
    expect(
      validateMediaProductStart({
        kindId: "radio_program",
        corporationType: "media_entertainment",
        operatingModels: ["radio_network"],
        currentYear: 1950,
        unlockedTechnologyIds: ["media_entertainment-1940-1"],
      })
    ).toMatchObject({ ok: true, operatingModel: "radio_network" });
  });

  it("gates streaming behind the 2009 node of the owning lane", () => {
    const mediaLocked = validateMediaProductStart({
      kindId: "film",
      corporationType: "media_entertainment",
      operatingModels: ["streaming_platform"],
      currentYear: 2020,
      unlockedTechnologyIds: ["media_entertainment-1940-1"],
    });
    expect(mediaLocked).toMatchObject({ ok: false, reason: "technology_locked" });
    expect(
      validateMediaProductStart({
        kindId: "film",
        corporationType: "media_entertainment",
        operatingModels: ["streaming_platform"],
        currentYear: 2020,
        unlockedTechnologyIds: ["media_entertainment-2009-1"],
      })
    ).toMatchObject({ ok: true, operatingModel: "streaming_platform" });
  });
});

describe("media catalog era and technology filtering", () => {
  it("withholds radio before 1940 but keeps the press", () => {
    const ids = queryProductCatalog({
      family: "media_entertainment",
      operatingModels: ["newspaper", "radio_network"],
      currentYear: 1930,
    }).map((kind) => kind.id);
    expect(ids).toContain("news_story");
    expect(ids).not.toContain("radio_program");
  });

  it("withholds live entertainment before 1960", () => {
    const ids = queryProductCatalog({
      family: "media_entertainment",
      operatingModels: ["live_entertainment"],
      currentYear: 1955,
    }).map((kind) => kind.id);
    expect(ids).toEqual([]);
  });

  it("withholds gated kinds from an empty unlock list", () => {
    const ids = queryProductCatalog({
      family: "media_entertainment",
      operatingModels: ["music_label"],
      unlockedTechnologyIds: [],
    }).map((kind) => kind.id);
    expect(ids).toEqual([]);
  });

  it("keeps requirement-free kinds visible to an empty unlock list", () => {
    const ids = queryProductCatalog({
      family: "media_entertainment",
      operatingModels: ["publishing_house"],
      unlockedTechnologyIds: [],
    }).map((kind) => kind.id);
    expect(ids).toEqual(["book"]);
  });
});

describe("media lifecycles on their own cadence", () => {
  it("launches a daily edition after 2 turns and a film after 10", () => {
    expect(runTurns("news_story", [100, 101]).stage).toBe("development");
    expect(runTurns("news_story", [100, 101, 102]).stage).toBe("launch");
    expect(runTurns("film", [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]).stage).toBe(
      "development"
    );
    expect(runTurns("film", [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]).stage).toBe(
      "launch"
    );
  });

  it("retires a tour while a backlist book still grows", () => {
    // Live: launch 106, post-launch 3+6+4+2 = 15 turns, retired at 121.
    const liveTurns = Array.from({ length: 22 }, (_, i) => 100 + i);
    expect(runTurns("live_production", liveTurns).stage).toBe("retired");
    // Book: launch 108; at 121 it is 13 turns post-launch: launch(4) + growth.
    expect(runTurns("book", liveTurns).stage).toBe("growth");
  });

  it("keeps the shared default for industrial products", () => {
    const truck = runTurns("truck", [100, 101, 102, 103, 104, 105]);
    expect(truck.stage).toBe("development");
    expect(runTurns("truck", [100, 101, 102, 103, 104, 105, 106]).stage).toBe("launch");
  });

  it("freezes launch quality with the technology lift", () => {
    const without = runTurns("music_release", [100, 101, 102, 103, 104]);
    expect(without.stage).toBe("launch");
    const base = without.launchQuality ?? 0;
    let product = devProduct("music_release");
    for (const turn of [100, 101, 102, 103, 104]) {
      product = processProductLifecycle({
        enabled: true,
        product,
        turn,
        sectorQuality: 60,
        productRnDAnchor: 1000,
        deliveredAdvertisingAnchor: 500,
        unlockedTechnologyIds: ["media_entertainment-1950-2"],
        schedule: mediaLifecycleSchedule("music_release"),
      }).product;
    }
    expect(product.launchQuality ?? 0).toBeGreaterThan(base);
  });

  it("stays neutral while the feature is off", () => {
    const product = devProduct("film");
    const result = processProductLifecycle({
      enabled: false,
      product,
      turn: 200,
      sectorQuality: 60,
      productRnDAnchor: 1000,
      deliveredAdvertisingAnchor: 500,
      schedule: mediaLifecycleSchedule("film"),
    });
    expect(result.product).toBe(product);
    expect(result.advanced).toBe(false);
    expect(result.demandMultiplier).toBe(1);
    expect(result.priceDefenseMultiplier).toBe(1);
    expect(result.accounting).toEqual({
      developmentSpendDelta: 0,
      developmentAdvertisingDelta: 0,
      amortizationDelta: 0,
    });
  });

  it("keeps the one-active-product slot across families", () => {
    const active: CorporationProduct = {
      ...devProduct("news_story"),
      stage: "launch",
      launchedTurn: 102,
    };
    const second = startProductDevelopment({
      enabled: true,
      activeProduct: active,
      draft: {
        id: "second",
        corporationId: "corp-1",
        kindId: "film",
        name: "Second",
        startedTurn: 110,
      },
    });
    expect(second).toEqual({ ok: false, reason: "active_product" });
  });

  it("never duplicates cash, advertising, inventory, or revenue", () => {
    // The accounting surface is allocation-only: three named deltas, no cash
    // or revenue leg. The turn shell persists state; settlement already paid
    // the budgets as cash costs.
    const result = processProductLifecycle({
      enabled: true,
      product: devProduct("television_show"),
      turn: 100,
      sectorQuality: 60,
      productRnDAnchor: 1000,
      deliveredAdvertisingAnchor: 500,
      schedule: mediaLifecycleSchedule("television_show"),
    });
    expect(Object.keys(result.accounting).sort()).toEqual([
      "amortizationDelta",
      "developmentAdvertisingDelta",
      "developmentSpendDelta",
    ]);
    expect(result).not.toHaveProperty("cashDelta");
    expect(result).not.toHaveProperty("revenueDelta");
    expect(result).not.toHaveProperty("inventoryDelta");

    // Clearing effects ride the existing quality/loyalty seams only: the
    // resolved effect matches the lifecycle stage math exactly, so coverage
    // and brand scale cannot double-count demand.
    const launched: CorporationProduct = {
      ...devProduct("news_story"),
      stage: "mature",
      launchedTurn: 102,
      launchQuality: 70,
      productBrand: 8000,
    };
    const effects = resolveProductClearingEffects([launched], true);
    const effect = effects.get("corp-1");
    expect(effect).toBeDefined();
    const direct = effectsForStage({ stage: "mature", launchQuality: 70, productBrand: 8000 });
    expect(effect?.demandMultiplier).toBe(direct.demandMultiplier);
    expect(effect?.priceDefenseMultiplier).toBe(direct.priceDefenseMultiplier);
    expect(effect).not.toHaveProperty("coverage");
    expect(effect).not.toHaveProperty("cashDelta");

    // Applying the effect to an unrelated sector is identity.
    const untouched = applyProductClearingEffect({
      effect,
      supplyRates: { vehicles: 0.5 },
      brandLoyalty: 40,
      outputQuality: 55,
      loyaltyEnabled: true,
      qualityEnabled: true,
    });
    expect(untouched).toEqual({ brandLoyalty: 40, outputQuality: 55 });
  });

  it("retires every content kind through decline", () => {
    for (const kind of PRODUCT_KINDS.filter((item) => item.family === "media_entertainment")) {
      const schedule = mediaLifecycleSchedule(kind.id);
      const total =
        schedule.developmentTurns +
        schedule.launchTurns +
        schedule.growthTurns +
        schedule.matureTurns +
        schedule.declineTurns;
      const turns = Array.from({ length: total + 1 }, (_, i) => 100 + i);
      const product = runTurns(kind.id, turns);
      expect(product.stage).toBe("retired");
      expect(getProductKind(kind.id)).toBeDefined();
    }
  });
});

describe("media legality helper", () => {
  it("mirrors the validator verdict", () => {
    expect(
      mediaKindLegalForModels({
        kindId: "film",
        corporationType: "media_entertainment",
        operatingModels: ["film_studio"],
        currentYear: 1950,
        unlockedTechnologyIds: ["media_entertainment-1940-2"],
      })
    ).toBe(true);
    expect(
      mediaKindLegalForModels({
        kindId: "film",
        corporationType: "media_entertainment",
        operatingModels: ["film_studio"],
        currentYear: 1930,
      })
    ).toBe(false);
  });
});

describe("canonical sector read alias (issue #2234)", () => {
  it("resolves the canonical type to the media family", () => {
    expect(productFamilyForCorporationType(CANONICAL_MEDIA_SECTOR_TYPE)).toBe(
      "media_entertainment"
    );
  });

  it("keeps both legacy types on the same family", () => {
    for (const legacy of LEGACY_MEDIA_SECTOR_TYPES) {
      expect(productFamilyForCorporationType(legacy)).toBe("media_entertainment");
    }
    expect(productFamilyForCorporationType("manufacturing")).toBe("industrial_manufacturing");
    expect(productFamilyForCorporationType("retail")).toBeNull();
  });
});

describe("studio explainer", () => {
  it("explains quality, brand, coverage, and tail drivers", () => {
    expect(MEDIA_STUDIO_EXPLAINER.quality).toMatch(/sector average/);
    expect(MEDIA_STUDIO_EXPLAINER.quality).toMatch(/R&D/);
    expect(MEDIA_STUDIO_EXPLAINER.brand).toMatch(/advertising/);
    expect(MEDIA_STUDIO_EXPLAINER.coverage).toMatch(/reach/);
    expect(MEDIA_STUDIO_EXPLAINER.tail).toMatch(/Catalog/);
  });
});
