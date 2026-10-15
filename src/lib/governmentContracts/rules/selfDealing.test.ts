import { describe, it, expect } from "vitest";
import { tenderSelfDealingPenalty } from "./selfDealing";
import type { TenderTerms } from "../types";

describe("tender conflict penalties", () => {
  it.each([
    [0.01, 1.6],
    [0.3, 4.1],
    [0.75, 8],
  ])("scales extraction share %s independently of the signing fee", (share, expected) => {
    const terms = { type: "extraction", share } as TenderTerms;
    expect(tenderSelfDealingPenalty(terms, 0, 0)).toBe(expected);
    expect(tenderSelfDealingPenalty(terms, 1e9, 0)).toBe(expected);
  });
  it("preserves defence contract-value scaling", () => {
    expect(tenderSelfDealingPenalty({ type: "defence", lots: 3 } as TenderTerms, 100, 1000)).toBe(
      3.5
    );
  });
});
