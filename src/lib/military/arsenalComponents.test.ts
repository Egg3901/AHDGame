import { describe, expect, it } from "vitest";
import {
  componentsForStrategy,
  gradeCeilingFor,
  MAX_DELIVERABLE_GRADE,
  DEFENCE_STRATEGY_COMPONENT,
} from "./arsenalComponents";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

describe("componentsForStrategy", () => {
  it("maps each defence line to the domains it actually equips", () => {
    expect(componentsForStrategy("heavy_armor")).toEqual(["ground"]);
    expect(componentsForStrategy("directed_energy")).toEqual(["air"]);
    expect(componentsForStrategy("naval_systems")).toEqual(["naval", "marine"]);
    expect(componentsForStrategy("missile_systems")).toEqual(["rocket"]);
    expect(componentsForStrategy("aerospace")).toEqual(["air", "space"]);
  });

  // Electronics and software are not materiel. A bucket here would be a store no unit could
  // draw from — the dead end that sank the original "Surveillance & Intelligence" component.
  it("gives cyber no arsenal component at all", () => {
    expect(componentsForStrategy("cyber")).toEqual([]);
  });

  it("treats an absent, null or unknown strategy as supplying nothing", () => {
    expect(componentsForStrategy(undefined)).toEqual([]);
    expect(componentsForStrategy(null)).toEqual([]);
    expect(componentsForStrategy("proptech")).toEqual([]);
    expect(componentsForStrategy("")).toEqual([]);
  });

  // The mapping and the strategy list must not drift apart: a strategy with no entry
  // silently supplies nothing, which would read as a broken contract rather than a
  // deliberate exclusion.
  it("has an entry for every defence strategy that exists", () => {
    for (const s of SECTOR_STRATEGIES.defense) {
      expect(
        Object.prototype.hasOwnProperty.call(DEFENCE_STRATEGY_COMPONENT, s.id),
        `no component mapping for defence strategy "${s.id}"`
      ).toBe(true);
    }
  });

  it("maps only to real unit domains", () => {
    const domains = new Set(["ground", "naval", "air", "rocket", "space", "marine"]);
    for (const list of Object.values(DEFENCE_STRATEGY_COMPONENT)) {
      for (const d of list) expect(domains.has(d)).toBe(true);
    }
  });

  it("covers all six unit domains across the strategy set", () => {
    const covered = new Set(Object.values(DEFENCE_STRATEGY_COMPONENT).flat());
    for (const d of ["ground", "naval", "air", "rocket", "space", "marine"]) {
      expect(covered.has(d as never), `no defence strategy supplies ${d}`).toBe(true);
    }
  });
});

// Real node ids from TECH_TREE.defense: generic lane is `corp-<decade>-<slot>`, sector lane
// `defense-<decade>-<slot>`. Resolved through the tree, never parsed from the string.
const specialist = (nodeIds: string[], decades: string[] = []) => ({
  unlockedTechNodeIds: nodeIds,
  techDecadeLane: Object.fromEntries(decades.map((d) => [d, "sector" as const])),
});

describe("gradeCeilingFor", () => {
  it("is zero for a corp that has researched nothing", () => {
    expect(gradeCeilingFor({}, 1953)).toBe(0);
    expect(gradeCeilingFor({ unlockedTechNodeIds: [] }, 1953)).toBe(0);
  });

  it("rises with the number of reached decade tiers unlocked", () => {
    const one = gradeCeilingFor(specialist(["defense-1940-1"], ["1940"]), 1953);
    const two = gradeCeilingFor(
      specialist(["defense-1940-1", "defense-1950-1"], ["1940", "1950"]),
      1953
    );
    expect(two).toBeGreaterThan(one);
  });

  // The era gate that stops a 1953 world fielding modern kit must win here too.
  it("ignores nodes in decades the world clock has not reached", () => {
    expect(gradeCeilingFor(specialist(["defense-2019-1"], ["2019"]), 1953)).toBe(0);
  });

  it("counts a decade once however many of its nodes are unlocked", () => {
    const one = gradeCeilingFor(specialist(["defense-1940-1"], ["1940"]), 1953);
    const many = gradeCeilingFor(specialist(["defense-1940-1", "defense-1940-2"], ["1940"]), 1953);
    expect(many).toBe(one);
  });

  // The lane already encodes specialist-vs-generalist; reuse it rather than inventing a
  // second distinction.
  it("caps a Corporate-lane generalist below a Specialist", () => {
    const nodes = ["defense-1940-1", "defense-1950-1", "defense-1960-1"];
    const decades = ["1940", "1950", "1960"];
    const spec = gradeCeilingFor(specialist(nodes, decades), 1979);
    const generic = gradeCeilingFor(
      {
        unlockedTechNodeIds: nodes,
        techDecadeLane: Object.fromEntries(decades.map((d) => [d, "generic" as const])),
      },
      1979
    );
    expect(generic).toBeLessThan(spec);
  });

  it("ignores node ids that are not in the defence tree", () => {
    expect(gradeCeilingFor(specialist(["technology-1940-1", "nonsense"], ["1940"]), 1953)).toBe(0);
  });

  it("never exceeds the deliverable grade ceiling", () => {
    const decades = ["1940", "1950", "1960", "1970", "1979", "1989", "1999", "2009", "2019"];
    const all = specialist(
      decades.map((d) => `defense-${d}-1`),
      decades
    );
    expect(gradeCeilingFor(all, 2029)).toBe(MAX_DELIVERABLE_GRADE);
  });

  it("returns a whole number — grade maps onto integer techTier", () => {
    const g = gradeCeilingFor(
      { unlockedTechNodeIds: ["defense-1940-1"], techDecadeLane: { "1940": "generic" } },
      1953
    );
    expect(Number.isInteger(g)).toBe(true);
  });
});
