import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types";
import type { Db } from "mongodb";

const purchaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bonds/purchaseBondUnitsForFund", () => ({
  purchaseBondUnitsForFund: purchaseMock,
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  corpCapitalToAnchor: vi.fn((amount: number) => amount),
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1, GBP: 1 }),
}));
import {
  bondAllocationBudgetForIssue,
  deployBondReserveFromCash,
  isGlobalFundBondEligible,
  rankSovereignIssuesForBreadth,
  ratingWithinUniverse,
  resolveFundBondCountryId,
} from "./fundBondReserve";

beforeEach(() => {
  vi.clearAllMocks();
  purchaseMock.mockImplementation(
    async (_db: Db, _fund: IndexFund, issue: Bond, units: number) => ({
      ok: true,
      units,
      costAnchor: units * 1_000,
      bondId: issue._id,
    })
  );
});

function bond(input: {
  countryId: "US" | "UK";
  holders?: Bond["holders"];
  maturityTurn: number;
}): Bond {
  return {
    _id: new ObjectId(),
    issuerType: "sovereign",
    countryId: input.countryId,
    currencyCode: input.countryId === "US" ? "USD" : "GBP",
    holders: input.holders ?? [],
    maturityTurn: input.maturityTurn,
  } as Bond;
}

describe("resolveFundBondCountryId", () => {
  it("uses the fund country when present", () => {
    expect(
      resolveFundBondCountryId({
        countryId: "UK",
        anchorCurrencyCode: "GBP",
        scope: "country",
      })
    ).toBe("UK");
  });

  it("maps USD anchor global funds to US sovereign paper", () => {
    expect(
      resolveFundBondCountryId({
        anchorCurrencyCode: "USD",
        scope: "global",
      })
    ).toBe("US");
  });
});

describe("bondAllocationBudgetForIssue", () => {
  it("spreads remaining cash equally across the remaining auction issues", () => {
    expect(bondAllocationBudgetForIssue(10_000_000, 25)).toBe(400_000);
    expect(bondAllocationBudgetForIssue(9_600_000, 24)).toBe(400_000);
  });

  it("returns zero for an exhausted budget or issue list", () => {
    expect(bondAllocationBudgetForIssue(0, 25)).toBe(0);
    expect(bondAllocationBudgetForIssue(10_000_000, 0)).toBe(0);
  });
});

describe("global sovereign demand", () => {
  it("allows domestic paper and blocks controlled foreign currency paper", () => {
    const tradable = new Set(["USD", "GBP"]);
    const controlled = new Set(["GBP"]);
    expect(
      isGlobalFundBondEligible(
        bond({ countryId: "US", maturityTurn: 60 }),
        "US",
        tradable,
        controlled
      )
    ).toBe(true);
    expect(
      isGlobalFundBondEligible(
        bond({ countryId: "UK", maturityTurn: 60 }),
        "US",
        tradable,
        controlled
      )
    ).toBe(false);
  });

  it("blocks foreign paper when its currency has no live FX rate", () => {
    expect(
      isGlobalFundBondEligible(
        bond({ countryId: "UK", maturityTurn: 60 }),
        "US",
        new Set(["USD"]),
        new Set()
      )
    ).toBe(false);
  });

  it("ranks unheld issues before already-held issues", () => {
    const held = bond({
      countryId: "US",
      maturityTurn: 48,
      holders: [{ fundId: new ObjectId(), units: 1 }],
    });
    const unheld = bond({ countryId: "UK", maturityTurn: 96 });

    expect(rankSovereignIssuesForBreadth([held, unheld]).map((row) => row._id)).toEqual([
      unheld._id,
      held._id,
    ]);
  });

  it("widens only enabled global funds beyond their home bond market", async () => {
    const issues = [
      {
        ...bond({ countryId: "US", maturityTurn: 60 }),
        publicFloat: 1_000,
        marketPrice: 1,
        totalIssued: 1_000_000,
      },
      {
        ...bond({ countryId: "UK", maturityTurn: 72 }),
        publicFloat: 1_000,
        marketPrice: 1,
        totalIssued: 1_000_000,
      },
    ];
    const fund = {
      _id: new ObjectId(),
      name: "Global Fund",
      scope: "global",
      anchorCurrencyCode: "USD",
      cashAnchor: 100_000,
      holdings: [],
      bondAllocations: [],
    } as unknown as IndexFund;
    const bondFind = vi.fn((query: Record<string, unknown>) => ({
      sort: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(issues) })),
      query,
    }));
    const exchangeFind = vi.fn(() => ({
      project: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([
          { currencyCode: "USD", rate: 1 },
          { currencyCode: "GBP", rate: 1 },
        ]),
      })),
    }));
    const indexFindOne = vi.fn().mockResolvedValue(fund);
    const collections = {
      bonds: { find: bondFind },
      exchangeRates: { find: exchangeFind },
      indexFunds: { findOne: indexFindOne },
      // The pass preloads every bond pool once; none exist in this fixture.
      bondMarketPools: { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) },
    };
    const db = {
      collection: vi.fn((name: keyof typeof collections) => collections[name]),
    } as unknown as Db;

    await deployBondReserveFromCash(db, fund, 0, { liquidityTargetEnabled: true });
    expect(bondFind.mock.calls[0][0]).not.toHaveProperty("countryId");
    expect(purchaseMock).toHaveBeenCalledTimes(2);

    const controlFund = {
      ...fund,
      cashAnchor: 50_000,
      holdings: [
        {
          corporationId: new ObjectId(),
          shares: 1,
          lastValueAnchor: 400_000,
        },
      ],
    };
    await deployBondReserveFromCash(db, controlFund, 0, { liquidityTargetEnabled: false });
    expect(bondFind.mock.calls[1][0]).toMatchObject({ countryId: "US" });
  });
});

describe("ratingWithinUniverse", () => {
  it("treats minRating as the worst grade allowed and maxRating as the best", () => {
    expect(ratingWithinUniverse("AAA", { minRating: "BBB" })).toBe(true);
    expect(ratingWithinUniverse("BB", { minRating: "BBB" })).toBe(false);
    expect(ratingWithinUniverse("BB", { maxRating: "BB" })).toBe(true);
    expect(ratingWithinUniverse("A", { maxRating: "BB" })).toBe(false);
    // Unrated corporates read as BBB: investment grade, not high yield.
    expect(ratingWithinUniverse(undefined, { minRating: "BBB" })).toBe(true);
    expect(ratingWithinUniverse(undefined, { maxRating: "BB" })).toBe(false);
  });
});
