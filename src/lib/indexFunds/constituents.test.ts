import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  buildIndexFundTargetConstituents,
  convertLocalMarketCapToFundAnchor,
  isEligibleIndexFundConstituent,
  type IndexFundCandidate,
} from "./constituents";

function corp(overrides: Partial<IndexFundCandidate> = {}): IndexFundCandidate {
  return {
    _id: new ObjectId(),
    countryId: "US" as CountryId,
    type: "technology" as CorporationType,
    secondaryType: null,
    sharePrice: 10,
    totalShares: 100,
    liquidCurrencyCode: "USD" as CurrencyCode,
    ...overrides,
  };
}

const rates: Partial<Record<CurrencyCode, number>> = {
  USD: 1,
  EUR: 0.8,
  JPY: 100,
};

describe("convertLocalMarketCapToFundAnchor", () => {
  it("converts from a corporation currency into the fund anchor currency", () => {
    expect(
      convertLocalMarketCapToFundAnchor({
        localMarketCap: 100_000,
        localCurrencyCode: "JPY",
        fundAnchorCurrencyCode: "USD",
        exchangeRates: rates,
      })
    ).toBe(1000);

    expect(
      convertLocalMarketCapToFundAnchor({
        localMarketCap: 1000,
        localCurrencyCode: "USD",
        fundAnchorCurrencyCode: "EUR",
        exchangeRates: rates,
      })
    ).toBe(800);
  });

  it("rejects missing rates and invalid market caps", () => {
    expect(
      convertLocalMarketCapToFundAnchor({
        localMarketCap: 1000,
        localCurrencyCode: "BRL",
        fundAnchorCurrencyCode: "USD",
        exchangeRates: rates,
      })
    ).toBeNull();
    expect(
      convertLocalMarketCapToFundAnchor({
        localMarketCap: 0,
        localCurrencyCode: "USD",
        fundAnchorCurrencyCode: "USD",
        exchangeRates: rates,
      })
    ).toBeNull();
  });
});

describe("isEligibleIndexFundConstituent", () => {
  it("excludes private, hidden, national, and invalid-price corporations", () => {
    const definition = { scope: "country", kind: "broad", countryId: "US" } as const;

    expect(isEligibleIndexFundConstituent(corp(), definition)).toBe(true);
    expect(isEligibleIndexFundConstituent(corp({ isPrivate: true }), definition)).toBe(false);
    expect(isEligibleIndexFundConstituent(corp({ hiddenFromExchange: true }), definition)).toBe(
      false
    );
    expect(
      isEligibleIndexFundConstituent(corp({ countryOwnerId: "US" as CountryId }), definition)
    ).toBe(false);
    expect(isEligibleIndexFundConstituent(corp({ sharePrice: 0 }), definition)).toBe(false);
  });

  it("applies country and sector scope filters", () => {
    expect(
      isEligibleIndexFundConstituent(corp({ countryId: "JP" as CountryId }), {
        scope: "country",
        kind: "broad",
        countryId: "US",
      })
    ).toBe(false);

    expect(
      isEligibleIndexFundConstituent(corp({ secondaryType: "energy" as CorporationType }), {
        scope: "global",
        kind: "sector",
        sectorType: "energy" as CorporationType,
      })
    ).toBe(true);
  });
});

describe("buildIndexFundTargetConstituents", () => {
  it("weights constituents by converted market cap", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const result = buildIndexFundTargetConstituents({
      corporations: [
        corp({ _id: a, sharePrice: 10, totalShares: 100, liquidCurrencyCode: "USD" }),
        corp({ _id: b, sharePrice: 20, totalShares: 100, liquidCurrencyCode: "USD" }),
      ],
      definition: { scope: "country", kind: "broad", countryId: "US", anchorCurrencyCode: "USD" },
      exchangeRates: rates,
    });

    expect(result.map((row) => row.corporationId)).toEqual([b, a]);
    expect(result[0]).toMatchObject({ marketCapAnchor: 2000, targetWeight: 2 / 3, rank: 1 });
    expect(result[1]).toMatchObject({ marketCapAnchor: 1000, targetWeight: 1 / 3, rank: 2 });
  });

  it("defaults global funds to top 50 and normalizes weights over selected names", () => {
    const corporations = Array.from({ length: 60 }, (_, index) =>
      corp({ sharePrice: index + 1, totalShares: 100, liquidCurrencyCode: "USD" })
    );

    const result = buildIndexFundTargetConstituents({
      corporations,
      definition: { scope: "global", kind: "broad", anchorCurrencyCode: "USD" },
      exchangeRates: rates,
    });

    expect(result).toHaveLength(50);
    expect(result[0].marketCapAnchor).toBe(6000);
    expect(result.reduce((sum, row) => sum + row.targetWeight, 0)).toBeCloseTo(1, 12);
  });

  it("supports country sector funds", () => {
    const techId = new ObjectId();
    const energyId = new ObjectId();
    const result = buildIndexFundTargetConstituents({
      corporations: [
        corp({ _id: techId, countryId: "US" as CountryId, type: "technology" as CorporationType }),
        corp({ _id: energyId, countryId: "US" as CountryId, type: "energy" as CorporationType }),
        corp({ countryId: "JP" as CountryId, type: "energy" as CorporationType }),
      ],
      definition: {
        scope: "country",
        kind: "sector",
        countryId: "US",
        sectorType: "energy" as CorporationType,
        anchorCurrencyCode: "USD",
      },
      exchangeRates: rates,
    });

    expect(result.map((row) => row.corporationId)).toEqual([energyId]);
  });
});
