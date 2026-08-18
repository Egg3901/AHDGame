import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORGANIZE_SHOP_WORKERS,
  ORGANIZE_SECTOR_TREASURY_COST,
  ORGANIZE_TREASURY_COST_MAX,
  ORGANIZE_TREASURY_COST_MIN,
  ORGANIZE_TREASURY_COST_PER_WORKER,
  organizeSectorTreasuryCost,
} from "./organizeSectorEconomy";

describe("organizeSectorTreasuryCost", () => {
  it("prices an unorganized shop by workforce, matching the flat fallback at the default size", () => {
    expect(DEFAULT_ORGANIZE_SHOP_WORKERS).toBe(500);
    expect(organizeSectorTreasuryCost({ workers: 500, unionization: 0, isOwnSector: false })).toBe(
      ORGANIZE_SECTOR_TREASURY_COST
    );
    expect(ORGANIZE_SECTOR_TREASURY_COST).toBe(
      ORGANIZE_TREASURY_COST_PER_WORKER * DEFAULT_ORGANIZE_SHOP_WORKERS
    );
  });

  it("a small unorganized shop is cheaper than a large one", () => {
    const small = organizeSectorTreasuryCost({
      workers: 50,
      unionization: 0,
      isOwnSector: false,
    });
    const large = organizeSectorTreasuryCost({
      workers: 2_000,
      unionization: 0,
      isOwnSector: false,
    });
    expect(small).toBe(100);
    expect(large).toBe(4_000);
    expect(small).toBeLessThan(large);
  });

  it("floors an empty unorganized shop rather than making the click free", () => {
    expect(organizeSectorTreasuryCost({ workers: 0, unionization: 0, isOwnSector: false })).toBe(
      ORGANIZE_TREASURY_COST_MIN
    );
  });

  it("caps a giant unorganized shop", () => {
    expect(
      organizeSectorTreasuryCost({ workers: 100_000, unionization: 0, isOwnSector: false })
    ).toBe(ORGANIZE_TREASURY_COST_MAX);
  });

  it("reinforcing an already-held shop scales with current unionization", () => {
    const atTen = organizeSectorTreasuryCost({
      workers: 500,
      unionization: 10,
      isOwnSector: true,
    });
    const atEighty = organizeSectorTreasuryCost({
      workers: 500,
      unionization: 80,
      isOwnSector: true,
    });
    expect(atTen).toBe(100);
    expect(atEighty).toBe(800);
    expect(atEighty).toBeGreaterThan(atTen);
  });

  it("a held shop at 0% still pays the floor, not zero", () => {
    expect(organizeSectorTreasuryCost({ workers: 500, unionization: 0, isOwnSector: true })).toBe(
      ORGANIZE_TREASURY_COST_MIN
    );
  });
});
