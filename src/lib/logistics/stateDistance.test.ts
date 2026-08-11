import { describe, it, expect } from "vitest";
import { stateHops } from "./stateDistance";

describe("stateHops", () => {
  it("is 0 for the same state", () => {
    expect(stateHops("US", "TX", "TX")).toBe(0);
  });

  it("is 1 for adjacent states", () => {
    expect(stateHops("US", "CA", "NV")).toBe(1);
    // Sea-border edge by adjacency-map convention.
    expect(stateHops("US", "AK", "WA")).toBe(1);
  });

  it("counts multi-hop routes as shortest paths", () => {
    // Shortest CA → TX route is CA → AZ → NM → TX.
    expect(stateHops("US", "CA", "TX")).toBe(3);
    const coastToCoast = stateHops("US", "CA", "ME");
    expect(coastToCoast).not.toBeNull();
    expect(coastToCoast!).toBeGreaterThanOrEqual(8);
  });

  it("is symmetric", () => {
    expect(stateHops("US", "FL", "WA")).toBe(stateHops("US", "WA", "FL"));
  });

  it("returns null when no route exists (HI is standalone)", () => {
    expect(stateHops("US", "HI", "CA")).toBeNull();
    expect(stateHops("US", "CA", "HI")).toBeNull();
  });

  it("returns null for unknown states", () => {
    expect(stateHops("US", "CA", "ZZ")).toBeNull();
  });
});
