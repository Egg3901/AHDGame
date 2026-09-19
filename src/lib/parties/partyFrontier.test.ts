import { describe, it, expect } from "vitest";
import { expandFrontier, isInFrontier } from "@/lib/parties/partyFrontier";

describe("expandFrontier", () => {
  it("includes the presence state itself plus its neighbours", () => {
    const f = expandFrontier("US", ["TN"]);
    expect(f.has("TN")).toBe(true);
    expect(f.has("KY")).toBe(true);
    expect(f.has("CA")).toBe(false);
  });

  it("unions two disconnected clusters without bridging them", () => {
    const f = expandFrontier("US", ["CA", "NY"]);
    expect(f.has("OR")).toBe(true);
    expect(f.has("PA")).toBe(true);
    expect(f.has("TX")).toBe(false);
  });

  it("keeps an isolated state that has no neighbours (HI)", () => {
    expect([...expandFrontier("US", ["HI"])]).toEqual(["HI"]);
  });

  it("keeps a state absent from the adjacency map, with no expansion", () => {
    expect([...expandFrontier("US", ["ZZ"])]).toEqual(["ZZ"]);
  });

  it("returns an empty set for empty presence", () => {
    expect(expandFrontier("US", []).size).toBe(0);
  });

  it("de-dupes repeated inputs", () => {
    const f = expandFrontier("US", ["NY", "NY"]);
    expect(f.has("NY")).toBe(true);
    expect([...f].length).toBe(new Set([...f]).size);
  });
});

describe("isInFrontier", () => {
  const presence = new Set(["NY"]);
  const frontier = expandFrontier("US", presence);

  it("allows a state inside the frontier", () => {
    expect(isInFrontier(presence, frontier, "PA")).toBe(true);
  });

  it("blocks a state outside the frontier", () => {
    expect(isInFrontier(presence, frontier, "CA")).toBe(false);
  });

  it("fails open when the party has no presence anywhere", () => {
    const empty = new Set<string>();
    expect(isInFrontier(empty, expandFrontier("US", empty), "CA")).toBe(true);
  });

  it("fails open for a character with no home state", () => {
    expect(isInFrontier(presence, frontier, null)).toBe(true);
    expect(isInFrontier(presence, frontier, undefined)).toBe(true);
    expect(isInFrontier(presence, frontier, "")).toBe(true);
  });

  it("blocks a California player from a NY/PA/MD party (the motivating case)", () => {
    const p = new Set(["NY", "PA", "MD"]);
    const f = expandFrontier("US", p);
    expect(isInFrontier(p, f, "CA")).toBe(false);
    expect(isInFrontier(p, f, "OH")).toBe(true);
  });
});
