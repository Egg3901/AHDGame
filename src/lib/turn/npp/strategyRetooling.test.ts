import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getStrategyForOperatingModel } from "@/lib/constants/sectorStrategies";
import { chooseNppStrategyRetool } from "./strategyRetooling";

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId("000000000000000000000101"),
    corporationId: new ObjectId("000000000000000000000100"),
    countryId: "US",
    stateId: "NY",
    sectorType: "media",
    mediaDiscriminator: "entertainment",
    strategyId: "standard",
    effectiveProfitMargin: -10,
    capitalStock: 1_000,
    otherOpexPerUnitAnchor: 8,
    ...overrides,
  } as CorporateSector;
}

function decide(
  item: CorporateSector,
  prices: Record<string, number> = {},
  overrides: Partial<Parameters<typeof chooseNppStrategyRetool>[0]> = {}
) {
  return chooseNppStrategyRetool({
    corp: makeCorporation({
      _id: item.corporationId,
      type: item.sectorType,
      industryModel: item.industryModel,
      mediaDiscriminator: item.mediaDiscriminator,
      countryId: "US",
      ceoType: "npp",
    }),
    sectors: [item],
    divestedSectorIds: [],
    turn: 100,
    now: new Date("1994-01-01T00:00:00Z"),
    currentYear: 1994,
    techTreesEnabled: true,
    plantsEnabled: true,
    priceRatioOf: (commodity) => prices[commodity] ?? 1,
    ...overrides,
  });
}

describe("NPP strategy choice respects the plant's operating lane", () => {
  it.each([
    { sectorType: "media", mediaDiscriminator: "entertainment", strategyId: "legacy_broadcast" },
    { sectorType: "manufacturing", industryModel: "vehicles", strategyId: "heavy_metals" },
    {
      sectorType: "manufacturing",
      industryModel: "vehicles",
      strategyId: "electronics_manufacturing",
    },
  ] as const)("gradually corrects obsolete parent recipe $strategyId", (overrides) => {
    const item = sector({ mediaDiscriminator: null, ...overrides });
    const before = structuredClone(item);
    const decision = decide(item);
    expect(decision?.updates).toMatchObject({
      strategyId: "standard",
      transitionFromStrategyId: overrides.strategyId,
      transitionStartTurn: 100,
      retoolRescaleApplied: true,
    });
    expect(item).toEqual(before);
  });

  it("does not restart an obsolete recipe that is still transitioning", () => {
    expect(
      decide(
        sector({
          strategyId: "legacy_broadcast",
          transitionFromStrategyId: "standard",
          transitionStartTurn: 95,
        })
      )
    ).toBeNull();
  });

  it("leaves an unknown recipe outside the bounded correction alone", () => {
    expect(decide(sector({ strategyId: "unknown_recipe" }))).toBeNull();
  });

  it.each([{ mothballed: true }, { transitionCooldownUntilTurn: 101 }])(
    "keeps existing operating guards for obsolete recipes: %j",
    (guard) => {
      expect(decide(sector({ strategyId: "legacy_broadcast", ...guard }))).toBeNull();
    }
  );

  it("does not take a player's obsolete recipe or a divested sector", () => {
    const item = sector({ strategyId: "legacy_broadcast" });
    expect(decide(item, {}, { corp: makeCorporation({ ceoType: "character" }) })).toBeNull();
    expect(decide(item, {}, { divestedSectorIds: [item._id] })).toBeNull();
  });

  it("keeps an explicit advanced recipe outside the obsolete-id correction", () => {
    expect(decide(sector({ strategyId: "live_service" }))).toBeNull();
  });

  it("prioritizes one corrective retool over a price-driven shift", () => {
    const ordinary = sector({ mediaDiscriminator: null });
    const obsolete = sector({
      _id: new ObjectId("000000000000000000000102"),
      strategyId: "legacy_broadcast",
    });
    for (const sectors of [
      [ordinary, obsolete],
      [obsolete, ordinary],
    ]) {
      const decision = decide(ordinary, { advertising: 4 }, { sectors });
      expect(decision?.sectorId).toEqual(obsolete._id);
      expect(decision?.updates.strategyId).toBe("standard");
    }
  });

  it("does not put an entertainment plant onto a parent media recipe", () => {
    const item = sector();
    const decision = decide(item, { advertising: 4, entertainment_services: 0.5 });
    expect(decision).not.toBeNull();
    const target = String(decision!.updates.strategyId);
    expect(target).not.toBe("legacy_broadcast");
    expect(getStrategyForOperatingModel("media", target, undefined, "entertainment").id).toBe(
      target
    );
  });

  it("does not put a vehicle plant onto a generic manufacturing recipe", () => {
    const decision = decide(
      sector({ sectorType: "manufacturing", industryModel: "vehicles", mediaDiscriminator: null }),
      { steel: 8, electronics: 4, vehicles: 1.1 }
    );
    expect(["heavy_metals", "electronics_manufacturing"]).not.toContain(
      decision?.updates.strategyId
    );
    if (decision) {
      const target = String(decision.updates.strategyId);
      expect(getStrategyForOperatingModel("manufacturing", target, "vehicles").id).toBe(target);
    }
  });

  it("keeps legacy broadcast available to a commercial media plant", () => {
    const decision = decide(sector({ mediaDiscriminator: null }), { advertising: 4 });
    expect(decision?.updates.strategyId).toBe("legacy_broadcast");
  });

  it("leaves an existing retool and its paid basis alone", () => {
    const item = sector({ transitionFromStrategyId: "live_venue", transitionStartTurn: 95 });
    const before = structuredClone(item);
    expect(decide(item, { advertising: 4 })).toBeNull();
    expect(item).toEqual(before);
  });
});
