/**
 * Audit S6 — national budget gate at the onBillEnacted choke-point.
 *
 * onBillEnacted is the single hook every national enactment path calls
 * (manual sign, pocket-sign, veto override, direct enactment). These tests pin
 * that it runs validateFederalBudgetImpact, persists the outcome/warnings on
 * the bill, arms the debt-ceiling crisis on a breach, and stays WARN-ONLY
 * (never blocks enactment) per the sovereign-deficit design lane.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/policyReactions", () => ({
  recordPolicyReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/budget/enactedLaws", () => ({
  recordEnactedLaw: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { billEnacted: 0x00ff00 },
}));
vi.mock("@/lib/archetypeAffinities", () => ({
  calculateShiftImpacts: vi.fn().mockReturnValue({}),
}));
vi.mock("@/lib/budget/revenue", () => ({
  calculateFederalRevenue: vi.fn().mockResolvedValue({ total: 1000 }),
  calculateStateRevenue: vi.fn().mockResolvedValue({ total: 500 }),
  normalizeFederalTaxRates: vi.fn((t) => t ?? null),
  normalizeStateTaxRates: vi.fn((t) => t ?? null),
}));
vi.mock("@/lib/budget/costs", () => ({
  getSelectedPolicyOption: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/lib/budget/spending", () => ({
  syncFederalBudgetSpending: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  applyInternationalWithdrawalMeasure: vi.fn().mockResolvedValue(undefined),
  billRequiresExecutiveAction: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/congress/resolveBillCountryId", () => ({
  resolveBillCountryId: vi.fn().mockResolvedValue("US"),
  inferCountryIdFromStateId: vi.fn((stateId: string) => (stateId === "federal" ? "US" : null)),
}));
vi.mock("@/lib/budget/validation", () => ({
  validateFederalBudgetImpact: vi.fn(),
}));
vi.mock("@/lib/budget/debt", () => ({
  triggerDebtCeilingCrisis: vi.fn().mockResolvedValue(undefined),
}));

import { onBillEnacted } from "./billEnactment";
import { validateFederalBudgetImpact } from "@/lib/budget/validation";
import { triggerDebtCeilingCrisis } from "@/lib/budget/debt";
import { recordPolicyReaction } from "@/lib/policyReactions";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    title: "Spending Act",
    legislationTypeId: "education_funding",
    effectDirection: 1,
    ...overrides,
  };
}

describe("onBillEnacted — national budget gate (warn-only)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("gameState");
  });

  it("runs federal validation for national bills and persists the outcome", async () => {
    vi.mocked(validateFederalBudgetImpact).mockResolvedValue({
      allowed: true,
      costAmount: 2e9,
      newTotalSpending: 5e12,
      newDebt: 3e13,
      warning: "HIGH_DEBT",
    });

    const bill = makeBill(); // no stateId -> "federal" -> national
    await onBillEnacted(db as unknown as Db, bill as never, 10);

    expect(validateFederalBudgetImpact).toHaveBeenCalledWith(
      expect.anything(),
      bill,
      getNationalBudgetId("US")
    );
    const persistCall = db.collectionMocks["bills"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.budgetValidation
    );
    expect(persistCall).toBeDefined();
    expect(persistCall![1].$set.budgetValidation).toMatchObject({
      costAmount: 2e9,
      newTotalSpending: 5e12,
      newDebt: 3e13,
      warning: "HIGH_DEBT",
    });
    // HIGH_DEBT is a warning, not a debt-ceiling breach.
    expect(triggerDebtCeilingCrisis).not.toHaveBeenCalled();
  });

  it("arms the debt-ceiling crisis on a DEBT_CEILING_EXCEEDED warning", async () => {
    vi.mocked(validateFederalBudgetImpact).mockResolvedValue({
      allowed: true,
      costAmount: 9e12,
      newTotalSpending: 9e12,
      newDebt: 9e13,
      warning: "DEBT_CEILING_EXCEEDED",
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ currentYear: 2027 });

    await onBillEnacted(db as unknown as Db, makeBill() as never, 10);

    expect(triggerDebtCeilingCrisis).toHaveBeenCalledWith(expect.anything(), 2027);
  });

  it("does not run federal validation for sub-national bills", async () => {
    await onBillEnacted(db as unknown as Db, makeBill({ stateId: "TX" }) as never, 10);
    expect(validateFederalBudgetImpact).not.toHaveBeenCalled();
  });

  it("stays warn-only: a validator failure never blocks enactment", async () => {
    vi.mocked(validateFederalBudgetImpact).mockRejectedValue(new Error("budget db down"));

    await onBillEnacted(db as unknown as Db, makeBill() as never, 10);

    // Enactment proceeded past the gate.
    expect(recordPolicyReaction).toHaveBeenCalled();
  });
});
