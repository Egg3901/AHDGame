import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CorpSnapshot } from "@/lib/turn/corporation/types";

vi.mock("@/lib/imf/resolveImfCorporation", () => ({ getImfCorporation: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((amount: number) => amount),
  fxRateForCorpFromMap: vi.fn(() => 1),
  loadFxRatesByCurrency: vi.fn(),
}));
vi.mock("@/lib/imf/imfFacilityMath", () => ({
  computeImfFacilityPaymentTurn: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
});

describe("processImfBailoutPayments", () => {
  it("updates in-memory snapshots with the actual IMF payment", async () => {
    const corpId = new ObjectId();
    const imfCorpId = new ObjectId();
    const imfCorp = {
      _id: imfCorpId,
      name: "International Monetary Fund",
      liquidCapital: 10_000,
      liquidCurrencyCode: "USD",
    };
    const rescuedCorp = {
      _id: corpId,
      imfBailoutActive: true,
      imfFacilityPrincipalOutstanding: 1_000,
      imfFacilityAnnualRate: 6,
      imfFacilityAmortizationTurnsRemaining: 48,
      liquidCurrencyCode: "USD",
    };
    const corpSnapshots: CorpSnapshot[] = [
      {
        corpId,
        revenue: 0,
        totalCosts: 0,
        incomePreDividends: 0,
        income: 0,
        perTurnBondCouponIncome: 0,
        perTurnBondInterestExpense: 0,
        perTurnBondDragOnNetIncome: 0,
        liquidCapitalAnchorAfterIncome: 0,
        dividendPaidPerTurn: 0,
        federalTaxPaid: 0,
        stateTaxPaid: 0,
        taxPaidByCountry: new Map(),
        taxPaidByState: new Map(),
        taxPaidByCountryDomestic: new Map(),
        taxPaidByCountryForeign: new Map(),
        taxPaidByStateDomestic: new Map(),
        taxPaidByStateForeign: new Map(),
        marketingStrength: 0,
        logisticsStrength: 0,
        rdScore: 0,
        dividendRate: 0,
        liquidCapital: 5_000,
        escrowFundingMove: 0,
        escrowBalanceAfter: 0,
        actualSharePrice: 1,
        totalShares: 100,
        sectorNPV: 0,
        creditComposite: 0,
        creditRating: "BBB",
      },
      {
        corpId: imfCorpId,
        revenue: 0,
        totalCosts: 0,
        incomePreDividends: 0,
        income: 0,
        perTurnBondCouponIncome: 0,
        perTurnBondInterestExpense: 0,
        perTurnBondDragOnNetIncome: 0,
        liquidCapitalAnchorAfterIncome: 0,
        dividendPaidPerTurn: 0,
        federalTaxPaid: 0,
        stateTaxPaid: 0,
        taxPaidByCountry: new Map(),
        taxPaidByState: new Map(),
        taxPaidByCountryDomestic: new Map(),
        taxPaidByCountryForeign: new Map(),
        taxPaidByStateDomestic: new Map(),
        taxPaidByStateForeign: new Map(),
        marketingStrength: 0,
        logisticsStrength: 0,
        rdScore: 0,
        dividendRate: 0,
        liquidCapital: 10_000,
        escrowFundingMove: 0,
        escrowBalanceAfter: 0,
        actualSharePrice: 1,
        totalShares: 100,
        sectorNPV: 0,
        creditComposite: 0,
        creditRating: "AAA",
      },
    ];

    const { getImfCorporation } = await import("@/lib/imf/resolveImfCorporation");
    vi.mocked(getImfCorporation).mockResolvedValue(imfCorp as never);

    const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");
    vi.mocked(loadFxRatesByCurrency).mockResolvedValue(new Map() as never);

    const { computeImfFacilityPaymentTurn } = await import("@/lib/imf/imfFacilityMath");
    vi.mocked(computeImfFacilityPaymentTurn).mockReturnValue({
      scheduledPayment: 100,
      actualPayment: 100,
      interestPortion: 10,
      principalPortion: 90,
      interestShortfall: 0,
      newPrincipal: 910,
      newRemainingTurns: 47,
    });

    const { processImfBailoutPayments } = await import("./imfBailoutTurn");
    const result = await processImfBailoutPayments(db as never, 1, corpSnapshots, [
      rescuedCorp as never,
      imfCorp as never,
    ]);

    expect(result.paymentsApplied).toBe(1);
    expect(corpSnapshots[0].liquidCapital).toBe(4_900);
    expect(corpSnapshots[1].liquidCapital).toBe(10_100);
    expect(db.collectionMocks.corporations.bulkWrite).toHaveBeenCalled();
  });
});
