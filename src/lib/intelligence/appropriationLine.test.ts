import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { intelligenceAccrualPerTurn, resolveIntelligenceLineFrom } from "./appropriationLine";

type Source = Parameters<typeof resolveIntelligenceLineFrom>[0];

const withCategories = (byCategory: Record<string, number>) =>
  ({ spending: { byCategory } }) as unknown as Source;

describe("resolveIntelligenceLineFrom", () => {
  it("reads the enacted line", () => {
    expect(resolveIntelligenceLineFrom(withCategories({ intelligence: 5_000 }))).toBe(5_000);
  });

  it("is zero when no law has been enacted, and never falls back to GDP", () => {
    // The whole seed-at-zero property rests on this. A GDP fallback of the kind the
    // defence line carries would fund every country in the world on deploy.
    expect(resolveIntelligenceLineFrom(withCategories({ defense: 9_000 }))).toBe(0);
  });

  it("is zero for a missing budget", () => {
    expect(resolveIntelligenceLineFrom(null)).toBe(0);
    expect(resolveIntelligenceLineFrom({} as unknown as Source)).toBe(0);
  });

  it("is zero for a negative or non-finite line rather than propagating it", () => {
    expect(resolveIntelligenceLineFrom(withCategories({ intelligence: -1 }))).toBe(0);
    expect(resolveIntelligenceLineFrom(withCategories({ intelligence: Number.NaN }))).toBe(0);
    expect(resolveIntelligenceLineFrom(withCategories({ intelligence: Infinity }))).toBe(0);
  });
});

describe("intelligenceAccrualPerTurn", () => {
  it("spreads the annual line over the game year", () => {
    expect(intelligenceAccrualPerTurn(TURNS_PER_YEAR * 100)).toBe(100);
  });

  it("is zero for a zero, negative or non-finite line", () => {
    expect(intelligenceAccrualPerTurn(0)).toBe(0);
    expect(intelligenceAccrualPerTurn(-5)).toBe(0);
    expect(intelligenceAccrualPerTurn(Number.NaN)).toBe(0);
  });
});
