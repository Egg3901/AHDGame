import { describe, expect, it } from "vitest";
import { POLITICAL_NODES, politicalNodeTargets } from "./engineNodes";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";
import { MACRO_CATEGORIES } from "@/lib/macroMetrics/paths";

const BASE = {
  countryId: "US",
  stateId: "s1",
  providers: {},
  spending: {} as Record<string, number>,
  legacy: {} as Record<string, number>,
};

describe("POLITICAL_NODES", () => {
  it("is every registry node the board owns, and no macro node", () => {
    expect(POLITICAL_NODES.length).toBeGreaterThan(0);
    for (const n of POLITICAL_NODES) expect(MACRO_CATEGORIES.has(n.categoryId)).toBe(false);
    const macro = METRIC_REGISTRY_SORTED.filter((n) => MACRO_CATEGORIES.has(n.categoryId));
    expect(POLITICAL_NODES.length + macro.length).toBe(METRIC_REGISTRY_SORTED.length);
  });

  it("preserves the registry's topological order", () => {
    // A subsequence of a topo order is still a topo order — this pins that the
    // filter did not reorder, because a reorder would silently feed a node its
    // dependency's LAST-turn value instead of this turn's.
    const positionInRegistry = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    const positions = POLITICAL_NODES.map((n) => positionInRegistry.get(n.id)!);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("politicalNodeTargets", () => {
  it("produces a target for the modelled political metrics", () => {
    const targets = politicalNodeTargets({ ...BASE, spending: { education: 1300 } });
    expect(Object.keys(targets).length).toBeGreaterThan(0);
    for (const id of Object.keys(targets)) {
      expect(MACRO_CATEGORIES.has(id.split(".")[0])).toBe(false);
      expect(Number.isFinite(targets[id])).toBe(true);
    }
  });

  it("responds to spending — the whole reason the channel exists", () => {
    // If this stops holding, funding schools no longer moves education
    // outcomes, which is precisely the capability the board term preserves.
    const starved = politicalNodeTargets({ ...BASE, spending: { education: 0 } });
    const funded = politicalNodeTargets({ ...BASE, spending: { education: 6500 } });
    const moved = Object.keys(funded).filter(
      (id) => id.startsWith("education.") && funded[id] !== starved[id]
    );
    expect(moved.length).toBeGreaterThan(0);
    for (const id of moved) expect(funded[id]).toBeGreaterThan(starved[id]);
  });

  it("omits roots rather than echoing the current value back", () => {
    // A root has no compute(). Echoing it would hand the board a "target"
    // equal to its own value — a guaranteed zero contribution that also
    // dilutes the average of every family the root shares.
    const roots = POLITICAL_NODES.filter((n) => !n.compute).map((n) => n.id);
    const targets = politicalNodeTargets({
      ...BASE,
      legacy: Object.fromEntries(roots.map((id) => [id, 42])),
    });
    for (const id of roots) expect(targets[id]).toBeUndefined();
  });

  it("keeps every target inside its node's authored bounds", () => {
    // Absurd inputs in both directions; the engine owns bounds (spec S1) and a
    // target outside them would convert to an out-of-scale board score.
    for (const spend of [0, 1e9]) {
      const targets = politicalNodeTargets({
        ...BASE,
        spending: Object.fromEntries(
          [
            "education",
            "healthcare",
            "infrastructure",
            "publicSafety",
            "social",
            "environment",
          ].map((c) => [c, spend])
        ),
      });
      for (const node of POLITICAL_NODES) {
        const t = targets[node.id];
        if (t === undefined) continue;
        expect(t).toBeGreaterThanOrEqual(node.bounds[0]);
        expect(t).toBeLessThanOrEqual(node.bounds[1]);
      }
    }
  });

  it("threads a node's own output to its dependants within the turn", () => {
    // The topo guarantee, observed rather than assumed: changing an upstream
    // input has to reach downstream nodes in the SAME call, not next turn.
    const low = politicalNodeTargets({ ...BASE, legacy: { "social.childPoverty": 2 } });
    const high = politicalNodeTargets({ ...BASE, legacy: { "social.childPoverty": 40 } });
    const differing = Object.keys(low).filter((id) => low[id] !== high[id]);
    expect(differing.length).toBeGreaterThan(0);
  });

  it("never emits a non-finite target", () => {
    // A misauthored compute() must not poison a family average. Feed junk.
    const targets = politicalNodeTargets({
      ...BASE,
      legacy: { "economic.medianIncome": Number.NaN, "social.childPoverty": Number.NaN },
      spending: { education: Number.NaN },
    });
    for (const v of Object.values(targets)) expect(Number.isFinite(v)).toBe(true);
  });
});
