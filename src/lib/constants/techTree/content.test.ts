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
        const allSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        expect(corp, `${type} corporate ${decade.id}`).toHaveLength(15);
        expect(sector, `${type} sector ${decade.id}`).toHaveLength(15);
        expect(corp.map((n) => n.slot).sort((a, b) => a - b)).toEqual(allSlots);
        expect(sector.map((n) => n.slot).sort((a, b) => a - b)).toEqual(allSlots);
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

describe("tech tree content (v3 specializations)", () => {
  const v3Nodes = (type: (typeof CORPORATION_TYPES)[number]) =>
    TECH_TREE[type].filter((n) => n.slot >= 10);

  it("entries 10-12 form one exclusive group of three; capstones have none", () => {
    for (const type of CORPORATION_TYPES) {
      for (const decade of TECH_DECADES) {
        for (const lane of ["generic", "sector"] as const) {
          const tier = TECH_TREE[type].filter(
            (n) => n.decadeId === decade.id && n.lane === lane && n.slot >= 10
          );
          const entries = tier.filter((n) => n.slot <= 12);
          const capstones = tier.filter((n) => n.slot >= 13);
          expect(entries, `${type} ${lane} ${decade.id} entries`).toHaveLength(3);
          expect(capstones, `${type} ${lane} ${decade.id} capstones`).toHaveLength(3);
          const groups = new Set(entries.map((n) => n.exclusiveGroup));
          expect(groups.size, `${type} ${lane} ${decade.id} one group`).toBe(1);
          expect([...groups][0], `${type} ${lane} ${decade.id} group set`).toBeTruthy();
          for (const cap of capstones) {
            expect(cap.exclusiveGroup, `${type}:${cap.id} capstone no group`).toBeUndefined();
          }
        }
      }
    }
  });

  it("prereq wiring: entries need slot 8 or 9, capstone N needs entry N-3", () => {
    for (const type of CORPORATION_TYPES) {
      for (const node of v3Nodes(type)) {
        const idOf = (s: number) => node.id.replace(/-\d+$/, `-${s}`);
        if (node.slot <= 12) {
          expect(node.prereqIds, `${type}:${node.id}`).toEqual([idOf(8), idOf(9)]);
        } else {
          expect(node.prereqIds, `${type}:${node.id}`).toEqual([idOf(node.slot - 3)]);
        }
      }
    }
  });

  it("costs scale by tier: entries 2x, capstones 3x the decade cost", () => {
    for (const type of CORPORATION_TYPES) {
      for (const decade of TECH_DECADES) {
        const base = TECH_TREE[type].find(
          (n) => n.decadeId === decade.id && n.slot === 1 && n.lane === "sector"
        )!.cost;
        for (const node of TECH_TREE[type].filter((n) => n.decadeId === decade.id)) {
          if (node.slot >= 10 && node.slot <= 12) {
            expect(node.cost, `${type}:${node.id}`).toBe(base * 2);
          } else if (node.slot >= 13) {
            expect(node.cost, `${type}:${node.id}`).toBe(base * 3);
          }
        }
      }
    }
  });

  it("v3 nodes never use unlockStrategy or cashRevenueFraction", () => {
    for (const type of CORPORATION_TYPES) {
      for (const node of v3Nodes(type)) {
        expect(node.cashRevenueFraction, `${type}:${node.id}`).toBeUndefined();
        for (const eff of node.effects) {
          expect(eff.kind, `${type}:${node.id}`).not.toBe("unlockStrategy");
        }
      }
    }
  });

  it("corporate-lane v3 nodes carry no commodity-specific effects", () => {
    for (const node of v3Nodes(CORPORATION_TYPES[0]).filter((n) => n.lane === "generic")) {
      for (const eff of node.effects) {
        expect(["inputCost", "outputRate"].includes(eff.kind), `corp:${node.id}`).toBe(false);
      }
    }
  });

  it("sector-lane commodity effects reference commodities the sector really trades", () => {
    for (const type of CORPORATION_TYPES) {
      const supply = new Set<string>();
      const demand = new Set<string>();
      for (const strategy of SECTOR_STRATEGIES[type] ?? []) {
        for (const c of Object.keys(strategy.supply ?? {})) supply.add(c);
        for (const c of Object.keys(strategy.demand ?? {})) demand.add(c);
      }
      for (const node of v3Nodes(type).filter((n) => n.lane === "sector")) {
        for (const eff of node.effects) {
          if (eff.kind === "outputRate") {
            expect(supply.has(eff.commodity), `${type}:${node.id} supplies ${eff.commodity}`).toBe(
              true
            );
          } else if (eff.kind === "inputCost") {
            expect(demand.has(eff.commodity), `${type}:${node.id} demands ${eff.commodity}`).toBe(
              true
            );
          }
        }
      }
    }
  });

  it("effect magnitudes stay inside the authoring bands", () => {
    for (const type of CORPORATION_TYPES) {
      for (const node of v3Nodes(type)) {
        for (const eff of node.effects) {
          const tag = `${type}:${node.id}:${eff.kind}`;
          if (eff.kind === "priceRealization") expect(eff.pct, tag).toBeLessThanOrEqual(0.03);
          if (eff.kind === "marginBonus") expect(eff.pp, tag).toBeLessThanOrEqual(1.5);
          if (eff.kind === "outputRate") expect(eff.pct, tag).toBeLessThanOrEqual(0.1);
          if (eff.kind === "inputCost") expect(eff.pct, tag).toBeLessThanOrEqual(0.15);
          if (eff.kind === "laborCostReduction") expect(eff.pct, tag).toBeLessThanOrEqual(0.1);
          if (eff.kind === "growthCostReduction") expect(eff.pct, tag).toBeLessThanOrEqual(0.08);
          if (eff.kind === "dominanceShield" || eff.kind === "tariffShield")
            expect(eff.pct, tag).toBeLessThanOrEqual(0.25);
          if (eff.kind === "expansionDiscount") expect(eff.pct, tag).toBeLessThanOrEqual(0.2);
          if (eff.kind === "marketingStrength" || eff.kind === "logisticsStrength")
            expect(eff.flat, tag).toBeLessThanOrEqual(40);
        }
      }
    }
  });

  it("player copy carries no em or en dashes", () => {
    for (const type of CORPORATION_TYPES) {
      for (const node of v3Nodes(type)) {
        expect(`${node.name}${node.description}`, `${type}:${node.id}`).not.toMatch(/[–—]/);
      }
    }
  });
});
