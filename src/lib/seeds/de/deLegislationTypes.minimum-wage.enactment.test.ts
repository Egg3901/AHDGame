import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { onBillEnacted } from "@/lib/billEnactment";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { deLegislationTypes } from "./deLegislationTypes";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
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
  calculateFederalRevenue: vi.fn().mockResolvedValue({ total: 1_000_000 }),
  calculateStateRevenue: vi.fn().mockResolvedValue({ total: 100_000 }),
  normalizeFederalTaxRates: vi.fn((r) => r ?? null),
  normalizeStateTaxRates: vi.fn((r) => r ?? null),
}));
vi.mock("@/lib/budget/costs", () => ({
  getSelectedPolicyOption: vi.fn().mockReturnValue(undefined),
}));

describe("de_minimum_wage bill enactment (PR4 legacy-rewrite regression)", () => {
  let db: MockDb;

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
    });
    if (name === "gameState") {
      db.collectionMocks[name]!.findOne = vi.fn().mockResolvedValue(data[0] ?? null);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("verifies the 7-option layout with minimumWageRate", () => {
    const minwage = deLegislationTypes.find((t) => t._id === "de_minimum_wage");
    expect(minwage).toBeDefined();
    expect(minwage!.policyOptions).toHaveLength(7);
    const opts = minwage!.policyOptions!;
    expect(opts[0].minimumWageRate).toBe(0); // Abolition
    expect(opts[3].minimumWageRate).toBe(12); // Statutory
    expect(opts[6].minimumWageRate).toBe(18); // Universal Living Wage
    expect(opts[0].annualCostPerCapita).toBeUndefined();
    expect(opts[6].annualCostPerCapita).toBeUndefined();
  });

  it("enacting option 0 (Minimum Wage Abolition Act) writes right-stance + €0/hr snapshot", async () => {
    const minwage = deLegislationTypes.find((t) => t._id === "de_minimum_wage");
    setupCollection("legislationTypes", [minwage]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Minimum Wage Abolition Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_minimum_wage",
          policyOptionId: "de_minimum_wage_opt_0",
          effectDirection: -1,
          economic: 5,
          social: 0,
          minimumWageRate: 0,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "de_national",
      legislationTypeId: "de_minimum_wage",
    });
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_minimum_wage_opt_0",
      policyOptionIndex: 0,
      economic: 5,
      social: 0,
    });
  });

  it("enacting option 6 (Universal Living Wage Act) writes left-stance + €18/hr snapshot", async () => {
    const minwage = deLegislationTypes.find((t) => t._id === "de_minimum_wage");
    setupCollection("legislationTypes", [minwage]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Universal Living Wage Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_minimum_wage",
          policyOptionId: "de_minimum_wage_opt_6",
          effectDirection: 1,
          economic: -5,
          social: 0,
          minimumWageRate: 18,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_minimum_wage_opt_6",
      policyOptionIndex: 6,
      economic: -5,
      social: 0,
    });
  });
});
