import { describe, expect, it } from "vitest";
import { ROULETTE_BETS, scoreRoulette, spinRoulette } from "./roulette";

describe("roulette", () => {
  it("returns 36/37 on every bet type", () => {
    for (const bet of ROULETTE_BETS) {
      let total = 0;
      for (let pocket = 0; pocket <= 36; pocket++)
        total += scoreRoulette(bet, pocket, 17).multiplier;
      expect(total / 37).toBeCloseTo(36 / 37, 10);
    }
  });

  it("loses outside bets on zero and pays a straight zero", () => {
    expect(scoreRoulette("red", 0).won).toBe(false);
    expect(scoreRoulette("even", 0).won).toBe(false);
    expect(scoreRoulette("straight", 0, 0)).toEqual({ won: true, multiplier: 36 });
  });

  it("maps dozens and columns", () => {
    expect(scoreRoulette("dozen3", 25).won).toBe(true);
    expect(scoreRoulette("column1", 34).won).toBe(true);
    expect(scoreRoulette("column3", 36).won).toBe(true);
  });

  it("draws every pocket", () => {
    expect(spinRoulette(() => 0, "red").pocket).toBe(0);
    expect(spinRoulette(() => 0.9999, "red")).toMatchObject({
      pocket: 36,
      color: "red",
      won: true,
    });
  });
});
