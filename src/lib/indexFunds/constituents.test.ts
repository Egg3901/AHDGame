import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  buildIndexFundTargetConstituents,
  capSingleNameWeights,
  INDEX_FUND_MAX_SINGLE_NAME_WEIGHT,
  convertLocalMarketCapToFundAnchor,
  isEligibleIndexFundConstituent,
  type IndexFundCandidate,
} from "./constituents";
import { LISTING_GRACE_TURNS } from "./listingStandards";

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
    const { constituents: result } = buildIndexFundTargetConstituents({
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

    const { constituents: result } = buildIndexFundTargetConstituents({
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
    const { constituents: result } = buildIndexFundTargetConstituents({
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

describe("listing standards inside the basket build", () => {
  const definition = {
    scope: "country" as const,
    kind: "broad" as const,
    countryId: "US" as CountryId,
    anchorCurrencyCode: "USD" as CurrencyCode,
  };

  /** Five peers around a median of 1,000, so the size floor sits at 50. */
  function pool(): IndexFundCandidate[] {
    return [10, 10, 10, 10, 10].map((price, i) =>
      corp({ sharePrice: price, totalShares: 100 * (i + 1) })
    );
  }

  it("excludes an applicant that is a rounding error next to its peers", () => {
    const tiny = corp({ sharePrice: 1, totalShares: 1 });
    const { constituents } = buildIndexFundTargetConstituents({
      corporations: [...pool(), tiny],
      definition,
      exchangeRates: rates,
    });
    expect(constituents.map((c) => c.corporationId.toString())).not.toContain(tiny._id.toString());
  });

  it("keeps a failing INCUMBENT in the basket while it still has grace", () => {
    const slipping = corp({ sharePrice: 1, totalShares: 1 });
    const { constituents, droppedIds, streaks } = buildIndexFundTargetConstituents({
      corporations: [...pool(), slipping],
      definition,
      exchangeRates: rates,
      retention: {
        incumbentIds: new Set([slipping._id.toString()]),
        priorStreaks: new Map(),
      },
    });
    expect(constituents.map((c) => c.corporationId.toString())).toContain(slipping._id.toString());
    expect(droppedIds).toEqual([]);
    expect(streaks).toEqual([
      { corporationId: slipping._id.toString(), consecutiveFailures: 1, failures: ["size"] },
    ]);
  });

  it("sells the incumbent once grace is exhausted", () => {
    const slipping = corp({ sharePrice: 1, totalShares: 1 });
    const { constituents, droppedIds } = buildIndexFundTargetConstituents({
      corporations: [...pool(), slipping],
      definition,
      exchangeRates: rates,
      retention: {
        incumbentIds: new Set([slipping._id.toString()]),
        priorStreaks: new Map([[slipping._id.toString(), LISTING_GRACE_TURNS - 1]]),
      },
    });
    expect(constituents.map((c) => c.corporationId.toString())).not.toContain(
      slipping._id.toString()
    );
    expect(droppedIds).toEqual([slipping._id.toString()]);
  });

  it("never fails a corporation for float it has no record of", () => {
    // Reading absent float as zero would empty every index on the first
    // rebalance, since most corporations carry no publicFloat at all.
    const noFloat = corp({ sharePrice: 10, totalShares: 500 });
    const { constituents } = buildIndexFundTargetConstituents({
      corporations: [...pool(), noFloat],
      definition,
      exchangeRates: rates,
    });
    expect(constituents.map((c) => c.corporationId.toString())).toContain(noFloat._id.toString());
  });
});

describe("committee waivers inside the basket build", () => {
  const definition = {
    scope: "country" as const,
    kind: "broad" as const,
    countryId: "US" as CountryId,
    anchorCurrencyCode: "USD" as CurrencyCode,
  };

  function pool(): IndexFundCandidate[] {
    return [10, 10, 10, 10, 10].map((price, i) =>
      corp({ sharePrice: price, totalShares: 100 * (i + 1) })
    );
  }

  it("admits a corporation that fails on size when it holds a waiver", () => {
    const tiny = corp({ sharePrice: 1, totalShares: 1 });
    const { constituents } = buildIndexFundTargetConstituents({
      corporations: [...pool(), tiny],
      definition,
      exchangeRates: rates,
      retention: {
        incumbentIds: new Set(),
        priorStreaks: new Map(),
        waivedIds: new Set([tiny._id.toString()]),
      },
    });
    expect(constituents.map((c) => c.corporationId.toString())).toContain(tiny._id.toString());
  });

  it("keeps an INSOLVENT corporation out however it was waived", () => {
    // The waiver suppresses the qualification bars and never solvency, and it
    // is enforced in the screen so no caller can grant what the rule forbids.
    // Materially insolvent: -1000 far exceeds 1% of the 5000 market cap.
    const broke = corp({ sharePrice: 10, totalShares: 500, liquidCapital: -1000 });
    const { constituents } = buildIndexFundTargetConstituents({
      corporations: [...pool(), broke],
      definition,
      exchangeRates: rates,
      retention: {
        incumbentIds: new Set(),
        priorStreaks: new Map(),
        waivedIds: new Set([broke._id.toString()]),
      },
    });
    expect(constituents.map((c) => c.corporationId.toString())).not.toContain(broke._id.toString());
  });

  it("waives nothing for a corporation without one", () => {
    const tiny = corp({ sharePrice: 1, totalShares: 1 });
    const { constituents } = buildIndexFundTargetConstituents({
      corporations: [...pool(), tiny],
      definition,
      exchangeRates: rates,
      retention: {
        incumbentIds: new Set(),
        priorStreaks: new Map(),
        waivedIds: new Set([new ObjectId().toString()]),
      },
    });
    expect(constituents.map((c) => c.corporationId.toString())).not.toContain(tiny._id.toString());
  });
});

describe("single-name concentration cap", () => {
  it("caps a dominant name and hands the excess to the others pro rata", () => {
    const w = capSingleNameWeights([0.6, 0.2, 0.1, 0.05, 0.05], 0.2);
    expect(w[0]).toBeCloseTo(0.2, 12);
    expect(w[1]).toBeCloseTo(0.2, 12);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Math.max(...w)).toBeLessThanOrEqual(0.2 + 1e-12);
  });

  it("leaves weights unchanged when there are too few names to honour the cap", () => {
    expect(capSingleNameWeights([0.9, 0.1], 0.2)).toEqual([0.9, 0.1]);
  });

  it("applies the cap to fund constituents", () => {
    const ids = Array.from({ length: 6 }, () => new ObjectId());
    const { constituents: result } = buildIndexFundTargetConstituents({
      corporations: ids.map((id, i) =>
        corp({
          _id: id,
          sharePrice: i === 0 ? 1000 : 10,
          totalShares: 100,
          liquidCurrencyCode: "USD",
        })
      ),
      definition: { scope: "country", kind: "broad", countryId: "US", anchorCurrencyCode: "USD" },
      exchangeRates: rates,
    });
    expect(result[0].corporationId).toEqual(ids[0]);
    expect(result[0].targetWeight).toBeCloseTo(INDEX_FUND_MAX_SINGLE_NAME_WEIGHT, 12);
    expect(result.reduce((sum, row) => sum + row.targetWeight, 0)).toBeCloseTo(1, 12);
  });
});
