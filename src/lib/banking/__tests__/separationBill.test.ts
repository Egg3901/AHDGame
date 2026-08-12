import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { onBillEnacted } from "@/lib/billEnactment";
import { getLegalCharterTypes } from "@/lib/banking/separationLaw";
import {
  applySeparationBill,
  isBankingSeparationLegislationType,
  separationPolicyFromOptionId,
} from "@/lib/banking/separationBill";
import { bankingSeparationLegislationTypes } from "@/lib/seeds/shared/bankingSeparationLegislation";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

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
vi.mock("@/lib/budget/spending", () => ({
  syncFederalBudgetSpending: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

describe("banking separation legislation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("catalog entry exists for a sample of countries with separated/universal options", () => {
    const sampleScopes = ["us", "uk", "de", "jp", "fr", "br", "ng"];
    for (const scope of sampleScopes) {
      const entry = bankingSeparationLegislationTypes.find((t) => t.countryScope === scope);
      expect(entry, `missing banking separation for ${scope}`).toBeDefined();
      expect(isBankingSeparationLegislationType(entry!._id)).toBe(true);
      const opts = entry!.policyOptions ?? [];
      expect(opts).toHaveLength(2);
      expect(separationPolicyFromOptionId(opts[0].id)).toBe("separated");
      expect(separationPolicyFromOptionId(opts[1].id)).toBe("universal");
      // Also registered in the live seed catalog aggregator
      expect(legislationTypes.some((t) => t._id === entry!._id)).toBe(true);
    }
  });

  it("applySeparationBill writes bankingLaws and getLegalCharterTypes flips", async () => {
    db.collection("bankingLaws");
    db.collection("gameState");
    db.collection("gameConfig");

    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2020,
    });
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      commandEconomyEnabled: false,
    });
    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue(null);

    const before = await getLegalCharterTypes(db as unknown as Db, "US");
    expect(before).toEqual(["retail", "investment", "universal"]);

    await applySeparationBill(db as unknown as Db, "US", "separated", "bill-1", 40);

    const [, update] = db.collectionMocks.bankingLaws!.updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      _id: "US",
      separation: "separated",
      enactedTurn: 40,
      billId: "bill-1",
    });

    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
      _id: "US",
      separation: "separated",
    });
    const afterSeparated = await getLegalCharterTypes(db as unknown as Db, "US");
    expect(afterSeparated).toEqual(["retail", "investment"]);

    await applySeparationBill(db as unknown as Db, "US", "universal", "bill-2", 41);
    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
      _id: "US",
      separation: "universal",
    });
    const afterUniversal = await getLegalCharterTypes(db as unknown as Db, "US");
    expect(afterUniversal).toEqual(["retail", "investment", "universal"]);
  });

  it("onBillEnacted wires applySeparationBill for us_banking_separation", async () => {
    const usType = bankingSeparationLegislationTypes.find((t) => t._id === "us_banking_separation");
    expect(usType).toBeDefined();

    db.collection("legislationTypes");
    db.collection("gameState");
    db.collection("statePolicies");
    db.collection("bankingLaws");

    db.collectionMocks.legislationTypes!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([usType]),
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2020,
      currentTurn: 30,
    });
    db.collectionMocks.statePolicies!.findOne.mockResolvedValue(null);
    db.collectionMocks.statePolicies!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });
    db.collectionMocks.bankingLaws!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });

    const billId = new ObjectId();
    const bill = {
      _id: billId,
      title: "Enact Banking Separation Act",
      countryId: "US" as const,
      stateId: "federal",
      provisions: [
        {
          legislationTypeId: "us_banking_separation",
          policyOptionId: "us_banking_separation_separated",
          effectDirection: 1,
          economic: -3,
          social: 0,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as never, 30);

    expect(db.collectionMocks.bankingLaws!.updateOne).toHaveBeenCalled();
    const [filter, update] = db.collectionMocks.bankingLaws!.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "US" });
    expect(update.$set).toMatchObject({
      separation: "separated",
      enactedTurn: 30,
      billId: billId.toString(),
    });
  });
});
