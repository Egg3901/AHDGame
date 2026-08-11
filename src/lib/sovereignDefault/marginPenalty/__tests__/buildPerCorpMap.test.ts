import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildSovereignDefaultMarginByCorpId } from "../buildPerCorpMap";
import { DEFAULT_MARGIN_PENALTY_REPUDIATE, GLOBAL_CONTAGION_MULTIPLIER } from "../../constants";

describe("buildSovereignDefaultMarginByCorpId", () => {
  it("returns empty map when no recovering budgets", () => {
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [],
      corps: [{ _id: new ObjectId(), countryId: "US", type: "financial" }],
      currentTurn: 100,
      globalGdp: 1,
    });
    expect(r.size).toBe(0);
  });

  it("local layer applies to home-country financial corp", () => {
    const corpId = new ObjectId();
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: 27_000_000_000_000,
          lastDefaultTurn: 100,
          crisisChoice: "repudiate",
        },
      ],
      corps: [{ _id: corpId, countryId: "US", type: "financial" }],
      currentTurn: 100,
      globalGdp: 100_000_000_000_000,
    });
    expect(r.get(corpId.toString())).toBeCloseTo(DEFAULT_MARGIN_PENALTY_REPUDIATE * 1.5);
  });

  it("global layer applies to foreign-country corp scaled by GDP share", () => {
    const corpId = new ObjectId();
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: 40,
          lastDefaultTurn: 100,
          crisisChoice: "repudiate",
        },
      ],
      corps: [{ _id: corpId, countryId: "JP", type: "financial" }],
      currentTurn: 100,
      globalGdp: 100,
    });
    const expected = DEFAULT_MARGIN_PENALTY_REPUDIATE * 1.5 * 0.4 * GLOBAL_CONTAGION_MULTIPLIER;
    expect(r.get(corpId.toString())).toBeCloseTo(expected, 6);
  });

  it("monetize crisisChoice contributes 0 (skipped)", () => {
    const corpId = new ObjectId();
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: 10,
          lastDefaultTurn: 100,
          crisisChoice: "monetize",
        },
      ],
      corps: [{ _id: corpId, countryId: "US", type: "financial" }],
      currentTurn: 100,
      globalGdp: 100,
    });
    expect(r.get(corpId.toString())).toBeUndefined();
  });

  it("sums across multiple recovering countries", () => {
    const corpId = new ObjectId();
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: 40,
          lastDefaultTurn: 100,
          crisisChoice: "repudiate",
        },
        {
          _id: "JP",
          countryId: "JP",
          gdp: 6,
          lastDefaultTurn: 100,
          crisisChoice: "restructure",
        },
      ],
      corps: [{ _id: corpId, countryId: "US", type: "financial" }],
      currentTurn: 100,
      globalGdp: 100,
    });
    const local = -0.18 * 1.5;
    const global = -0.09 * 1.5 * 0.06 * 0.5;
    expect(r.get(corpId.toString())).toBeCloseTo(local + global, 6);
  });

  it("skips budgets where lastDefaultTurn is null", () => {
    const corpId = new ObjectId();
    const r = buildSovereignDefaultMarginByCorpId({
      recoveringBudgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: 10,
          lastDefaultTurn: null,
          crisisChoice: "repudiate",
        },
      ],
      corps: [{ _id: corpId, countryId: "US", type: "financial" }],
      currentTurn: 100,
      globalGdp: 100,
    });
    expect(r.get(corpId.toString())).toBeUndefined();
  });
});
