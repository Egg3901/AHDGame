import { describe, it, expect } from "vitest";
import { computeRequiredIssuance } from "../requiredIssuance";

describe("computeRequiredIssuance", () => {
  it("returns the sum of rollover and deficit components", async () => {
    const fakeDb = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            { totalIssued: 1_000_000_000, maturityTurn: 105, defaulted: false, matured: false },
            { totalIssued: 500_000_000, maturityTurn: 110, defaulted: false, matured: false },
          ],
        }),
        findOne: async () => ({ surplus: -2_000_000_000 }), // 2B annual deficit
      }),
    };
    const result = await computeRequiredIssuance(fakeDb as never, "US", 100);
    expect(result).toBeGreaterThan(0);
    // rollover = 1.5B (both bonds within 12-turn window)
    expect(result).toBeGreaterThanOrEqual(1_500_000_000);
  });

  it("returns zero when surplus and no maturing bonds", async () => {
    const fakeDb = {
      collection: () => ({
        find: () => ({
          toArray: async () => [],
        }),
        findOne: async () => ({ surplus: 5_000_000_000 }),
      }),
    };
    const result = await computeRequiredIssuance(fakeDb as never, "US", 100);
    expect(result).toBe(0);
  });

  it("uses rollover only when budget is in surplus but bonds are maturing", async () => {
    const fakeDb = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            { totalIssued: 800_000_000, maturityTurn: 105, defaulted: false, matured: false },
          ],
        }),
        findOne: async () => ({ surplus: 1_000_000_000 }),
      }),
    };
    const result = await computeRequiredIssuance(fakeDb as never, "US", 100);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1_000_000_000);
  });

  it("returns 0 when federalBudget is missing for the country", async () => {
    const fakeDb = {
      collection: () => ({
        find: () => ({ toArray: async () => [] }),
        findOne: async () => null,
      }),
    };
    const result = await computeRequiredIssuance(fakeDb as never, "US", 100);
    expect(result).toBe(0);
  });
});
