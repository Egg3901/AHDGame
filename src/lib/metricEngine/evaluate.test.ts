import { describe, expect, it } from "vitest";
import { evaluateRegistry } from "./evaluate";
import { topoSort } from "./topoSort";
import type { RegistryNode } from "./types";

const n = (id: string, over: Partial<RegistryNode>): RegistryNode => {
  const [categoryId, metricId] = id.split(".");
  return {
    id,
    categoryId: categoryId as RegistryNode["categoryId"],
    metricId,
    kind: "derived",
    inputs: [],
    bounds: [0, 100],
    inertia: 0,
    ...over,
  };
};

describe("evaluateRegistry", () => {
  it("evaluates in topo order, exposing upstream this-turn values downstream", () => {
    const nodes = [
      n("economic.a", { compute: () => 10 }),
      n("economic.b", { inputs: ["economic.a"], compute: (c) => c.current["economic.a"] + 1 }),
    ];
    // No stored policy values → fresh metrics: each value nets to its compute output.
    const out = evaluateRegistry(topoSort(nodes), {
      stateId: "s1",
      prev: {},
      prevSimBaseline: {},
      providers: {},
      spending: {},
      policyValues: {},
    });
    expect(out["economic.a"].value).toBe(10);
    expect(out["economic.b"].value).toBe(11);
  });

  it("reads {lagged} edges from prev, not this turn", () => {
    const nodes = [
      n("economic.a", {
        inputs: [{ lagged: "economic.b" }],
        compute: (c) => c.prev["economic.b"] ?? -1,
      }),
      n("economic.b", { compute: () => 99 }),
    ];
    const out = evaluateRegistry(topoSort(nodes), {
      stateId: "s1",
      prev: { "economic.b": 7 },
      prevSimBaseline: {},
      providers: {},
      spending: {},
      policyValues: {},
    });
    expect(out["economic.a"].value).toBe(7); // last turn's b, not 99
  });

  it("preserves a policy delta when a stored policy value is present", () => {
    const nodes = [n("economic.a", { compute: () => 3 })];
    // stored value 5, prev baseline 2 → policyDelta 3 preserved on top of sim
    const out = evaluateRegistry(topoSort(nodes), {
      stateId: "s1",
      prev: { "economic.a": 5 },
      prevSimBaseline: { "economic.a": 2 },
      providers: {},
      spending: {},
      policyValues: { "economic.a": 5 },
    });
    // newSimBaseline = 0*2 + 1*3 = 3 ; value = 3 + (5-2) = 6
    expect(out["economic.a"].value).toBe(6);
  });
});
