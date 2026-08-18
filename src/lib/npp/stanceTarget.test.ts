import { describe, expect, it } from "vitest";
import { NPP_LEAN_PULL, NPP_STANCE_SPREAD, nppIdiosyncrasy, nppStanceTarget } from "./stanceTarget";

describe("nppIdiosyncrasy", () => {
  it("is deterministic for the same id + axis", () => {
    expect(nppIdiosyncrasy("abc", "economic")).toBe(nppIdiosyncrasy("abc", "economic"));
  });

  it("differs across axes and ids", () => {
    expect(nppIdiosyncrasy("abc", "economic")).not.toBe(nppIdiosyncrasy("abc", "social"));
    expect(nppIdiosyncrasy("abc", "economic")).not.toBe(nppIdiosyncrasy("abd", "economic"));
  });

  it("stays within [-spread, +spread]", () => {
    for (const id of ["1", "x", "6a779f5be464c15609c021e5", "zzzz", ""]) {
      const v = nppIdiosyncrasy(id, "economic");
      expect(v).toBeGreaterThanOrEqual(-NPP_STANCE_SPREAD);
      expect(v).toBeLessThanOrEqual(NPP_STANCE_SPREAD);
    }
  });
});

describe("nppStanceTarget", () => {
  const id = "6a779f5be464c15609c021e5";

  it("anchors on the party, not the lean (no mimic)", () => {
    // Alabama econ lean -0.75. Zero the offset to isolate the anchor.
    const demTarget = nppStanceTarget(-1, -0.75, id, "economic", NPP_LEAN_PULL, 0);
    const flpTarget = nppStanceTarget(0, -0.75, id, "economic", NPP_LEAN_PULL, 0);
    // Anchor sits between party and lean, never on the lean.
    expect(demTarget).toBeCloseTo(-0.9, 5); // -1 + 0.35*(0.25)
    expect(flpTarget).toBeCloseTo(-0.3, 5); // 0 + 0.35*(-0.75)
    expect(demTarget).not.toBeCloseTo(-0.75, 2);
    expect(flpTarget).not.toBeCloseTo(-0.75, 2);
  });

  it("preserves party ordering: a left party stays left of a right party", () => {
    // Same state, same id, differing only by party position.
    const left = nppStanceTarget(-1, 0.17, id, "economic");
    const right = nppStanceTarget(0, 0.17, id, "economic");
    expect(left).toBeLessThan(right);
  });

  it("pull=0 collapses to party position, pull=1 mimics the lean", () => {
    expect(nppStanceTarget(-1, 0.5, id, "economic", 0, 0)).toBeCloseTo(-1, 5);
    expect(nppStanceTarget(-1, 0.5, id, "economic", 1, 0)).toBeCloseTo(0.5, 5);
  });

  it("clamps to [-5, 5] and rounds to the 0.1 grid for any seed", () => {
    for (const seed of ["a", "b", "c", "d", "e", "npp-42", id]) {
      const hi = nppStanceTarget(5, 5, seed, "economic", 1, 5);
      const lo = nppStanceTarget(-5, -5, seed, "social", 1, 5);
      for (const v of [hi, lo]) {
        expect(v).toBeGreaterThanOrEqual(-5);
        expect(v).toBeLessThanOrEqual(5);
        expect(v).toBe(Math.round(v * 10) / 10); // on the 0.1 grid
      }
    }
  });

  it("is reproducible (heal and drift agree)", () => {
    const a = nppStanceTarget(0, 0.62, "npp-42", "social");
    const b = nppStanceTarget(0, 0.62, "npp-42", "social");
    expect(a).toBe(b);
  });
});
