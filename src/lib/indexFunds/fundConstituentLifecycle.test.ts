import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { findRemovedConstituentHoldings } from "./fundConstituentLifecycle";
import type { IndexFund } from "@/lib/db/types";

describe("findRemovedConstituentHoldings", () => {
  const keptId = new ObjectId();
  const removedId = new ObjectId();

  const fund: IndexFund = {
    _id: new ObjectId(),
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1000,
    reserveUnits: 0,
    cashAnchor: 0,
    targetConstituents: [{ corporationId: keptId, targetWeight: 1, marketCapAnchor: 1 }],
    holdings: [
      { corporationId: keptId, shares: 100 },
      { corporationId: removedId, shares: 50 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns holdings no longer in the target basket", () => {
    const removed = findRemovedConstituentHoldings(fund, [
      {
        _id: keptId,
        countryId: "US",
        type: "technology",
        sharePrice: 10,
        totalShares: 1_000_000,
        liquidCurrencyCode: "USD",
      },
    ]);
    expect(removed).toHaveLength(1);
    expect(removed[0].corporationId.toString()).toBe(removedId.toString());
  });
});
