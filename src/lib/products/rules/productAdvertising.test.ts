import { describe, expect, it } from "vitest";
import {
  productAdvertisingDenominationWitness,
  quoteFundedProductAdvertising,
} from "./productAdvertising";

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
});
