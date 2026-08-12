import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadSchemeInvestedValues } from "./schemeAssets";
import { chooseSchemeFund, runPensionSchemeInvestments } from "./schemeInvesting";
import { runPensionBenefitsTurn } from "./pensionBenefits";
import { pensionFundingRatio, pensionSchemeAssetsAnchor } from "./rules";
import type { IndexFund } from "@/lib/db/types/indexFund";

vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
}));

const SCHEME_ID = new ObjectId();
const UNION_ID = new ObjectId();
const FUND_ID = new ObjectId();

function baseScheme(overrides: Record<string, unknown> = {}) {
  return {
    _id: SCHEME_ID,
    unionId: UNION_ID,
    countryId: "US",
    unionName: "Test Workers",
    assetsAnchor: 0,
    liabilitiesAnchor: 0,
    totalContributionsAnchor: 0,
    totalTopUpsAnchor: 0,
    createdAtTurn: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fund(overrides: Partial<IndexFund> = {}): IndexFund {
  return {
    _id: FUND_ID,
    slug: "us-broad",
    name: "US Broad Index",
    tickerSymbol: "USB",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1000,
    reserveUnits: 0,
    cashAnchor: 100_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IndexFund;
}

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

describe("loadSchemeInvestedValues", () => {
  it("marks a scheme's units at the fund's quoted NAV", async () => {
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ pensionSchemeId: SCHEME_ID, fundId: FUND_ID, units: 40 }]),
    });
    db.collection("indexFunds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: FUND_ID, quotedNav: 125 }]),
    });

    const values = await loadSchemeInvestedValues(db as unknown as Db, [SCHEME_ID]);
    expect(values.get(SCHEME_ID.toString())).toBe(5000);
  });

  it("values units of a fund that no longer exists at zero", async () => {
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ pensionSchemeId: SCHEME_ID, fundId: FUND_ID, units: 40 }]),
    });
    db.collection("indexFunds").find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const values = await loadSchemeInvestedValues(db as unknown as Db, [SCHEME_ID]);
    expect(values.get(SCHEME_ID.toString())).toBe(0);
  });

  it("asks nothing of the database for an empty scheme list", async () => {
    const values = await loadSchemeInvestedValues(db as unknown as Db, []);
    expect(values.size).toBe(0);
    expect(db.collection("indexFundPositions").find).not.toHaveBeenCalled();
  });
});

describe("runPensionBenefitsTurn", () => {
  it("retires claims, pays the benefit, and discharges the same amount of liability", async () => {
    // 100_000 accrued, nothing in payment: 1000 retires, 2% of that is due.
    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([baseScheme({ assetsAnchor: 50_000, liabilitiesAnchor: 100_000 })]),
    });

    const result = await runPensionBenefitsTurn(db as unknown as Db, 10);

    expect(result.schemesPaying).toBe(1);
    expect(result.retirementsAnchor).toBeCloseTo(1000, 10);
    expect(result.benefitsPaidAnchor).toBeCloseTo(20, 10);
    expect(result.benefitsUnpaidAnchor).toBe(0);
    expect(result.schemesCutting).toBe(0);

    const update = db.collection("pensionSchemes").updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    // Assets down by exactly what was paid, and the promise down by the same.
    expect(update.$inc.assetsAnchor).toBeCloseTo(-20, 10);
    expect(update.$inc.liabilitiesAnchor).toBeCloseTo(-20, 10);
    expect(update.$inc.benefitsInPaymentAnchor).toBeCloseTo(980, 10);
  });

  it("cuts PRO RATA and mints nothing when the assets are not there", async () => {
    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          baseScheme({
            assetsAnchor: 5,
            liabilitiesAnchor: 100_000,
            benefitsInPaymentAnchor: 100_000,
          }),
        ]),
    });

    const result = await runPensionBenefitsTurn(db as unknown as Db, 10);

    // 2000 was due, 5 was there.
    expect(result.benefitsPaidAnchor).toBe(5);
    expect(result.benefitsUnpaidAnchor).toBeCloseTo(1995, 10);
    expect(result.schemesCutting).toBe(1);

    const [filter, update] = db.collection("pensionSchemes").updateOne.mock.calls[0]! as [
      Record<string, unknown>,
      { $inc: Record<string, number>; $set: Record<string, unknown> },
    ];
    // Never more than the cash, and guarded against it having moved.
    expect(update.$inc.assetsAnchor).toBe(-5);
    expect(filter).toMatchObject({ assetsAnchor: { $gte: 5 } });
    expect(update.$set.lastBenefitCutFraction).toBeCloseTo(0.9975, 6);
    // The unpaid claim is NOT forgiven: liability falls only by what was paid.
    expect(update.$inc.liabilitiesAnchor).toBe(-5);
  });

  it("pays nothing at all from an empty scheme", async () => {
    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          baseScheme({
            assetsAnchor: 0,
            liabilitiesAnchor: 50_000,
            benefitsInPaymentAnchor: 50_000,
          }),
        ]),
    });

    const result = await runPensionBenefitsTurn(db as unknown as Db, 10);
    expect(result.benefitsPaidAnchor).toBe(0);
    expect(result.benefitsUnpaidAnchor).toBeCloseTo(1000, 10);
    // No ledger row for a payment that did not happen.
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("skips the scheme rather than overdrawing when the guarded write misses", async () => {
    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([baseScheme({ assetsAnchor: 50_000, liabilitiesAnchor: 100_000 })]),
    });
    db.collection("pensionSchemes").updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const result = await runPensionBenefitsTurn(db as unknown as Db, 10);
    expect(result.schemesPaying).toBe(0);
    expect(result.errors).toHaveLength(1);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("does nothing for a world with no schemes", async () => {
    const result = await runPensionBenefitsTurn(db as unknown as Db, 10);
    expect(result.schemesPaying).toBe(0);
    expect(db.collection("pensionSchemes").updateOne).not.toHaveBeenCalled();
  });
});

