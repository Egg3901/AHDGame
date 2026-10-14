import { describe, expect, it } from "vitest";
import {
  boundAdvertisingSellers,
  MAX_DIRECT_ADVERTISING_SELLERS,
  productAdvertisingDenominationWitness,
  quoteFundedProductAdvertising,
  type ProductAdvertisingSellerQuote,
} from "./productAdvertising";

function seller(index: number, deliveredValueAnchor: number): ProductAdvertisingSellerQuote {
  return {
    corporationId: `seller-${String(index).padStart(3, "0")}`,
    deliveredValueAnchor,
    currencyCode: "USD",
    localPerAnchor: 1,
    ...productAdvertisingDenominationWitness({ liquidCurrencyCode: "USD", countryId: "US" }),
  };
}

const buyer = {
  corporationId: "buyer",
  currencyCode: "USD" as const,
  localPerAnchor: 1,
  ...productAdvertisingDenominationWitness({ liquidCurrencyCode: "USD", countryId: "US" }),
};

describe("funded product advertising quote rules", () => {
  it("balances native legs in anchor value and freezes each raw denomination", () => {
    const buyerDenomination = productAdvertisingDenominationWitness({
      liquidCurrencyCode: "USD",
      countryId: "US",
    });
    const sellerDenomination = productAdvertisingDenominationWitness({
      countryId: "GB",
    });
    const quote = quoteFundedProductAdvertising({
      amountAnchor: 100,
      buyer: {
        corporationId: "buyer",
        currencyCode: "USD",
        localPerAnchor: 2,
        ...buyerDenomination,
      },
      sellers: [
        {
          corporationId: "seller-us",
          deliveredValueAnchor: 1,
          currencyCode: "USD",
          localPerAnchor: 2,
          ...buyerDenomination,
        },
        {
          corporationId: "seller-gb",
          deliveredValueAnchor: 3,
          currencyCode: "GBP",
          localPerAnchor: 4,
          ...sellerDenomination,
        },
      ],
    });

    expect(quote?.buyerAmountLocal).toBe(200);
    expect(quote?.sellerAllocations.map((allocation) => allocation.amountLocal)).toEqual([50, 300]);
    expect(
      quote?.sellerAllocations.reduce(
        (sum, allocation) => sum + allocation.amountLocal / allocation.localPerAnchor,
        0
      )
    ).toBe(100);
    expect(quote?.buyerDenomination).toEqual(buyerDenomination);
    expect(quote?.sellerAllocations[1]?.denomination).toEqual(sellerDenomination);
  });

  it("distinguishes an absent native currency from an explicit null and validates quotes", () => {
    expect(productAdvertisingDenominationWitness({ countryId: "US" })).toMatchObject({
      liquidCurrencyCodePresent: false,
      liquidCurrencyCode: null,
      countryIdPresent: true,
      countryId: "US",
    });
    expect(
      productAdvertisingDenominationWitness({ liquidCurrencyCode: null, countryId: null })
    ).toMatchObject({
      liquidCurrencyCodePresent: true,
      liquidCurrencyCode: null,
      countryIdPresent: true,
      countryId: null,
    });
    expect(
      quoteFundedProductAdvertising({
        amountAnchor: 100,
        buyer: {
          corporationId: "buyer",
          currencyCode: "USD",
          localPerAnchor: 0,
          ...productAdvertisingDenominationWitness({}),
        },
        sellers: [],
      })
    ).toBeNull();
  });

  it("pays the largest sellers directly and one value-weighted tail seller for the rest", () => {
    // 400 sellers with a long tail: big sellers first, then many small ones.
    const sellers = Array.from({ length: 400 }, (_, i) =>
      seller(i, i < 10 ? 100 - i : 1 / (i + 1))
    );
    const quote = quoteFundedProductAdvertising({
      amountAnchor: 1000,
      buyer,
      sellers,
      seed: "7:buyer:project",
    });
    expect(quote).not.toBeNull();
    const allocations = quote!.sellerAllocations;
    expect(allocations).toHaveLength(MAX_DIRECT_ADVERTISING_SELLERS + 1);
    const total = sellers.reduce((sum, s) => sum + s.deliveredValueAnchor, 0);
    // Direct sellers keep their exact proportional share.
    expect(allocations[0]!.corporationId).toBe("seller-000");
    expect(allocations[0]!.amountLocal).toBeCloseTo((1000 * 100) / total, 9);
    // The order still balances to the buyer's amount.
    expect(allocations.reduce((sum, a) => sum + a.amountLocal, 0)).toBeCloseTo(1000, 9);
    // Same order identity, same draw.
    expect(
      quoteFundedProductAdvertising({ amountAnchor: 1000, buyer, sellers, seed: "7:buyer:project" })
    ).toEqual(quote);
  });

  it("keeps every tail seller's expected revenue proportional to its delivered value", () => {
    const sellers = Array.from({ length: 60 }, (_, i) => seller(i, i < 30 ? 50 : (i % 3) + 1));
    const tailIds = sellers.slice(MAX_DIRECT_ADVERTISING_SELLERS).map((s) => s.corporationId);
    const tailValue = sellers
      .slice(MAX_DIRECT_ADVERTISING_SELLERS)
      .reduce((sum, s) => sum + s.deliveredValueAnchor, 0);
    const wins = new Map<string, number>();
    const draws = 20_000;
    for (let n = 0; n < draws; n++) {
      const bounded = boundAdvertisingSellers(sellers, `order-${n}`);
      expect(bounded).toHaveLength(MAX_DIRECT_ADVERTISING_SELLERS + 1);
      const drawn = bounded.find((s) => tailIds.includes(s.corporationId))!;
      expect(drawn.deliveredValueAnchor).toBeCloseTo(tailValue, 9);
      wins.set(drawn.corporationId, (wins.get(drawn.corporationId) ?? 0) + 1);
    }
    for (const s of sellers.slice(MAX_DIRECT_ADVERTISING_SELLERS)) {
      const expected = s.deliveredValueAnchor / tailValue;
      expect(Math.abs((wins.get(s.corporationId) ?? 0) / draws - expected)).toBeLessThan(0.015);
    }
  });

  it("leaves small seller lists untouched", () => {
    const sellers = Array.from({ length: MAX_DIRECT_ADVERTISING_SELLERS + 1 }, (_, i) =>
      seller(i, i + 1)
    );
    expect(boundAdvertisingSellers(sellers, "seed")).toEqual(sellers);
  });
});
