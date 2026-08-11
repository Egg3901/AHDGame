import { describe, it, expect } from "vitest";
import { expandSectorSchema, foundCorporationSchema } from "../corporations";

describe("foundCorporationSchema — tickerSymbol", () => {
  const baseValid = {
    name: "Acme Industries",
    type: "manufacturing",
  };

  it("accepts a 4-letter ticker", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "ACME" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tickerSymbol).toBe("ACME");
  });

  it("normalizes lowercase to uppercase", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "acme" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tickerSymbol).toBe("ACME");
  });

  it("accepts a 1-letter ticker", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "A" });
    expect(result.success).toBe(true);
  });

  it("accepts a 5-letter ticker", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "ABCDE" });
    expect(result.success).toBe(true);
  });

  it("rejects empty string", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "" });
    expect(result.success).toBe(false);
  });

  it("rejects 6-letter ticker", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "ABCDEF" });
    expect(result.success).toBe(false);
  });

  it("rejects digits", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "AAPL1" });
    expect(result.success).toBe(false);
  });

  it("rejects pure digits", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "12345" });
    expect(result.success).toBe(false);
  });

  it("rejects symbols", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "A!" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace in the middle", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "A B" });
    expect(result.success).toBe(false);
  });

  it("rejects missing field", () => {
    const result = foundCorporationSchema.safeParse(baseValid);
    expect(result.success).toBe(false);
  });

  it("rejects moderated profanity (FUCK)", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, tickerSymbol: "FUCK" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/prohibited/i);
    }
  });
});

describe("foundCorporationSchema — startingCapital is era-agnostic", () => {
  const baseValid = {
    name: "Acme Industries",
    tickerSymbol: "ACME",
    type: "manufacturing",
  };

  // Regression: the schema used to hardcode the MODERN minimum (1,000,000).
  // A 1953 world's era-scaled minimum is ~14,333, so every legal founding in
  // that era was rejected here before the route could apply its era bounds.
  it("accepts an era-scaled 1953 starting capital", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, startingCapital: 14_333 });
    expect(result.success).toBe(true);
  });

  it("still accepts a modern starting capital", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, startingCapital: 1_000_000 });
    expect(result.success).toBe(true);
  });

  it("rejects zero and negative amounts", () => {
    expect(foundCorporationSchema.safeParse({ ...baseValid, startingCapital: 0 }).success).toBe(
      false
    );
    expect(foundCorporationSchema.safeParse({ ...baseValid, startingCapital: -5 }).success).toBe(
      false
    );
  });

  it("rejects a fractional amount", () => {
    const result = foundCorporationSchema.safeParse({ ...baseValid, startingCapital: 14_333.5 });
    expect(result.success).toBe(false);
  });

  it("is optional (route falls back to the era baseline)", () => {
    const result = foundCorporationSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });
});

describe("expandSectorSchema — non-US state IDs (ticket-1022)", () => {
  // Regression: schema used to gate on US-only HOUSE_SEATS keys (`STATE_IDS`),
  // so UK Yorkshire (`YHU`) and every other non-US region failed with
  // `stateId: Invalid state ID` before the route could look the state up.
  it("accepts UK Yorkshire & the Humber", () => {
    const result = expandSectorSchema.safeParse({ stateId: "YHU" });
    expect(result.success).toBe(true);
  });

  it("accepts other non-US region codes", () => {
    for (const stateId of ["LON", "NW", "KAN", "BY_BEL", "FR_NOR"]) {
      expect(expandSectorSchema.safeParse({ stateId }).success).toBe(true);
    }
  });

  it("still accepts US state codes", () => {
    expect(expandSectorSchema.safeParse({ stateId: "CA" }).success).toBe(true);
  });

  it("rejects an empty stateId", () => {
    const result = expandSectorSchema.safeParse({ stateId: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid state ID");
    }
  });

  it("rejects an oversized stateId", () => {
    expect(expandSectorSchema.safeParse({ stateId: "THIS_IS_TOO_LONG" }).success).toBe(false);
  });
});