describe("chooseSchemeFund", () => {
  it("prefers the scheme's own country's broad index", () => {
    const home = fund();
    const global = fund({ _id: new ObjectId(), scope: "global", countryId: undefined });
    expect(chooseSchemeFund([global, home], "US")).toBe(home);
  });

  it("falls back to the global broad index", () => {
    const global = fund({ _id: new ObjectId(), scope: "global", countryId: undefined });
    expect(chooseSchemeFund([global], "GB")).toBe(global);
  });

  it("will not put a union's pensions into its own sector", () => {
    const sector = fund({ kind: "sector" });
    expect(chooseSchemeFund([sector], "US")).toBeNull();
  });

  it("ignores a paused or delisted fund", () => {
    expect(chooseSchemeFund([fund({ status: "paused" })], "US")).toBeNull();
    expect(chooseSchemeFund([fund({ status: "winding_down" })], "US")).toBeNull();
  });
});

describe("runPensionSchemeInvestments", () => {
  function seed(scheme: Record<string, unknown>, funds: IndexFund[] = [fund()]) {
    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([baseScheme(scheme)]),
    });
    db.collection("indexFunds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(funds),
    });
    db.collection("indexFundPositions").findOneAndUpdate.mockResolvedValue(null);
  }

  it("subscribes whole units at NAV, debiting exactly what the units cost", async () => {
    // 100_000 cash, no pensioners: the 10% floor caps it at 90_000, and at a
    // NAV of 100 that is 900 whole units.
    seed({ assetsAnchor: 100_000 });

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);

    expect(result.schemesInvesting).toBe(1);
    expect(result.investedAnchor).toBe(90_000);

    const [filter, update] = db.collection("pensionSchemes").updateOne.mock.calls[0]! as [
      Record<string, unknown>,
      { $inc: Record<string, number> },
    ];
    expect(update.$inc.assetsAnchor).toBe(-90_000);
    expect(update.$inc.totalInvestedAnchor).toBe(90_000);
    expect(filter).toMatchObject({ assetsAnchor: { $gte: 90_000 } });

    // The fund receives exactly what left the scheme: no mint on either side.
    const fundUpdate = db.collection("indexFunds").updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    expect(fundUpdate.$inc.cashAnchor).toBe(90_000);
    expect(fundUpdate.$inc.unitSupply).toBe(900);
  });

  it("holds the liquidity buffer back for a scheme with pensioners", async () => {
    // 500_000 in payment draws 10_000 a turn, so 80_000 must stay liquid.
    seed({ assetsAnchor: 100_000, benefitsInPaymentAnchor: 500_000 });

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);
    expect(result.investedAnchor).toBe(20_000);
  });

  it("invests nothing when the buffer swallows the cash", async () => {
    seed({ assetsAnchor: 40_000, benefitsInPaymentAnchor: 500_000 });

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);
    expect(result.schemesInvesting).toBe(0);
    expect(db.collection("pensionSchemes").updateOne).not.toHaveBeenCalled();
  });

  it("fails closed with index funds switched off", async () => {
    const { isIndexFundsEnabled } = await import("@/lib/indexFunds/featureFlag");
    vi.mocked(isIndexFundsEnabled).mockResolvedValueOnce(false);
    seed({ assetsAnchor: 100_000 });

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);
    expect(result).toEqual({ schemesInvesting: 0, investedAnchor: 0, errors: [] });
    expect(db.collection("pensionSchemes").find).not.toHaveBeenCalled();
  });

  it("will not buy units off a fund quoting nothing", async () => {
    seed({ assetsAnchor: 100_000 }, [fund({ quotedNav: 0 })]);

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);
    expect(result.schemesInvesting).toBe(0);
  });

  it("issues no units when the guarded debit misses", async () => {
    seed({ assetsAnchor: 100_000 });
    db.collection("pensionSchemes").updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);
    expect(result.schemesInvesting).toBe(0);
    expect(db.collection("indexFundPositions").findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collection("indexFunds").updateOne).not.toHaveBeenCalled();
  });
});

describe("the funding ratio survives a subscription", () => {
  it("is unchanged once the units bought are counted as assets", async () => {
    const liabilities = 100_000;
    const cashBefore = 100_000;
    const ratioBefore = pensionFundingRatio(
      pensionSchemeAssetsAnchor({ assetsAnchor: cashBefore }),
      liabilities
    );

    db.collection("pensionSchemes").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([baseScheme({ assetsAnchor: cashBefore })]),
    });
    db.collection("indexFunds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([fund()]),
    });
    db.collection("indexFundPositions").findOneAndUpdate.mockResolvedValue(null);

    const result = await runPensionSchemeInvestments(db as unknown as Db, 12);

    // Reconstruct the scheme exactly as the turn left it, then mark the units
    // at the same NAV they were bought at.
    const cashAfter = cashBefore - result.investedAnchor;
    const unitsBought = result.investedAnchor / 100;
    const ratioAfter = pensionFundingRatio(
      pensionSchemeAssetsAnchor({
        assetsAnchor: cashAfter,
        investedValueAnchor: unitsBought * 100,
      }),
      liabilities
    );

    expect(ratioAfter).toBeCloseTo(ratioBefore, 10);
    // And the cash-only reading, which is the bug this guards against.
    expect(pensionFundingRatio(cashAfter, liabilities)).toBeLessThan(ratioBefore);
  });
});
