import { describe, expect, it } from "vitest";
import {
  connectedGrowthFrontier,
  preservesPartyTerritory,
  territoryComponents,
  territoryConnectionBudget,
} from "./territory";
import { STATE_ADJACENCY } from "@/lib/constants/stateAdjacency";

const graph = { A: ["B"], B: ["A", "C", "D"], C: ["B"], D: ["B"], X: ["Y"], Y: ["X"] };

describe("connected party territory", () => {
  it.each([
    [[], ["A"], true],
    [["A"], [], true],
    [["A", "B", "C"], ["A", "C", "D"], false],
    [["A", "B", "C"], ["A", "B", "C", "D"], true],
    [["A", "B"], ["A", "D"], false],
    [["A", "B"], ["B", "C"], true],
    [["A", "B", "C"], ["B", "C"], true],
    [["A", "B", "C"], ["A", "C"], false],
    [["A", "B", "C", "X"], ["A", "C", "X", "Y"], false],
    [["A", "X"], ["A", "B", "X"], false],
    [["A", "X"], ["A", "Y"], false],
    [["A", "C"], ["A", "B", "C"], true],
  ])("%j -> %j is allowed: %s", (before, after, allowed) => {
    expect(preservesPartyTerritory(before as string[], after as string[], graph)).toBe(allowed);
  });

  it("does not let healing one area pay for splitting another", () => {
    const adjacency = { A: ["B"], B: ["A", "C"], C: ["B"], X: ["Z"], Z: ["X", "Y"], Y: ["Z"] };
    expect(
      preservesPartyTerritory(["A", "B", "C", "X", "Y"], ["A", "C", "X", "Z", "Y"], adjacency)
    ).toBe(false);
  });

  it("preserves the deliberate island exception, not unknown-region teleportation", () => {
    expect(territoryComponents(["A", "ISLAND"], { ...graph, ISLAND: [] })).toHaveLength(1);
    expect(territoryComponents(["A", "UNKNOWN"], graph)).toHaveLength(2);
  });

  it("does not mutate its input sets", () => {
    const states = new Set(["A", "B", "C"]);
    territoryComponents(states, graph);
    expect([...states]).toEqual(["A", "B", "C"]);
  });

  it("allows a multi-step connecting path but not an outward branch", () => {
    const adjacency = {
      A: ["B", "OUT"],
      B: ["A", "C"],
      C: ["B", "D"],
      D: ["C", "E"],
      E: ["D"],
      OUT: ["A"],
    };
    let presence = new Set(["A", "E"]);
    expect(territoryConnectionBudget(presence, adjacency)).toBe(3);
    expect([...connectedGrowthFrontier(presence, ["A", "B", "D", "E", "OUT"], adjacency)]).toEqual([
      "A",
      "B",
      "D",
      "E",
    ]);
    for (const state of ["B", "C", "D"]) {
      const after = new Set([...presence, state]);
      expect(preservesPartyTerritory(presence, after, adjacency)).toBe(true);
      expect(territoryConnectionBudget(after, adjacency)).toBeLessThan(
        territoryConnectionBudget(presence, adjacency)
      );
      presence = after;
    }
    expect(preservesPartyTerritory(presence, new Set([...presence, "OUT"]), adjacency)).toBe(true);
  });

  it("allows equal-length alternative connecting paths", () => {
    const adjacency = { A: ["B", "C"], B: ["A", "D"], C: ["A", "D"], D: ["B", "C"] };
    expect([...connectedGrowthFrontier(["A", "D"], ["A", "B", "C", "D"], adjacency)]).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("does not use an exempt island to heal mainland fragmentation", () => {
    expect(territoryComponents(["A", "X", "ISLAND"], { ...graph, ISLAND: [] })).toHaveLength(2);
    expect(
      preservesPartyTerritory(["A", "X"], ["A", "X", "ISLAND"], { ...graph, ISLAND: [] })
    ).toBe(false);
  });

  it("uses the game's actual Pacific and UK sea connections", () => {
    expect(territoryComponents(["HI", "CA", "OR"], STATE_ADJACENCY.US)).toHaveLength(1);
    expect(territoryComponents(["SCO", "NWE", "NIR"], STATE_ADJACENCY.UK)).toHaveLength(1);
    expect(preservesPartyTerritory(["SCO", "NWE", "NIR"], ["SCO", "NIR"], STATE_ADJACENCY.UK)).toBe(
      true
    );
  });

  it("never permits a connected territory to split on small exhaustive footprints", () => {
    const states = Object.keys(graph);
    for (let mask = 0; mask < 1 << states.length; mask++) {
      const before = states.filter((_, bit) => mask & (1 << bit));
      if (territoryComponents(before, graph).length > 1) continue;
      for (const removed of before) {
        for (const destination of states) {
          const after = new Set([...before.filter((state) => state !== removed), destination]);
          if (territoryComponents(after, graph).length > 1)
            expect(preservesPartyTerritory(before, after, graph)).toBe(false);
        }
      }
    }
  });
  it.each(["US", "UK", "JP"] as const)(
    "always offers a finite reconnection path on the %s map",
    (country) => {
      const adjacency = STATE_ADJACENCY[country];
      const states = Object.keys(adjacency);
      const presence = new Set(
        states.filter((_, index) => index % 5 === 0 || index === states.length - 1)
      );
      for (let step = 0; territoryComponents(presence, adjacency).length > 1; step++) {
        expect(step).toBeLessThan(states.length);
        const frontier = new Set([
          ...presence,
          ...[...presence].flatMap((state) => adjacency[state] ?? []),
        ]);
        const choices = [...connectedGrowthFrontier(presence, frontier, adjacency)].filter(
          (state) => !presence.has(state)
        );
        expect(choices.length).toBeGreaterThan(0);
        const before = territoryConnectionBudget(presence, adjacency);
        presence.add(choices.sort()[0]);
        expect(territoryConnectionBudget(presence, adjacency)).toBeLessThan(before);
      }
    }
  );
});
