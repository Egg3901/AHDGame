import { describe, expect, it } from "vitest";
import { STATE_ADJACENCY } from "@/lib/constants/stateAdjacency";
import { hasMergeAdjacency } from "./mergeAdjacency";

describe("merger adjacency", () => {
  it.each([
    [["CA"], ["CA"], true],
    [["CA"], ["OR"], true],
    [["OR"], ["CA"], true],
    [["CA"], ["WA"], false],
    [["GA"], ["CA"], false],
    [[], ["CA"], false],
    [["CA"], [], false],
    [[], [], false],
    [["HI"], ["CA"], false],
    [["HI"], ["HI"], true],
  ] as [string[], string[], boolean][])("%j and %j -> %s", (a, b, expected) => {
    expect(hasMergeAdjacency(new Set(a), new Set(b), STATE_ADJACENCY.US)).toBe(expected);
  });
  it("uses the game's sea adjacency", () => {
    expect(hasMergeAdjacency(new Set(["NIR"]), new Set(["NWE"]), STATE_ADJACENCY.UK)).toBe(true);
  });
});
