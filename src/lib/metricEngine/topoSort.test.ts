import { describe, expect, it } from "vitest";
import { topoSort } from "./topoSort";
import type { RegistryNode } from "./types";

function node(id: string, inputs: RegistryNode["inputs"]): RegistryNode {
  const [categoryId, metricId] = id.split(".");
  return {
    id,
    categoryId: categoryId as RegistryNode["categoryId"],
    metricId,
    kind: "derived",
    inputs,
    bounds: [0, 100],
    inertia: 0.7,
  };
}

describe("topoSort", () => {
  it("orders dependencies before dependents", () => {
    const nodes = [node("e.b", ["e.a"]), node("e.a", []), node("e.c", ["e.b"])];
    const order = topoSort(nodes).map((n) => n.id);
    expect(order.indexOf("e.a")).toBeLessThan(order.indexOf("e.b"));
    expect(order.indexOf("e.b")).toBeLessThan(order.indexOf("e.c"));
  });

  it("ignores {lagged} edges when ordering (cycle broken)", () => {
    // a depends on lagged b; b depends on a → only a→b is a real edge
    const nodes = [node("e.a", [{ lagged: "e.b" }]), node("e.b", ["e.a"])];
    const order = topoSort(nodes).map((n) => n.id);
    expect(order).toEqual(["e.a", "e.b"]);
  });

  it("ignores {spending}/{provider} edges when ordering", () => {
    const nodes = [node("e.a", [{ spending: "social" }, { provider: "sectorRevenue" }])];
    const order = topoSort(nodes).map((n) => n.id);
    expect(order).toEqual(["e.a"]);
  });

  it("treats an input that is not a registered node as a non-edge", () => {
    // "e.external" is not in the node set → must not block ordering
    const nodes = [node("e.a", ["e.external"])];
    expect(topoSort(nodes).map((n) => n.id)).toEqual(["e.a"]);
  });

  it("throws on a true same-turn cycle", () => {
    const nodes = [node("e.a", ["e.b"]), node("e.b", ["e.a"])];
    expect(() => topoSort(nodes)).toThrow(/cycle/i);
  });
});
