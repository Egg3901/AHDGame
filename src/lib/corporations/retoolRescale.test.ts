import { describe, expect, it } from "vitest";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import { healAutoRetoolOpexAnchor, retoolRescaleFields } from "./retoolRescale";

const RATIO = capacityRescaleRatio("extraction", "standard", "rare_earth_mining");

describe("retoolRescaleFields", () => {
  it("holds total physical opex fixed when capitalStock (unit count) moves", () => {
    const capitalStock = 4_000;
    const otherOpexPerUnitAnchor = 12.5;
    const set = retoolRescaleFields({
      sectorType: "extraction",
      fromStrategyId: "standard",
      toStrategyId: "rare_earth_mining",
      plantsEnabled: true,
      capitalStock,
      otherOpexPerUnitAnchor,
    });
    expect(RATIO).not.toBe(1);
    expect(set.retoolRescaleApplied).toBe(true);
    expect(set.capitalStock).toBeCloseTo(capitalStock * RATIO, 6);
    expect(set.otherOpexPerUnitAnchor).toBeCloseTo(otherOpexPerUnitAnchor / RATIO, 8);
    expect((set.otherOpexPerUnitAnchor ?? 0) * (set.capitalStock ?? 0)).toBeCloseTo(
      otherOpexPerUnitAnchor * capitalStock,
      6
    );
  });

  it("writes nothing capacity-related below plants, and records that the rescale did not run", () => {
    const set = retoolRescaleFields({
      sectorType: "extraction",
      fromStrategyId: "standard",
      toStrategyId: "rare_earth_mining",
      plantsEnabled: false,
      capitalStock: 4_000,
      otherOpexPerUnitAnchor: 12.5,
      buildQueue: [{ unitsOrdered: 500, costPaidAnchor: 1, startTurn: 1, onlineTurn: 2 }],
    });
    expect(set).toEqual({ retoolRescaleApplied: false });
  });

  it("omits the opex leg when the sector has not been calibrated yet", () => {
    const set = retoolRescaleFields({
      sectorType: "extraction",
      fromStrategyId: "standard",
      toStrategyId: "rare_earth_mining",
      plantsEnabled: true,
      capitalStock: 4_000,
    });
    expect(set.retoolRescaleApplied).toBe(true);
    expect(set.capitalStock).toBeCloseTo(4_000 * RATIO, 6);
    expect(set).not.toHaveProperty("otherOpexPerUnitAnchor");
  });
});

describe("healAutoRetoolOpexAnchor", () => {
  const base = {
    plantsEnabled: true,
    isAutoRetool: true,
    transitionFromStrategyId: "standard",
    strategyId: "rare_earth_mining",
    sectorType: "extraction" as const,
    otherOpexPerUnitAnchor: 12.5,
  };

  it("inversely rebases a leftover auto-retool anchor and stamps the flag", () => {
    const heal = healAutoRetoolOpexAnchor(base);
    expect(heal).not.toBeNull();
    expect(heal!.retoolRescaleApplied).toBe(true);
    expect(heal!.otherOpexPerUnitAnchor).toBeCloseTo(12.5 / RATIO, 8);
  });

  it("does not touch a player retool that already recorded the rescale gate", () => {
    expect(healAutoRetoolOpexAnchor({ ...base, retoolRescaleApplied: true })).toBeNull();
    expect(healAutoRetoolOpexAnchor({ ...base, retoolRescaleApplied: false })).toBeNull();
  });

  it("does not touch a player-controlled sector with no auto-retool marker", () => {
    expect(healAutoRetoolOpexAnchor({ ...base, isAutoRetool: false })).toBeNull();
  });

  it("does not touch a sector that is not mid-transition", () => {
    expect(healAutoRetoolOpexAnchor({ ...base, transitionFromStrategyId: null })).toBeNull();
  });
});
