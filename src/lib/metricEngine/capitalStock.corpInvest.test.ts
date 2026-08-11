import { describe, expect, it } from "vitest";
import { advanceCapitalStock } from "./capitalStock";

describe("advanceCapitalStock — corp investment term (O1c)", () => {
  const K = 3_000_000; // millions
  const Y = 1_000_000; // annual millions
  const PRIME = 3;
  const TPY = 48;

  it("omitting corp investment is byte-identical to passing 0", () => {
    const a = advanceCapitalStock(K, Y, PRIME, TPY);
    const b = advanceCapitalStock(K, Y, PRIME, TPY, 0);
    expect(b.capital).toBe(a.capital);
    expect(b.investment).toBe(a.investment);
    expect(b.annualizedGrowth).toBe(a.annualizedGrowth);
  });

  it("corp investment adds to gross investment and raises next-turn capital", () => {
    const base = advanceCapitalStock(K, Y, PRIME, TPY);
    const withCorp = advanceCapitalStock(K, Y, PRIME, TPY, 100);
    expect(withCorp.investment).toBeCloseTo(base.investment + 100, 6);
    expect(withCorp.capital).toBeCloseTo(base.capital + 100, 6);
    expect(withCorp.annualizedGrowth).toBeGreaterThan(base.annualizedGrowth);
  });

  it("non-finite / negative corp investment is treated as 0 (safe)", () => {
    const base = advanceCapitalStock(K, Y, PRIME, TPY);
    expect(advanceCapitalStock(K, Y, PRIME, TPY, Number.NaN).capital).toBeCloseTo(base.capital, 6);
    expect(advanceCapitalStock(K, Y, PRIME, TPY, -50).capital).toBeCloseTo(base.capital, 6);
  });
});
