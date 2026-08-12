import { describe, it, expect } from "vitest";
import { sponsoredFundSlug, validateCharter } from "./charterFund";
import {
  FUND_MIN_SEED_CAPITAL_ANCHOR,
  MAX_EXPENSE_RATIO_ANNUAL,
  MIN_EXPENSE_RATIO_ANNUAL,
} from "./constants";

const ok = {
  name: "Northern Industrial Trust",
  tickerSymbol: "NIT",
  scope: "country" as const,
  countryId: "US" as never,
  kind: "broad" as const,
  sectorType: undefined,
  expenseRatioAnnual: 0.0075,
  seedCapitalAnchor: FUND_MIN_SEED_CAPITAL_ANCHOR,
};

const financial = ["financial" as never];

describe("validateCharter", () => {
  it("accepts a well-formed charter from a finance corporation", () => {
    expect(validateCharter(ok, financial)).toBeNull();
  });

  it("refuses a sponsor with no financial sector", () => {
    expect(validateCharter(ok, ["manufacturing" as never])).toMatch(/financial sector/i);
  });

  it("accepts a diversified sponsor that includes finance", () => {
    expect(validateCharter(ok, ["manufacturing" as never, "financial" as never])).toBeNull();
  });

  it("requires the mandate to be internally consistent", () => {
    expect(validateCharter({ ...ok, countryId: undefined }, financial)).toMatch(/needs a country/i);
    expect(
      validateCharter({ ...ok, scope: "global", countryId: "US" as never }, financial)
    ).toMatch(/cannot also name a country/i);
    expect(validateCharter({ ...ok, kind: "sector" }, financial)).toMatch(/needs an industry/i);
    expect(
      validateCharter({ ...ok, sectorType: "technology" as never }, financial)
    ).toMatch(/cannot also name an industry/i);
  });

  it("holds the expense ratio inside its band at both ends", () => {
    expect(
      validateCharter({ ...ok, expenseRatioAnnual: MAX_EXPENSE_RATIO_ANNUAL + 0.001 }, financial)
    ).toMatch(/expense ratio/i);
    expect(
      validateCharter({ ...ok, expenseRatioAnnual: MIN_EXPENSE_RATIO_ANNUAL - 0.0001 }, financial)
    ).toMatch(/expense ratio/i);
    // The bounds themselves are allowed.
    expect(
      validateCharter({ ...ok, expenseRatioAnnual: MAX_EXPENSE_RATIO_ANNUAL }, financial)
    ).toBeNull();
    expect(
      validateCharter({ ...ok, expenseRatioAnnual: MIN_EXPENSE_RATIO_ANNUAL }, financial)
    ).toBeNull();
  });

  it("requires real seed capital, so a fund cannot be chartered on nothing", () => {
    expect(
      validateCharter({ ...ok, seedCapitalAnchor: FUND_MIN_SEED_CAPITAL_ANCHOR - 1 }, financial)
    ).toMatch(/seed capital/i);
  });

  it("rejects malformed names and tickers", () => {
    expect(validateCharter({ ...ok, name: "AB" }, financial)).toMatch(/name/i);
    expect(validateCharter({ ...ok, tickerSymbol: "nit" }, financial)).toMatch(/ticker/i);
    expect(validateCharter({ ...ok, tickerSymbol: "TOOLONGTICKER" }, financial)).toMatch(/ticker/i);
    expect(validateCharter({ ...ok, tickerSymbol: "N1T" }, financial)).toMatch(/ticker/i);
  });
});

describe("sponsoredFundSlug", () => {
  it("namespaces sponsored funds away from the seeded slugs", () => {
    expect(sponsoredFundSlug("NIT")).toBe("sponsored-nit");
  });
});
