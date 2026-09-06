import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { onBillEnacted } from "@/lib/billEnactment";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { deLegislationTypes } from "./deLegislationTypes";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
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

describe("de_bundeswehr_funding bill enactment (PR3 inverted-cost regression)", () => {
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

  it("verifies the inverted cost ladder is correctly seeded", () => {
    const bundeswehr = deLegislationTypes.find((t) => t._id === "de_bundeswehr_funding");
    expect(bundeswehr).toBeDefined();
    const opts = bundeswehr!.policyOptions!;
    expect(opts[0].annualCostPerCapita).toBe(60); // Pacifist
    expect(opts[3].annualCostPerCapita).toBe(640); // Statutory
    expect(opts[6].annualCostPerCapita).toBe(1500); // Maximum
    expect(opts[0].annualCostPerCapita!).toBeLessThan(opts[6].annualCostPerCapita!);
  });

  it("enacting option 0 (Pacifist Bundeswehr Act) writes left-stance + low-cost snapshot", async () => {
    const bundeswehr = deLegislationTypes.find((t) => t._id === "de_bundeswehr_funding");
    setupCollection("legislationTypes", [bundeswehr]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Pacifist Bundeswehr Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_bundeswehr_funding",
          policyOptionId: "de_bundeswehr_funding_opt_0",
          effectDirection: 1,
          economic: 5,
          social: -5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "de_national",
      legislationTypeId: "de_bundeswehr_funding",
    });
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_bundeswehr_funding_opt_0",
      policyOptionIndex: 0,
      economic: 5,
      social: -5,
    });
  });

  it("enacting option 6 (Maximum Bundeswehr Investment Act) writes right-stance + high-cost snapshot", async () => {
    const bundeswehr = deLegislationTypes.find((t) => t._id === "de_bundeswehr_funding");
    setupCollection("legislationTypes", [bundeswehr]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Maximum Bundeswehr Investment Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_bundeswehr_funding",
          policyOptionId: "de_bundeswehr_funding_opt_6",
          effectDirection: -1,
          economic: -5,
          social: 5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_bundeswehr_funding_opt_6",
      policyOptionIndex: 6,
      economic: -5,
      social: 5,
    });
  });
});
