import { describe, it, expect } from "vitest";
import { CORPORATION_TYPES } from "../corporations";
import { SECTOR_STRATEGIES } from "../sectorStrategies";
import { TECH_DECADES } from "./decades";
import { TECH_TREE } from "./nodes";

describe("tech tree content (v2)", () => {
  it("every sector has 9 corporate + 9 sector nodes per decade for all eras", () => {
    for (const type of CORPORATION_TYPES) {
      for (const decade of TECH_DECADES) {
        const corp = TECH_TREE[type].filter(
          (n) => n.decadeId === decade.id && n.lane === "generic"
        );
        const sector = TECH_TREE[type].filter(
          (n) => n.decadeId === decade.id && n.lane === "sector"
        );
        expect(corp, `${type} corporate ${decade.id}`).toHaveLength(9);
        expect(sector, `${type} sector ${decade.id}`).toHaveLength(9);
        expect(corp.map((n) => n.slot).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(sector.map((n) => n.slot).sort((a, b) => a - b)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]);
      }
    }
  });

  it("early-era sector lanes keep both sides of the root fork (ticket-1016)", () => {
    for (const type of CORPORATION_TYPES) {
      for (const decadeId of ["1940", "1950", "1960", "1970"] as const) {
        const slots = new Set(
          TECH_TREE[type]
            .filter((n) => n.decadeId === decadeId && n.lane === "sector")
            .map((n) => n.slot)
        );
        expect(slots.has(2), `${type} ${decadeId} left branch`).toBe(true);
        expect(slots.has(3), `${type} ${decadeId} right branch`).toBe(true);
      }
    }
  });

  it("node ids are unique within a sector tree", () => {
    for (const type of CORPORATION_TYPES) {
      const ids = TECH_TREE[type].map((n) => n.id);
      expect(new Set(ids).size, type).toBe(ids.length);
    }
  });

  it("every unlockStrategy effect references a real strategy in that sector", () => {
    for (const type of CORPORATION_TYPES) {
      const validIds = new Set((SECTOR_STRATEGIES[type] ?? []).map((s) => s.id));
      for (const node of TECH_TREE[type]) {
        for (const eff of node.effects) {
          if (eff.kind === "unlockStrategy") {
            expect(validIds.has(eff.strategyId), `${type}:${node.id} → ${eff.strategyId}`).toBe(
              true
            );
          }
        }
      }
    }
  });

  it("every requiresTechUnlock strategy has an unlock node in its sector tree", () => {
    for (const type of CORPORATION_TYPES) {
      const unlockedByTree = new Set(
        TECH_TREE[type].flatMap((n) =>
          n.effects.filter((e) => e.kind === "unlockStrategy").map((e) => e.strategyId)
        )
      );
      for (const strategy of SECTOR_STRATEGIES[type] ?? []) {
        if (strategy.requiresTechUnlock) {
          // Without a matching unlock node this strategy is permanently unbuildable
          // once tech trees are on — strand-a-method footgun.
          expect(unlockedByTree.has(strategy.id), `${type}:${strategy.id} has no unlock node`).toBe(
            true
          );
        }
      }
    }
  });

  it("every node carries at least one effect", () => {
    for (const type of CORPORATION_TYPES) {
      for (const node of TECH_TREE[type]) {
        expect(node.effects.length, `${type}:${node.id}`).toBeGreaterThan(0);
      }
    }
  });
});
