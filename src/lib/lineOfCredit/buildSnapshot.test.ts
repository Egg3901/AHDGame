import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { computeAutoPaymentInternal } from "./locMath";
import { getHomeCurrency } from "@/lib/currency/characterFunds";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/lineOfCredit/featureFlag", () => ({
  isLineOfCreditEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/lineOfCredit/netWorth", () => ({
  computePlayerGrossNetLocInternal: vi.fn(),
  loadExchangeRatesMap: vi.fn(),
}));

vi.mock("@/lib/lineOfCredit/currencyIncomeEstimate", () => ({
  estimatePerTurnCurrencyIncomeHomeFace: vi.fn(),
}));

vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("EUR"),
}));

describe("buildLocSnapshot", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("centralBanks");
    db.collection("characters");
    db.collection("corporations");

    db.collectionMocks["centralBanks"]!.findOne.mockResolvedValue({
      _id: "ECB",
      primeRate: 2.5,
      nationalSavingsBalance: 2_000_000,
      reserveBalance: 1_000_000,
    });
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ totalBalance: 10_000, totalArrears: 0 }]),
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);
  });

  it("keeps scheduled debt service informational while the DTI ceiling still tracks gross income", async () => {
    const { computePlayerGrossNetLocInternal, loadExchangeRatesMap } = await import("./netWorth");
    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");

    vi.mocked(loadExchangeRatesMap).mockResolvedValue({ EUR: 1 } as never);
    vi.mocked(computePlayerGrossNetLocInternal).mockResolvedValue({
      grossInternal: 50_000,
      locDebtInternal: 10_000,
      netInternal: 40_000,
    });
    vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(100);

    const { buildLocSnapshot } = await import("./buildSnapshot");
    const snapshot = await buildLocSnapshot(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "DE",
        lineOfCredit: {
          balances: { EUR: 10_000 },
          arrears: {},
          accountsOpened: { EUR: true },
          drawFrozen: false,
        },
      } as never
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.scheduledDebtServiceInternal).toBeCloseTo(computeAutoPaymentInternal(10_000));
    expect(snapshot!.dtiLimitInternal).toBeCloseTo((0.7 * 100) / 0.0040625);
    expect(snapshot!.netWorthLimitInternal).toBe(40_000);
    expect(snapshot!.perPlayerLimitInternal).toBeCloseTo(snapshot!.dtiLimitInternal);
    expect(snapshot!.perPlayerAvailableInternal).toBeCloseTo(
      snapshot!.perPlayerLimitInternal - 10_000
    );
  });

  it("caps total LOC exposure by current net worth when income underwriting is higher", async () => {
    const { computePlayerGrossNetLocInternal, loadExchangeRatesMap } = await import("./netWorth");
    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");

    vi.mocked(loadExchangeRatesMap).mockResolvedValue({ EUR: 1 } as never);
    vi.mocked(computePlayerGrossNetLocInternal).mockResolvedValue({
      grossInternal: 10_500,
      locDebtInternal: 100,
      netInternal: 500,
    });
    vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(1_000);

    const { buildLocSnapshot } = await import("./buildSnapshot");
    const snapshot = await buildLocSnapshot(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "DE",
        lineOfCredit: {
          balances: { EUR: 100 },
          arrears: {},
          accountsOpened: { EUR: true },
          drawFrozen: false,
        },
      } as never
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.dtiLimitInternal).toBeGreaterThan(snapshot!.netWorthLimitInternal);
    expect(snapshot!.netWorthLimitInternal).toBe(500);
    expect(snapshot!.perPlayerLimitInternal).toBe(500);
    expect(snapshot!.perPlayerAvailableInternal).toBe(400);
  });

  it("selects the euro bank pool for a 2027 French borrower", async () => {
    const { computePlayerGrossNetLocInternal, loadExchangeRatesMap } = await import("./netWorth");
    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");
    db.collection("gameState");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 2,
      preset: "2027-default",
    });
    vi.mocked(loadExchangeRatesMap).mockResolvedValue({ EUR: 1.2 } as never);
    vi.mocked(computePlayerGrossNetLocInternal).mockResolvedValue({
      grossInternal: 10_000,
      locDebtInternal: 0,
      netInternal: 10_000,
    });
    vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(100);

    const { buildLocSnapshot } = await import("./buildSnapshot");
    const snapshot = await buildLocSnapshot(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "FR",
        lineOfCredit: { balances: {}, arrears: {}, accountsOpened: {}, drawFrozen: false },
      } as never
    );

    expect(snapshot).not.toBeNull();
    expect(getHomeCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "FR" }),
      "2027-default"
    );
    expect(db.collectionMocks["centralBanks"]!.findOne).toHaveBeenCalledWith({ _id: "ECB" });
    expect(estimatePerTurnCurrencyIncomeHomeFace).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ countryId: "FR" }),
      expect.objectContaining({ EUR: 1.2 }),
      expect.objectContaining({ preset: "2027-default" })
    );
  });

  it("sizes the pool from the requested bank, not the borrower's home bank", async () => {
    const { computePlayerGrossNetLocInternal, loadExchangeRatesMap } = await import("./netWorth");
    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");
    vi.mocked(getHomeCurrency).mockReturnValue("USD" as never);
    vi.mocked(loadExchangeRatesMap).mockResolvedValue({ USD: 1, JPY: 100 } as never);
    vi.mocked(computePlayerGrossNetLocInternal).mockResolvedValue({
      grossInternal: 1_000_000,
      locDebtInternal: 0,
      netInternal: 1_000_000,
    });
    vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(100_000);
    // US pool nearly exhausted (0.7 * 1000 - 700 = 0); JPY pool large.
    db.collectionMocks["centralBanks"]!.findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "US"
        ? { _id: "US", primeRate: 3, nationalSavingsBalance: 500, reserveBalance: 500 }
        : { _id: "JP", primeRate: 1, nationalSavingsBalance: 300_000_000, reserveBalance: 0 }
    );
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ totalBalance: 700, totalArrears: 0 }]),
    });

    const { buildLocSnapshot } = await import("./buildSnapshot");
    const character = {
      _id: new ObjectId(),
      countryId: "US",
      lineOfCredit: { balances: {}, arrears: {}, accountsOpened: {}, drawFrozen: false },
    } as never;

    const home = await buildLocSnapshot(db as unknown as Db, character);
    expect(home!.poolCurrency).toBe("USD");
    expect(home!.availableBorrowInternal).toBe(0);
    expect(home!.perPlayerAvailableInternal).toBe(0);

    const jpy = await buildLocSnapshot(db as unknown as Db, character, "JPY");
    expect(jpy!.poolCurrency).toBe("JPY");
    // 0.7 * 300M JPY = 210M face, minus 700 JPY outstanding in that mocked aggregate.
    expect(jpy!.availableBorrowFace).toBeCloseTo(210_000_000 - 700);
    expect(jpy!.availableBorrowInternal).toBeCloseTo((210_000_000 - 700) / 100);
    expect(jpy!.perPlayerAvailableInternal).toBeGreaterThan(0);
  });
});
