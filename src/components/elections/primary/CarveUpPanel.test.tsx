import { describe, expect, it } from "vitest";
import { buildConicGradient, type CarveUpSlice } from "./CarveUpPanel";

describe("buildConicGradient", () => {
  it("emits one stop per non-zero slice with running cursor", () => {
    const slices: CarveUpSlice[] = [
      { candidateId: "a", candidateName: "A", color: "#f00", pct: 60 },
      { candidateId: "b", candidateName: "B", color: "#0f0", pct: 40 },
    ];
    const grad = buildConicGradient(slices);
    expect(grad).toBe("#f00 0% 60%, #0f0 60% 100%");
  });

  it("skips zero-pct slices (no gradient noise)", () => {
    const slices: CarveUpSlice[] = [
      { candidateId: "a", candidateName: "A", color: "#f00", pct: 50 },
      { candidateId: "b", candidateName: "B", color: "#0f0", pct: 0 },
      { candidateId: "c", candidateName: "C", color: "#00f", pct: 50 },
    ];
    const grad = buildConicGradient(slices);
    expect(grad).toBe("#f00 0% 50%, #00f 50% 100%");
  });

  it("falls back to a neutral stop when every slice is zero", () => {
    const slices: CarveUpSlice[] = [
      { candidateId: "a", candidateName: "A", color: "#f00", pct: 0 },
    ];
    expect(buildConicGradient(slices)).toBe("var(--card-border) 0% 100%");
  });

  it("rounding-tolerant: cursor advances by exact pct (no padding to 100)", () => {
    const slices: CarveUpSlice[] = [
      { candidateId: "a", candidateName: "A", color: "#f00", pct: 33.3 },
      { candidateId: "b", candidateName: "B", color: "#0f0", pct: 33.3 },
      { candidateId: "c", candidateName: "C", color: "#00f", pct: 33.3 },
    ];
    const grad = buildConicGradient(slices);
    // Float drift gives the third slice a noisy 99.89999... end stop;
    // browsers tolerate sub-100 ends. We don't pad to 100 here — that's a
    // styling concern. Verify the third stop starts at the running cursor.
    expect(grad).toContain("#00f 66.6%");
  });
});

describe("CarveUpSlice shape", () => {
  it("requires candidateId, candidateName, color, pct; archetype optional", () => {
    const minimal: CarveUpSlice = {
      candidateId: "a",
      candidateName: "A",
      color: "#f00",
      pct: 25,
    };
    const withArchetype: CarveUpSlice = { ...minimal, archetype: "Populist" };
    expect(minimal.archetype).toBeUndefined();
    expect(withArchetype.archetype).toBe("Populist");
  });
});
