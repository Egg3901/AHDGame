import { describe, it, expect } from "vitest";
import {
  DOCTRINE_CATS,
  DECADES,
  DEFAULT_ADOPTED,
  DEFAULT_POINTS,
  keyOf,
  findNode,
  prevNode,
  nodeStatus,
  isAdoptedByName,
  adoptNode,
  natMods,
  adoptedCount,
  latestEraIndex,
  doctrineEraForYear,
} from "../doctrineTree";

describe("doctrine tree data", () => {
  it("exposes 8 categories with paths and decade nodes", () => {
    expect(DOCTRINE_CATS.length).toBe(8);
    const maneuver = DOCTRINE_CATS.find((c) => c.id === "land")?.paths.find(
      (p) => p.id === "maneuver"
    );
    expect(maneuver?.nodes[0]?.name).toBe("General Staff Planning");
    expect(DECADES.length).toBe(15);
  });

  it("seeds a default adopted set and points", () => {
    expect(Object.keys(DEFAULT_ADOPTED).length).toBeGreaterThan(0);
    expect(DEFAULT_POINTS).toBe(12);
    expect(adoptedCount(DEFAULT_ADOPTED, "land")).toBeGreaterThan(0);
  });
});

describe("nodeStatus", () => {
  const cur = 4; // 1940s
  it("labels an adopted node", () => {
    const f = findNode("maneuver-0")!;
    expect(nodeStatus({ "maneuver-0": 1 }, f.path, f.node, cur)).toBe("adopted");
  });
  it("labels a future-era node", () => {
    const f = findNode("maneuver-14")!; // 2040s node, d=14 > 4
    expect(nodeStatus({}, f.path, f.node, cur)).toBe("future");
  });
  it("locks a node whose in-path predecessor is not adopted", () => {
    const f = findNode("maneuver-3")!; // Armored Spearhead, needs maneuver-2 first
    expect(nodeStatus({}, f.path, f.node, cur)).toBe("locked");
  });
  it("marks the first-in-path node available when in-era", () => {
    const f = findNode("firepower-0")!;
    expect(nodeStatus({}, f.path, f.node, cur)).toBe("available");
  });
});

describe("prevNode", () => {
  it("returns the nearest lower-decade node in the path", () => {
    const f = findNode("maneuver-4")!;
    expect(prevNode(f.path, f.node.d)?.d).toBe(3);
  });
});

describe("adoptNode", () => {
  it("adopts an available node and spends its cost", () => {
    const start = { adopted: {} as Record<string, number>, points: 12 };
    const res = adoptNode(start, "firepower-0", 4);
    expect(res.changed).toBe(true);
    expect(res.state.adopted["firepower-0"]).toBe(1);
    expect(res.state.points).toBe(12 - findNode("firepower-0")!.node.cost);
  });
  it("refuses a future-era node", () => {
    const res = adoptNode({ adopted: {}, points: 12 }, "maneuver-14", 4);
    expect(res.changed).toBe(false);
    expect(res.reason).toMatch(/era/i);
  });
  it("refuses when points are insufficient", () => {
    const f = findNode("maneuver-8")!; // needs prereqs; use a cheap available node with points 0
    void f;
    const res = adoptNode({ adopted: {}, points: 0 }, "firepower-0", 4);
    expect(res.changed).toBe(false);
    expect(res.reason).toMatch(/point/i);
  });
});

describe("natMods + helpers", () => {
  it("aggregates force-wide modifiers from an adopted set", () => {
    const m = natMods(DEFAULT_ADOPTED);
    expect(typeof m.cvAll).toBe("number");
    expect(m.cvAll).toBeGreaterThan(0);
  });
  it("isAdoptedByName finds an adopted node by display name", () => {
    expect(isAdoptedByName({ "maneuver-3": 1 }, "Armored Spearhead")).toBe(true);
    expect(isAdoptedByName({}, "Armored Spearhead")).toBe(false);
  });
  it("latestEraIndex is the last decade index", () => {
    expect(latestEraIndex()).toBe(DECADES.length - 1);
  });
  it("keyOf composes path id and decade", () => {
    expect(keyOf("maneuver", 3)).toBe("maneuver-3");
  });

  it("doctrineEraForYear buckets a year into its decade index", () => {
    expect(doctrineEraForYear(1979)).toBe(7); // "1970s"
    expect(doctrineEraForYear(1945)).toBe(4); // "1940s"
    expect(doctrineEraForYear(2019)).toBe(11); // "2010s"
  });
  it("doctrineEraForYear clamps below 1900 and above the last decade", () => {
    expect(doctrineEraForYear(1850)).toBe(0);
    expect(doctrineEraForYear(2999)).toBe(DECADES.length - 1);
  });
});
