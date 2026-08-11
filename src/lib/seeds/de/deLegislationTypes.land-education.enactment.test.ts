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

describe("de_land_education bill enactment (PR5 state-scope regression)", () => {
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

  it("has allowedScope=state and 7 options with state-scope cost ladder", () => {
    const landEd = deLegislationTypes.find((t) => t._id === "de_land_education");
    expect(landEd).toBeDefined();
    expect(landEd!.allowedScope).toBe("state");
    expect(landEd!.nationalOnly).toBe(false);
    expect(landEd!.effectTarget?.scope).toBe("state");
    expect(landEd!.policyOptions).toHaveLength(7);
    expect(landEd!.policyOptions![0].annualCostPerCapita).toBe(600);
    expect(landEd!.policyOptions![6].annualCostPerCapita).toBe(0);
  });

  it("enacting option 0 (Universal Land Schooling) for BY writes state-scope snapshot", async () => {
    const landEd = deLegislationTypes.find((t) => t._id === "de_land_education");
    setupCollection("legislationTypes", [landEd]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Universal Land Schooling Act (Bayern)",
      billCountry: "de",
      stateId: "BY",
      provisions: [
        {
          legislationTypeId: "de_land_education",
          policyOptionId: "de_land_education_opt_0",
          effectDirection: 1,
          economic: -5,
          social: -5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "BY",
      legislationTypeId: "de_land_education",
    });
    expect(updateCall[1].$set).toMatchObject({
      scope: "state",
      policyOptionId: "de_land_education_opt_0",
      policyOptionIndex: 0,
      economic: -5,
      social: -5,
    });
  });

  it("enacting option 6 (Education Privatization) for BY writes state-scope snapshot", async () => {
    const landEd = deLegislationTypes.find((t) => t._id === "de_land_education");
    setupCollection("legislationTypes", [landEd]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Education Privatization Act (Bayern)",
      billCountry: "de",
      stateId: "BY",
      provisions: [
        {
          legislationTypeId: "de_land_education",
          policyOptionId: "de_land_education_opt_6",
          effectDirection: -1,
          economic: 5,
          social: 5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set).toMatchObject({
      scope: "state",
      policyOptionId: "de_land_education_opt_6",
      policyOptionIndex: 6,
      economic: 5,
      social: 5,
    });
  });
});
