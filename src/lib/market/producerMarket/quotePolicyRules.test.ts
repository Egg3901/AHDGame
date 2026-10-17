import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { uniformProducerMarkup, uniformProducerQuotes } from "./quotePolicyRules";

describe("bulk product pricing", () => {
  it("replaces all product overrides with automatic pricing", () => {
    expect(uniformProducerQuotes(null)).toEqual({});
    expect(uniformProducerMarkup({})).toBeNull();
  });

  it("applies a cost markup to every commodity including financial services", () => {
    const quotes = uniformProducerQuotes(0.1);
    expect(Object.keys(quotes).sort()).toEqual([...COMMODITY_TYPES].sort());
    expect(quotes.financial_services).toEqual({ kind: "costPlus", markup: 0.1 });
    expect(uniformProducerMarkup(quotes)).toBe(0.1);
  });

  it("labels product-specific choices without pretending a fixed price is a markup", () => {
    expect(uniformProducerMarkup({ financial_services: { kind: "manual", unitPrice: 4 } })).toBe(
      "mixed"
    );
    expect(uniformProducerMarkup({ energy: { kind: "costPlus", markup: 0 } })).toBe("mixed");
  });
});
