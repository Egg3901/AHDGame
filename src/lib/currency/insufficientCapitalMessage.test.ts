import { describe, it, expect } from "vitest";
import { insufficientCapitalMessage } from "./insufficientCapitalMessage";

describe("insufficientCapitalMessage", () => {
  // Regression: corp spend gates hardcoded "$", so a JP corp (¥) saw dollar
  // signs on amounts that are actually yen. Amounts are passed already in the
  // corp's local currency; the symbol must match that currency.
  it("renders the corp's local currency symbol (JPY → ¥), not a hardcoded $", () => {
    expect(insufficientCapitalMessage("Expanding", 27_177_426, 19_000_000, "JPY")).toBe(
      "Insufficient capital. Expanding costs ¥27,177,426. You have ¥19,000,000."
    );
  });

  it("uses the verb noun passed in (Attack/Split/Expanding)", () => {
    expect(insufficientCapitalMessage("Attack", 1_000_000, 500_000, "GBP")).toBe(
      "Insufficient capital. Attack costs £1,000,000. You have £500,000."
    );
  });

  it("renders IR£ for IEP corps (Ireland)", () => {
    expect(insufficientCapitalMessage("Expanding", 2_500_000, 1_000_000, "IEP")).toBe(
      "Insufficient capital. Expanding costs IR£2,500,000. You have IR£1,000,000."
    );
  });

  it("falls back to $ for an unknown/absent currency code", () => {
    expect(insufficientCapitalMessage("Split", 1000, 500, undefined)).toBe(
      "Insufficient capital. Split costs $1,000. You have $500."
    );
  });
});
