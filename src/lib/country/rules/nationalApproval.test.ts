import { describe, expect, it } from "vitest";
import { nationalApprovalFromRegions } from "./nationalApproval";
const context = { countryId: "UK", preset: "1991-default", year: 1991 };
const expectations = [{ id: "expectations", label: "Public expectations", effect: -5 }];
describe("national approval scope", () => {
  it("counts regional conditions by population rather than thresholding an average", () => {
    const result = nationalApprovalFromRegions(
      [
        { base: 50, population: 900, metrics: { economic: { gdpGrowth: 1 } } },
        { base: 50, population: 100, metrics: { economic: { gdpGrowth: -1 } } },
      ],
      context,
      expectations
    );
    expect(result.approval).toBe(44.9);
    expect(result.regionalModifiers[0].effect).toBe(-0.1);
    expect(result.base).toBe(50);
  });
  it("caps national positives once, after regional conditions", () => {
    const result = nationalApprovalFromRegions(
      [{ base: 50, population: 100, metrics: {} }],
      context,
      [
        ...expectations,
        { id: "speech", label: "Speech", effect: 10 },
        { id: "endorsement", label: "Endorsement", effect: 10 },
      ]
    );
    expect(result.approval).toBe(53);
  });
});
