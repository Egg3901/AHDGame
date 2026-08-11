import { describe, expect, it } from "vitest";
import { filterFundsForExchange } from "./fundExchangeFilter";
import type { IndexFund } from "@/lib/db/types";
import { ObjectId } from "mongodb";

function fund(partial: Partial<IndexFund>): IndexFund {
  return {
    _id: new ObjectId(),
    slug: "test",
    name: "Test",
    tickerSymbol: "TST",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1000,
    reserveUnits: 0,
    cashAnchor: 0,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("filterFundsForExchange", () => {
  it("returns global funds for global exchange", () => {
    const funds = [
      fund({ scope: "global", countryId: undefined, kind: "sector" }),
      fund({ scope: "country", countryId: "US" }),
    ];
    const filtered = filterFundsForExchange(funds, "global");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].scope).toBe("global");
  });

  it("returns country funds for country exchange", () => {
    const funds = [
      fund({ scope: "global", countryId: undefined }),
      fund({ scope: "country", countryId: "US" }),
      fund({ scope: "country", countryId: "JP" }),
    ];
    const filtered = filterFundsForExchange(funds, "US");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].countryId).toBe("US");
  });
});
