import { describe, it, expect } from "vitest";
import { computeDerivedComposition, editorConfigFromSeed, editorPositionsTable } from "./derive";
import { deriveGroupLeanFromLayer1, type Layer1Config } from "@/lib/seeds/stateDemographics";

const CFG: Layer1Config = {
  race: { white: 60, black: 20, hispanic: 12, asian: 5, other: 3 },
  education: { no_college: 55, college: 30, graduate: 15 },
  wealth: { low: 30, middle: 50, high: 20 },
  age: { young: 25, mid: 28, mature: 25, senior: 22 },
  ideology: {
    evangelicals: 15,
    environmentalists: 15,
    libertarians: 10,
    progressives: 18,
    patriots: 18,
    gunowners: 14,
  },
};

describe("editor derive parity", () => {
  it("archetype leans match deriveGroupLeanFromLayer1 with positionsOverride", () => {
    const editor = editorConfigFromSeed("XX", "US", "2019", CFG);
    const derived = computeDerivedComposition(editor);
    const positionsOverride = editorPositionsTable(editor);
    for (const a of derived.archetypes) {
      const engine = deriveGroupLeanFromLayer1(a.id, CFG, "2019", positionsOverride);
      expect(a.economicLean).toBeCloseTo(engine.economicLean, 5);
      expect(a.socialLean).toBeCloseTo(engine.socialLean, 5);
    }
  });

  it("voting-pool shares sum to ~100", () => {
    const editor = editorConfigFromSeed("XX", "US", "2019", CFG);
    const derived = computeDerivedComposition(editor);
    const sum = derived.archetypes.reduce((s, a) => s + a.votingPoolShare, 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("editing a Layer-1 position changes the derived archetype lean", () => {
    const editor = editorConfigFromSeed("XX", "US", "2019", CFG);
    const before = computeDerivedComposition(editor).archetypes.find(
      (a) => a.id === "evangelicals"
    )!;
    editor.layer1.ideology.evangelicals.economicLean = -5;
    const after = computeDerivedComposition(editor).archetypes.find(
      (a) => a.id === "evangelicals"
    )!;
    expect(after.economicLean).toBeLessThan(before.economicLean);
  });
});
