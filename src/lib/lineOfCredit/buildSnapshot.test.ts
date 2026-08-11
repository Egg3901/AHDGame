import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { computeAutoPaymentInternal } from "./locMath";

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
});
