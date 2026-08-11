import { describe, it, expect } from "vitest";
import { classifyRace, countCompetitiveRaces } from "./hotRaces";

describe("classifyRace", () => {
  it("classifies a tight margin as hot", () => {
    expect(classifyRace({ topTwoMargin: 3, hasIncumbent: true, phase: "general" })).toBe("hot");
  });

  it("classifies a zero-margin race as hot", () => {
    expect(classifyRace({ topTwoMargin: 0, hasIncumbent: true, phase: "general" })).toBe("hot");
  });

  it("classifies an open seat as hot regardless of margin", () => {
    expect(classifyRace({ topTwoMargin: 22, hasIncumbent: false, phase: "general" })).toBe("hot");
  });

  it("classifies a wide-margin incumbent race as safe", () => {
    expect(classifyRace({ topTwoMargin: 22, hasIncumbent: true, phase: "general" })).toBe("safe");
  });

  it("classifies a mid-margin incumbent race as lean", () => {
    expect(classifyRace({ topTwoMargin: 12, hasIncumbent: true, phase: "general" })).toBe("lean");
  });

  it("uses the same thresholds for primary phase", () => {
    expect(classifyRace({ topTwoMargin: 5, hasIncumbent: true, phase: "primary" })).toBe("hot");
    expect(classifyRace({ topTwoMargin: 12, hasIncumbent: true, phase: "primary" })).toBe("lean");
    expect(classifyRace({ topTwoMargin: 20, hasIncumbent: true, phase: "primary" })).toBe("safe");
  });

  it("treats NaN margin as lean (data integrity fallback)", () => {
    expect(classifyRace({ topTwoMargin: NaN, hasIncumbent: true, phase: "general" })).toBe("lean");
  });

  it("treats negative margin as its absolute value", () => {
    // Margin is by definition non-negative (top1 - top2 ≥ 0). Negative means
    // a producer bug — clamp via abs rather than misclassifying as hot.
    expect(classifyRace({ topTwoMargin: -5, hasIncumbent: true, phase: "general" })).toBe("hot");
    expect(classifyRace({ topTwoMargin: -20, hasIncumbent: true, phase: "general" })).toBe("safe");
  });
});

describe("countCompetitiveRaces", () => {
  it("returns hot + lean count, ignoring safe and finalized races", () => {
    expect(
      countCompetitiveRaces([
        { topTwoMargin: 3, hasIncumbent: true, phase: "general" }, // hot
        { topTwoMargin: 12, hasIncumbent: true, phase: "general" }, // lean
        { topTwoMargin: 22, hasIncumbent: true, phase: "general" }, // safe (excluded)
        { topTwoMargin: 1, hasIncumbent: true, phase: "completed" }, // wrong phase (excluded)
      ])
    ).toBe(2);
  });

  it("counts primary-phase races", () => {
    expect(
      countCompetitiveRaces([
        { topTwoMargin: 3, hasIncumbent: true, phase: "primary" }, // hot
        { topTwoMargin: 12, hasIncumbent: false, phase: "primary" }, // hot (open seat)
      ])
    ).toBe(2);
  });

  it("excludes upcoming races (no margin to read yet)", () => {
    expect(
      countCompetitiveRaces([{ topTwoMargin: 3, hasIncumbent: true, phase: "upcoming" }])
    ).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(countCompetitiveRaces([])).toBe(0);
  });
});
