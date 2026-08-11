// src/components/landing/globeEnhancements.test.ts
import { describe, it, expect } from "vitest";
import { buildArcs, buildHotspots, buildStarfield } from "./globeEnhancements";

describe("globeEnhancements", () => {
  it("buildArcs returns the five 1979 relationships with token colors", () => {
    const arcs = buildArcs();
    expect(arcs.map((a) => a.id)).toEqual(["US-RU", "US-UK", "RU-CN", "US-JP", "RU-DD"]);
    for (const a of arcs) {
      expect(a.color).toMatch(/^var\(--/);
      expect(a.from).toHaveLength(2);
      expect(a.to).toHaveLength(2);
    }
    expect(arcs.find((a) => a.id === "US-RU")!.color).toBe("var(--warning)");
  });

  it("buildHotspots returns 1979 flashpoints", () => {
    expect(buildHotspots().map((h) => h.id)).toEqual(["berlin", "kabul", "tehran"]);
  });

  it("buildStarfield is deterministic for a fixed seed", () => {
    const a = buildStarfield({ seed: 42, count: 30, width: 640, height: 368 });
    expect(a).toEqual(buildStarfield({ seed: 42, count: 30, width: 640, height: 368 }));
    expect(a).toHaveLength(30);
    for (const s of a) {
      expect(s.cx).toBeGreaterThanOrEqual(0);
      expect(s.cx).toBeLessThanOrEqual(640);
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("buildStarfield different seeds differ", () => {
    expect(buildStarfield({ seed: 1, count: 20, width: 640, height: 368 })).not.toEqual(
      buildStarfield({ seed: 2, count: 20, width: 640, height: 368 })
    );
  });
});
