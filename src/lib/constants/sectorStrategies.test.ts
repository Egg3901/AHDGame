import { describe, expect, it } from "vitest";
import { SECTOR_STRATEGIES } from "./sectorStrategies";
import { COMMODITY_TYPES } from "./commodities";

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
