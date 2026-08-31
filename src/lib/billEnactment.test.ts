import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { onBillEnacted } from "./billEnactment";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

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
  calculateStateRevenue: vi.fn().mockResolvedValue({
    incomeTax: 0,
    salesTax: 0,
    domesticCorporateTax: 300,
    foreignCorporateTax: 200,
    propertyTax: 0,
    federalGrants: 0,
    other: 0,
    total: 500,
  }),
  normalizeFederalTaxRates: vi.fn((taxRates) => taxRates ?? null),
  normalizeStateTaxRates: vi.fn((taxRates) => taxRates ?? null),
}));

vi.mock("@/lib/budget/costs", () => ({
  getSelectedPolicyOption: vi.fn().mockReturnValue(undefined),
}));

import { getDb } from "@/lib/mongodb";
import { recordPolicyReaction } from "@/lib/policyReactions";
import { recordEnactedLaw } from "@/lib/budget/enactedLaws";
import { calculateShiftImpacts } from "@/lib/archetypeAffinities";
import { sendCountryGameEvent } from "@/lib/discordWebhooks";

describe("onBillEnacted", () => {
  let db: MockDb;
  const _NOW = new Date("2025-06-15T12:00:00Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  const createBill = (
    overrides?: Partial<{
      _id: ObjectId;
      title: string;
      legislationTypeId: string;
      effectDirection: number;
      stateId?: string;
      provisions?: Array<{
        legislationTypeId: string;
        policyOptionId?: string;
        effectDirection: number;
        economic?: number;
        social?: number;
      }>;
      votes?: Record<string, "for" | "against" | "abstain">;
    }>
  ) => ({
    _id: new ObjectId(),
    title: "Test Bill",
    legislationTypeId: "tax-cut-act",
    effectDirection: 1,
    ...overrides,
  });

  const createLegislationType = (
    id: string,
    policyDomain: string = "economy",
    policyOptions?: Array<{
      id: string;
      effectDirection: number;
      economic?: number;
      social?: number;
      rate?: number;
    }>
  ) => ({
    _id: id,
    policyDomain,
    policyOptions: policyOptions ?? [
      { id: "strong-left", effectDirection: -2, economic: -2 },
      { id: "left", effectDirection: -1, economic: -1 },
      { id: "center", effectDirection: 0, economic: 0 },
      { id: "right", effectDirection: 1, economic: 1 },
      { id: "strong-right", effectDirection: 2, economic: 2 },
    ],
  });

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
    });
    // Also set up findOne for collections that need it (e.g., gameState)
    if (name === "gameState") {
      db.collectionMocks[name]!.findOne = vi.fn().mockResolvedValue(data[0] ?? null);
    }
  }

  it("returns early when bill has no provisions", async () => {
    const bill = createBill({ provisions: [], legislationTypeId: undefined as unknown as string });

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordPolicyReaction).not.toHaveBeenCalled();
    expect(recordEnactedLaw).not.toHaveBeenCalled();
  });

  it("still applies an international withdrawal bill even when it has no policy provisions", async () => {
    const agreementId = new ObjectId();
    db.collection("organizationLegislation");
    db.collection("countryHistory");
    db.collectionMocks["organizationLegislation"]!.findOne = vi.fn().mockResolvedValue({
      _id: agreementId,
      organizationId: "EU",
      title: "Single Market Accord",
      parties: ["UK", "DE", "JP"],
      status: "active",
    });

    await onBillEnacted(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        title: "Resolution to Withdraw the UK from the Single Market Accord",
        countryId: "UK",
        provisions: [],
        internationalAction: {
          type: "leave_free_trade_agreement",
          targetCountryId: "UK",
          organizationId: "EU",
          organizationName: "European Union",
          organizationLegislationId: agreementId,
          organizationLegislationTitle: "Single Market Accord",
        },
      } as any,
      144
    );

    expect(db.collectionMocks["organizationLegislation"]!.updateOne).toHaveBeenCalledWith(
      { _id: agreementId },
      {
        $set: {
          parties: ["DE", "JP"],
        },
      }
    );
    expect(recordPolicyReaction).not.toHaveBeenCalled();
    expect(recordEnactedLaw).not.toHaveBeenCalled();
  });

  it("processes legacy-style bill with single legislationTypeId and effectDirection", async () => {
    const bill = createBill({ legislationTypeId: "healthcare-reform", effectDirection: 1 });
    const legType = createLegislationType("healthcare-reform", "healthcare");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordPolicyReaction).toHaveBeenCalled();
    expect(recordEnactedLaw).toHaveBeenCalled();
  });

  it("processes modern-style bill with provisions array", async () => {
    const bill = createBill({
      provisions: [
        { legislationTypeId: "tax-cut", effectDirection: 1, economic: 1 },
        { legislationTypeId: "spending-increase", effectDirection: -1, economic: -1 },
      ],
    });
    const legType1 = createLegislationType("tax-cut", "economy");
    const legType2 = createLegislationType("spending-increase", "spending");

    setupCollection("legislationTypes", [legType1, legType2]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordPolicyReaction).toHaveBeenCalledTimes(1);
    expect(recordEnactedLaw).toHaveBeenCalledTimes(2);
  });

  it("updates statePolicies collection with new policy option", async () => {
    const bill = createBill({
      provisions: [
        { legislationTypeId: "healthcare-reform", effectDirection: 1, economic: 1, social: 0 },
      ],
    });
    const legType = createLegislationType("healthcare-reform", "healthcare", [
      { id: "status-quo", effectDirection: 0, economic: 0, social: 0 },
      { id: "reform-lite", effectDirection: 1, economic: 1, social: 0 },
      { id: "full-reform", effectDirection: 2, economic: 2, social: 1 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
    setupCollection("statePolicies", []);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "federal",
      legislationTypeId: "healthcare-reform",
    });
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "reform-lite",
      policyOptionIndex: 1,
      economic: 1,
      social: 0,
      effectDirection: 1,
    });
  });

  it("sets scope='national' on statePolicies when stateId is a national pseudo-id", async () => {
    const bill = createBill({
      stateId: "jp_national",
      provisions: [
        { legislationTypeId: "jp_gender_equality", effectDirection: 0, economic: -3, social: -3 },
      ],
    });
    const legType = createLegislationType("jp_gender_equality", "social", [
      { id: "opt", effectDirection: 0, economic: -3, social: -3 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 219);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "jp_national",
      legislationTypeId: "jp_gender_equality",
    });
    // Regression: this field was missing, which hid JP enacted policies from
    // /api/country/jp/policy (it queries by scope="national").
    expect(updateCall[1].$set.scope).toBe("national");
  });

  it("sets scope='state' on statePolicies when bill has a real state stateId", async () => {
    const bill = createBill({
      stateId: "US_CA",
      provisions: [{ legislationTypeId: "ca-bill", effectDirection: 1 }],
    });
    const legType = createLegislationType("ca-bill", "economy");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set.scope).toBe("state");
  });

  // Ticket 1102: the Poon Choi Economic Act enacted VAT/customs sliders but never wrote
  // federalBudget.taxRates, because its stored legislationType carried `taxSlider` alone
  // (no `taxRateChange`) and the applier required the latter. A slider provision must apply
  // its rate from `taxSlider` regardless.
  it("applies a slider tax provision that has taxSlider but no taxRateChange", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "uk.tax.salesTax",
          effectDirection: 1,
          proposedRate: 5,
        } as any,
      ],
    });
    const legType = {
      _id: "uk.tax.salesTax",
      policyDomain: "tax",
      countryScope: "uk",
      policyOptions: [],
      // Deliberately NO taxRateChange — the exact shape that dropped the rate on prod.
      taxSlider: {
        scope: "federal",
        taxType: "salesTax",
        minRate: 0,
        maxRate: 30,
        step: 1,
        baselineRate: 0,
        waypoints: [],
      },
    };

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 1955 } as any]);
    setupCollection("statePolicies", []);
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      taxRates: { incomeTax: 36, salesTax: 0, tariffs: 0 },
      spending: { total: 100 },
    });

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    expect(updateCall, "federalBudget.updateOne should have been called").toBeTruthy();
    // Ramped: 0 to 5 is a large move, so it steps one point this turn and
    // records 5 as the destination. The regression this guards is that the
    // provision applies AT ALL, which it now demonstrably does.
    expect(updateCall[1].$set.taxRates.salesTax).toBe(1);
    expect(updateCall[1].$set["taxRatePhaseIn.salesTax"]).toBe(5);
  });

  it("uses policyOptionId for matching when provided", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "tax-policy",
          policyOptionId: "aggressive-cut",
          effectDirection: 1,
        },
      ],
    });
    const legType = createLegislationType("tax-policy", "economy", [
      { id: "status-quo", effectDirection: 0 },
      { id: "moderate-cut", effectDirection: 1 },
      { id: "aggressive-cut", effectDirection: 2 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    // Should match by policyOptionId, not effectDirection
    expect(updateCall[1].$set.policyOptionId).toBe("aggressive-cut");
    expect(updateCall[1].$set.policyOptionIndex).toBe(2);
  });

  it("falls back to center option when no match found", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "mystery-policy",
          policyOptionId: "nonexistent",
          effectDirection: 999,
        },
      ],
    });
    const legType = createLegislationType("mystery-policy", "mystery", [
      { id: "left", effectDirection: -1 },
      { id: "center", effectDirection: 0 },
      { id: "right", effectDirection: 1 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    // Should fall back to center (index 1 for 3 options)
    expect(updateCall[1].$set.policyOptionId).toBe("center");
    expect(updateCall[1].$set.policyOptionIndex).toBe(1);
  });

  it("uses provision economic/social overrides over policy option values", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "eco-policy",
          effectDirection: 1,
          economic: 5,
          social: -3,
        },
      ],
    });
    const legType = createLegislationType("eco-policy", "economy", [
      { id: "option", effectDirection: 1, economic: 1, social: 1 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set.economic).toBe(5);
    expect(updateCall[1].$set.social).toBe(-3);
  });

  it("uses policy option economic/social when provision has no overrides", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "eco-policy",
          effectDirection: 1,
        },
      ],
    });
    const legType = createLegislationType("eco-policy", "economy", [
      { id: "option", effectDirection: 1, economic: 2, social: -1 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set.economic).toBe(2);
    expect(updateCall[1].$set.social).toBe(-1);
  });

  it("defaults to economic: 0, social: 0 when no values provided", async () => {
    const bill = createBill({
      provisions: [
        {
          legislationTypeId: "bare-policy",
          effectDirection: 0,
        },
      ],
    });
    const legType = createLegislationType("bare-policy", "general", [
      { id: "option", effectDirection: 0 },
    ]);

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set.economic).toBe(0);
    expect(updateCall[1].$set.social).toBe(0);
  });

  it("records policy reaction for enacted bill", async () => {
    const bill = createBill({ title: "Climate Action Act" });
    const legType = createLegislationType("tax-cut-act", "environment");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordPolicyReaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Climate Action Act" }),
      "federal",
      10
    );
  });

  it("records enacted law with fiscal year from game state", async () => {
    const bill = createBill();
    const legType = createLegislationType("tax-cut-act", "economy");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2026 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordEnactedLaw).toHaveBeenCalled();
    const call = vi.mocked(recordEnactedLaw).mock.calls[0];
    expect(call[3]).toBe(2026); // fiscalYear
    expect(call[4]).toBe("national"); // scope
    expect(call[5]).toBeUndefined(); // stateId
  });

  it("uses stateId for state bills", async () => {
    const bill = createBill({ stateId: "US-CA" });
    const legType = createLegislationType("tax-cut-act", "economy");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2026 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(recordEnactedLaw).toHaveBeenCalled();
    const call = vi.mocked(recordEnactedLaw).mock.calls[0];
    expect(call[3]).toBe(2026); // fiscalYear
    expect(call[4]).toBe("state"); // scope
    expect(call[5]).toBe("US-CA"); // stateId
  });

  it("uses uk_national for UK bills", async () => {
    const bill = createBill({ stateId: "uk_national" });
    const legType = createLegislationType("tax-cut-act", "economy");

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(sendCountryGameEvent).toHaveBeenCalled();
  });

  it("applies archetype impacts to voters who voted FOR the bill", async () => {
    const bill = createBill({
      provisions: [{ legislationTypeId: "archetype-bill", effectDirection: 1 }],
      votes: {
        "507f1f77bcf86cd799439011": "for",
        "507f1f77bcf86cd799439012": "against",
        "507f1f77bcf86cd799439013": "for",
        "507f1f77bcf86cd799439014": "abstain",
      },
    });
    const legType = createLegislationType("archetype-bill", "social");
    vi.mocked(calculateShiftImpacts).mockReturnValue({ "worker-archetype": 5 });

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
    setupCollection("characters", []);
    setupCollection("npps", []);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(calculateShiftImpacts).toHaveBeenCalledWith(
      "social",
      2, // no prior policy → center of THIS type's 5 options = floor(5/2) = 2
      // (#2899: was the hardcoded 3, which is out of bounds for <4-option
      // types and pointed at "right" here, biasing every fresh enactment)
      expect.any(Number),
      expect.anything(), // resolvedCountry — "US" for US bills, "UK" for UK, etc.
      expect.anything() // per-option position scores (econ+social) for correct shift direction
    );
  });

  it("scores a region bill's shift from level 0 for a new-generation `both` law", async () => {
    // The region default is level 0 and the propose modal now previews the
    // shift from there. Falling through to the ladder centre scored the
    // approval swing as 2 -> 3 instead of 0 -> 3, so the outcome disagreed
    // with the preview the voters were shown.
    const bothLaw = getCatalog("RU").find(
      (law) => law.kind !== "tax" && law.allowedScope === "both"
    )!;
    const projected = projectLawToLegislationType(bothLaw);
    const bill = createBill({
      stateId: "MOW",
      provisions: [{ legislationTypeId: bothLaw.id, policyOptionId: "l3", effectDirection: 1 }],
      votes: { "507f1f77bcf86cd799439011": "for" },
    });
    vi.mocked(calculateShiftImpacts).mockReturnValue({});

    setupCollection("legislationTypes", [projected]);
    setupCollection("gameState", [{ _id: "current", currentYear: 1962 } as any]);
    setupCollection("characters", []);
    setupCollection("npps", []);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(calculateShiftImpacts).toHaveBeenCalledWith(
      projected.policyDomain,
      0,
      3,
      expect.anything(),
      expect.anything()
    );
  });

  it("keeps the ladder centre for a NATIONAL bill on the same law", async () => {
    // National rows are seeded, so a missing one is a different problem and
    // must not be silently rewritten to 0.
    const bothLaw = getCatalog("RU").find(
      (law) => law.kind !== "tax" && law.allowedScope === "both"
    )!;
    const projected = projectLawToLegislationType(bothLaw);
    const bill = createBill({
      stateId: "su_national",
      provisions: [{ legislationTypeId: bothLaw.id, policyOptionId: "l3", effectDirection: 1 }],
      votes: { "507f1f77bcf86cd799439011": "for" },
    });
    vi.mocked(calculateShiftImpacts).mockReturnValue({});

    setupCollection("legislationTypes", [projected]);
    setupCollection("gameState", [{ _id: "current", currentYear: 1962 } as any]);
    setupCollection("characters", []);
    setupCollection("npps", []);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(calculateShiftImpacts).toHaveBeenCalledWith(
      projected.policyDomain,
      2,
      3,
      expect.anything(),
      expect.anything()
    );
  });

  describe("tax rate change enactment", () => {
    it("updates state budget taxRates and recalculates revenue for state-scope domestic corp tax bills", async () => {
      const { calculateStateRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        stateId: "US_CA",
        provisions: [
          {
            legislationTypeId: "us_state_domestic_corporate_tax_rate",
            policyOptionId: "rate_10",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_state_domestic_corporate_tax_rate",
        policyDomain: "tax",
        taxRateChange: { scope: "state", taxType: "domesticCorporateTax" },
        policyOptions: [{ id: "rate_10", effectDirection: 1, economic: 1, rate: 10 }],
      };
      const existingBudget = {
        _id: "US_CA",
        stateId: "US_CA",
        taxRates: {
          incomeTax: 5,
          salesTax: 7,
          domesticCorporateTax: 21,
          foreignCorporateTax: 21,
          propertyTax: 1.5,
        },
        revenue: { federalGrants: 100, total: 2000 },
        spending: { total: 1800 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("stateBudgets");
      db.collectionMocks["stateBudgets"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      // Only the domestic rate was changed; foreign stays at 21.
      expect(calculateStateRevenue).toHaveBeenCalledWith(
        expect.anything(),
        "US_CA",
        "US",
        expect.objectContaining({ domesticCorporateTax: 10, foreignCorporateTax: 21 }),
        100
      );

      const updateCall = db.collectionMocks["stateBudgets"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: "US_CA", countryId: "US" });
      expect(updateCall[1].$set).toMatchObject({
        taxRates: expect.objectContaining({ domesticCorporateTax: 10, foreignCorporateTax: 21 }),
        revenue: expect.objectContaining({ total: 500 }),
        surplus: 500 - 1800,
      });
    });

    it("updates only the foreign rate when a foreign-scope state corp tax bill enacts", async () => {
      const { calculateStateRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        stateId: "US_CA",
        provisions: [
          {
            legislationTypeId: "us_state_foreign_corporate_tax_rate",
            policyOptionId: "rate_30",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_state_foreign_corporate_tax_rate",
        policyDomain: "tax",
        taxRateChange: { scope: "state", taxType: "foreignCorporateTax" },
        policyOptions: [{ id: "rate_30", effectDirection: 1, economic: -2, rate: 30 }],
      };
      const existingBudget = {
        _id: "US_CA",
        stateId: "US_CA",
        taxRates: {
          incomeTax: 5,
          salesTax: 7,
          domesticCorporateTax: 15,
          foreignCorporateTax: 15,
          propertyTax: 1.5,
        },
        revenue: { federalGrants: 100, total: 2000 },
        spending: { total: 1800 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("stateBudgets");
      db.collectionMocks["stateBudgets"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      // Only foreign rate moved; domestic untouched.
      expect(calculateStateRevenue).toHaveBeenCalledWith(
        expect.anything(),
        "US_CA",
        "US",
        expect.objectContaining({ domesticCorporateTax: 15, foreignCorporateTax: 30 }),
        100
      );
      const updateCall = db.collectionMocks["stateBudgets"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set).toMatchObject({
        taxRates: expect.objectContaining({ domesticCorporateTax: 15, foreignCorporateTax: 30 }),
      });
    });

    it("skips state tax-rate writes when the state budget has no taxRates payload", async () => {
      const { calculateStateRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        stateId: "US_CA",
        provisions: [
          {
            legislationTypeId: "us_state_domestic_corporate_tax_rate",
            policyOptionId: "rate_10",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_state_domestic_corporate_tax_rate",
        policyDomain: "tax",
        taxRateChange: { scope: "state", taxType: "domesticCorporateTax" },
        policyOptions: [{ id: "rate_10", effectDirection: 1, economic: 1, rate: 10 }],
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("stateBudgets");
      db.collectionMocks["stateBudgets"]!.findOne = vi.fn().mockResolvedValue({
        _id: "US_CA",
        stateId: "US_CA",
        taxRates: undefined,
        revenue: { federalGrants: 100, total: 2000 },
        spending: { total: 1800 },
      });

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateStateRevenue).not.toHaveBeenCalled();
      expect(db.collectionMocks["stateBudgets"]!.updateOne).not.toHaveBeenCalled();
    });

    it("skips state-scope tax changes when stateId is a national pseudo-id", async () => {
      const { calculateStateRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        stateId: "uk_national",
        provisions: [
          {
            legislationTypeId: "uk_bad_state_bill",
            policyOptionId: "rate_20",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "uk_bad_state_bill",
        policyDomain: "tax",
        taxRateChange: { scope: "state", taxType: "domesticCorporateTax" },
        policyOptions: [{ id: "rate_20", effectDirection: 1, rate: 20 }],
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("stateBudgets");
      db.collectionMocks["stateBudgets"]!.findOne = vi.fn().mockResolvedValue(null);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateStateRevenue).not.toHaveBeenCalled();
      expect(db.collectionMocks["stateBudgets"]!.updateOne).not.toHaveBeenCalled();
    });

    it("still handles federal-scope domestic corp tax bills via the federal branch", async () => {
      const { calculateFederalRevenue, calculateStateRevenue } =
        await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "us_federal_domestic_corporate_tax_rate",
            policyOptionId: "rate_15",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_federal_domestic_corporate_tax_rate",
        policyDomain: "tax",
        countryScope: "us",
        taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
        policyOptions: [{ id: "rate_15", effectDirection: 1, rate: 15 }],
      };
      const existingBudget = {
        _id: "federal",
        taxRates: {
          incomeTax: 22,
          domesticCorporateTax: 21,
          foreignCorporateTax: 21,
          payrollTax: 15.3,
          tariffs: 3,
          salesTax: 0,
        },
        spending: { total: 5_000_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      expect(calculateStateRevenue).not.toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      // Domestic rate moved (21 toward 15, one point this turn); foreign stays at 21.
      expect(updateCall[1].$set.taxRates).toMatchObject({
        domesticCorporateTax: 20,
        foreignCorporateTax: 21,
      });
      expect(updateCall[1].$set["taxRatePhaseIn.domesticCorporateTax"]).toBe(15);
    });

    it("enacting a federal foreign corp tax bill moves only the foreign rate", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "us_federal_foreign_corporate_tax_rate",
            policyOptionId: "rate_40",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_federal_foreign_corporate_tax_rate",
        policyDomain: "tax",
        countryScope: "us",
        taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
        policyOptions: [{ id: "rate_40", effectDirection: 1, rate: 40 }],
      };
      const existingBudget = {
        _id: "federal",
        taxRates: {
          incomeTax: 22,
          domesticCorporateTax: 21,
          foreignCorporateTax: 21,
          payrollTax: 15.3,
          tariffs: 3,
          salesTax: 0,
        },
        spending: { total: 5_000_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.taxRates).toMatchObject({
        domesticCorporateTax: 21,
        foreignCorporateTax: 22, // 21 toward 40, one point per turn
      });
    });

    it("skips federal tax-rate writes when the national budget has no taxRates payload", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "us_federal_domestic_corporate_tax_rate",
            policyOptionId: "rate_15",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "us_federal_domestic_corporate_tax_rate",
        policyDomain: "tax",
        countryScope: "us",
        taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
        policyOptions: [{ id: "rate_15", effectDirection: 1, rate: 15 }],
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue({
        _id: "federal",
        taxRates: undefined,
        spending: { total: 5_000_000_000_000 },
      });

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).not.toHaveBeenCalled();
      expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
    });

    it("enacting uk_foreign_corporation_tax writes foreignCorporateTax to UK national budget", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "uk_foreign_corporation_tax",
            policyOptionId: "rate_45",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "uk_foreign_corporation_tax",
        policyDomain: "tax",
        countryScope: "uk",
        taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
        policyOptions: [{ id: "rate_45", effectDirection: 1, rate: 45 }],
      };
      const existingBudget = {
        _id: "UK",
        taxRates: {
          incomeTax: 20,
          domesticCorporateTax: 19,
          foreignCorporateTax: 19,
          payrollTax: 12,
          tariffs: 0,
          salesTax: 20,
        },
        spending: { total: 1_000_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: "UK" });
      expect(updateCall[1].$set.taxRates).toMatchObject({
        domesticCorporateTax: 19,
        foreignCorporateTax: 20, // 19 toward 45, one point per turn
      });
    });

    // Ticket #1102 — a UK bill set VAT to 5% and customs duties to 2%, both
    // through tax-SLIDER provisions (no options ladder, the rate lives only on
    // `provision.proposedRate`). `onBillEnacted` rebuilt its provision list
    // without `proposedRate`, so the slider branch never fired and the country
    // collected nothing on either line for weeks.
    it("enacting a tax-slider provision writes the slider rate to the national budget", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "uk.tax.salesTax",
            policyOptionId: "rate:5",
            proposedRate: 5,
            effectDirection: 1,
            economic: -1,
            social: 0,
          },
        ] as never,
      });
      const legType = {
        _id: "uk.tax.salesTax",
        policyDomain: "tax",
        countryScope: "uk",
        taxRateChange: { scope: "federal", taxType: "salesTax" },
        taxSlider: {
          scope: "federal",
          taxType: "salesTax",
          minRate: 0,
          maxRate: 30,
          step: 1,
          baselineRate: 0,
          waypoints: [],
        },
      };
      const existingBudget = {
        _id: "UK",
        taxRates: {
          incomeTax: 36,
          domesticCorporateTax: 35,
          foreignCorporateTax: 39,
          payrollTax: 7.2,
          tariffs: 0,
          salesTax: 0,
        },
        spending: { total: 6_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 1954 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: "UK" });
      expect(updateCall[1].$set.taxRates).toMatchObject({
        salesTax: 1, // 0 toward 5, one point per turn
        // Unrelated lines are untouched.
        incomeTax: 36,
        tariffs: 0,
      });
    });

    it("enacting jp_foreign_corporation_tax writes foreignCorporateTax to JP national budget", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        provisions: [
          {
            legislationTypeId: "jp_foreign_corporation_tax",
            policyOptionId: "rate_52",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "jp_foreign_corporation_tax",
        policyDomain: "tax",
        countryScope: "jp",
        taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
        policyOptions: [{ id: "rate_52", effectDirection: 1, rate: 52 }],
      };
      const existingBudget = {
        _id: "JP",
        taxRates: {
          incomeTax: 20,
          domesticCorporateTax: 23,
          foreignCorporateTax: 23,
          payrollTax: 15,
          tariffs: 0,
          salesTax: 10,
        },
        spending: { total: 100_000_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: "JP" });
      expect(updateCall[1].$set.taxRates).toMatchObject({
        domesticCorporateTax: 23,
        foreignCorporateTax: 24, // 23 toward 52, one point per turn
      });
    });

    it("enacting de_income_tax_rate writes to the DE national budget", async () => {
      const { calculateFederalRevenue } = await import("@/lib/budget/revenue");
      const bill = createBill({
        stateId: "de_national",
        provisions: [
          {
            legislationTypeId: "de_income_tax_rate",
            policyOptionId: "rate_48",
            effectDirection: 1,
          },
        ],
      });
      const legType = {
        _id: "de_income_tax_rate",
        policyDomain: "tax",
        countryScope: "de",
        taxRateChange: { scope: "federal", taxType: "incomeTax" },
        policyOptions: [{ id: "rate_48", effectDirection: 1, rate: 48 }],
      };
      const existingBudget = {
        _id: "DE",
        taxRates: {
          incomeTax: 42,
          domesticCorporateTax: 15,
          foreignCorporateTax: 15,
          payrollTax: 20,
          tariffs: 0,
          salesTax: 19,
        },
        spending: { total: 900_000_000_000 },
      };

      setupCollection("legislationTypes", [legType]);
      setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

      await onBillEnacted(db as unknown as Db, bill as any, 10);

      expect(calculateFederalRevenue).toHaveBeenCalled();
      const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: "DE" });
      expect(updateCall[1].$set.taxRates).toMatchObject({
        incomeTax: 43, // 42 toward 48, one point per turn
        domesticCorporateTax: 15,
        foreignCorporateTax: 15,
      });
    });
  });

  it("handles UK countryId for archetype routing", async () => {
    const bill = createBill({
      stateId: "uk_national",
      provisions: [{ legislationTypeId: "uk-bill", effectDirection: 1 }],
      votes: { "507f1f77bcf86cd799439011": "for" },
    });
    const legType = createLegislationType("uk-bill", "healthcare");
    vi.mocked(calculateShiftImpacts).mockReturnValue({ "nhs-defender": 5 });

    setupCollection("legislationTypes", [legType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);
    setupCollection("characters", []);
    setupCollection("npps", []);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    expect(calculateShiftImpacts).toHaveBeenCalledWith(
      "healthcare",
      2, // center of the 5-option default type (#2899 — was hardcoded 3)
      expect.any(Number),
      "UK",
      expect.anything() // per-option position scores
    );
  });

  it("fires the Discord webhook for a tariff-only bill (no policy provisions)", async () => {
    const bill = {
      _id: new ObjectId(),
      title: "Universal Tariff Act",
      countryId: "US",
      provisions: [
        {
          type: "tariff" as const,
          scopeType: "economy_wide" as const,
          rate: 25,
        },
      ],
    };

    setupCollection("gameState", [{ _id: "current", currentYear: 2025 } as any]);

    await onBillEnacted(db as unknown as Db, bill as any, 10);

    // Webhook fires even though no policy provisions exist; previously the
    // function returned early at the policy-provision filter, dropping the event.
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "US",
      expect.objectContaining({
        description: expect.stringContaining("Universal Tariff Act"),
      })
    );
    // No policy work — no statePolicies upsert, no enacted-law record.
    expect(recordEnactedLaw).not.toHaveBeenCalled();
  });
});
