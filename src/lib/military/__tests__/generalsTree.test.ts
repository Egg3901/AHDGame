import { describe, it, expect } from "vitest";
import {
  FULLTREE,
  SPEC_PROFILE,
  SPEC_SEED,
  STAT_META,
  STARTING_POINTS,
  newGeneral,
  findTreeNode,
  sanitizeGtraits,
  learnedOf,
  nodeStatus,
  trainNode,
  treeMods,
  specProfile,
  type ProfileGeneral,
} from "../generalsTree";

describe("FULLTREE data", () => {
  it("defines the 6 trait categories", () => {
    expect(Object.keys(FULLTREE).sort()).toEqual([
      "battlefield",
      "command",
      "joint",
      "logistics",
      "operational",
      "political",
    ]);
    const armor = FULLTREE.battlefield.paths.find((p) => p.id === "armor");
    expect(armor?.nodes[0]?.name).toBe("Tank Commander");
  });
  it("exposes spec profiles + seeds + stat meta", () => {
    expect(SPEC_PROFILE.armor.branch).toBe("Army");
    expect(SPEC_SEED.armor.length).toBeGreaterThan(0);
    expect(STAT_META.length).toBeGreaterThan(0);
  });
});

describe("findTreeNode + specProfile", () => {
  it("finds a node by id", () => {
    expect(findTreeNode("ar1")?.node.name).toBe("Tank Commander");
    expect(findTreeNode("nope")).toBeNull();
  });
  it("returns a spec profile (fallback to armor)", () => {
    expect(specProfile("naval").branch).toBe("Navy");
    expect(specProfile("bogus" as never).reputation).toBeTruthy();
  });
});

describe("learnedOf + seeds", () => {
  it("returns the nodes a general has trained", () => {
    const g: ProfileGeneral = {
      level: 3,
      xp: 0,
      pts: 1,
      gtraits: ["ar1"],
    };
    expect(learnedOf(g)).toEqual(["ar1"]);
  });

  // Specialisation derives from what was learned, so seeding learned from a spec
  // would be circular. A general who has trained nothing knows nothing.
  it("returns nothing for a general who has trained nothing", () => {
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 1 };
    expect(learnedOf(g)).toEqual([]);
  });
  it("sanitizeGtraits drops unknown ids", () => {
    expect(sanitizeGtraits(["ar1", "zzz"])).toEqual(["ar1"]);
  });
});

describe("nodeStatus", () => {
  const armorPath = FULLTREE.battlefield.paths.find((p) => p.id === "armor")!;
  it("marks a learned node", () => {
    expect(nodeStatus(["ar1"], armorPath, armorPath.nodes[0], 1940)).toBe("learned");
  });
  it("marks a future-era node", () => {
    const future = armorPath.nodes.find((n) => n.dec > 1940)!;
    expect(nodeStatus([], armorPath, future, 1940)).toBe("future");
  });
  it("locks a node whose predecessor is not owned", () => {
    // second node with prevOwned=false is locked
    expect(nodeStatus([], armorPath, armorPath.nodes[1], 1940)).toBe("locked");
  });
  it("first-in-path is available in-era", () => {
    expect(nodeStatus([], armorPath, armorPath.nodes[0], 1940)).toBe("available");
  });
});

describe("trainNode", () => {
  it("learns an available node and spends its cost", () => {
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 2, gtraits: [] };
    const res = trainNode(g, "in1", 1940); // infantry-0, available first-in-path in-era
    expect(res.changed).toBe(true);
    expect(res.general.gtraits).toContain("in1");
    expect(res.general.pts).toBe(2 - findTreeNode("in1")!.node.cost);
  });
  it("refuses with no points", () => {
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 0, gtraits: [] };
    expect(trainNode(g, "in1", 1940).changed).toBe(false);
  });

  // Both devs independently found that `cost` was enforced nowhere — the check was
  // `pts >= 1` and the deduction a flat 1, so a general holding one point could take
  // anything. The resolution keeps the enforcement and flattens every node to 1 point,
  // so specialisation is bounded by how many points a career yields rather than by
  // which nodes are expensive.
  it("charges the node's cost, which is one point for every node", () => {
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 2, gtraits: [] };
    const res = trainNode(g, "in1", 1940);
    expect(res.changed).toBe(true);
    expect(res.general.pts).toBe(1);
  });

  it("refuses a general with no points left", () => {
    const path = FULLTREE.command.paths.find((candidate) => candidate.nodes.length >= 2)!;
    const node = path.nodes[1];
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 0, gtraits: [path.nodes[0].id] };
    expect(trainNode(g, node.id, 2040).changed).toBe(false);
  });

  it("spends the last point exactly", () => {
    const path = FULLTREE.command.paths.find((candidate) => candidate.nodes.length >= 2)!;
    const node = path.nodes[1];
    const g: ProfileGeneral = { level: 3, xp: 0, pts: 1, gtraits: [path.nodes[0].id] };
    const res = trainNode(g, node.id, 2040);
    expect(res.changed).toBe(true);
    expect(res.general.pts).toBe(0);
  });

  // Guards the flatten itself: authored costs remain in the source as arguments to
  // N(), so only the factory keeps them uniform. A node that reintroduced a 3-point
  // price would silently change the whole progression budget.
  it("prices every node in the tree at one point", () => {
    const costs = new Set<number>();
    for (const ck in FULLTREE) {
      for (const path of FULLTREE[ck].paths) {
        for (const node of path.nodes) costs.add(node.cost);
      }
    }
    expect([...costs]).toEqual([1]);
  });
});

describe("newGeneral", () => {
  it("creates a fresh level-1 general with starting points and nothing trained", () => {
    const g = newGeneral("char-42", "Jane Doe", "JD", "DE");
    expect(g.id).toBe("char-42");
    expect(g.country).toBe("DE");
    expect(g.gtraits).toEqual([]);
    expect(g.level).toBe(1);
    expect(g.pts).toBe(STARTING_POINTS);
  });
});

describe("treeMods", () => {
  it("aggregates combat mods from learned node ids", () => {
    const m = treeMods(["ar1"]); // Tank Commander: cvTrait armored 1.08
    expect(m.cvTrait.armored).toBeCloseTo(1.08, 5);
  });
});
