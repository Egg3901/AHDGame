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

import { recordEnactedLaw } from "@/lib/budget/enactedLaws";

describe("de_pension_system bill enactment (PR2 regression)", () => {
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

  it("enacting option 0 (Universal Pension Guarantee Act) writes leftmost policy snapshot", async () => {
    const pensionType = deLegislationTypes.find((t) => t._id === "de_pension_system");
    expect(pensionType).toBeDefined();

    const optionZero = pensionType!.policyOptions![0];
    expect(optionZero.id).toBe("de_pension_system_opt_0");
    expect(optionZero.stance).toBe("left");
    expect(optionZero.economic).toBe(-5);
    expect(optionZero.social).toBe(-5);

    setupCollection("legislationTypes", [pensionType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Universal Pension Guarantee Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_pension_system",
          policyOptionId: "de_pension_system_opt_0",
          effectDirection: 1,
          economic: -5,
          social: -5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    expect(recordEnactedLaw).toHaveBeenCalledTimes(1);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({
      stateId: "de_national",
      legislationTypeId: "de_pension_system",
    });
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_pension_system_opt_0",
      policyOptionIndex: 0,
      economic: -5,
      social: -5,
    });
  });

  it("enacting option 6 (Pension System Abolition Act) writes rightmost policy snapshot", async () => {
    const pensionType = deLegislationTypes.find((t) => t._id === "de_pension_system");

    setupCollection("legislationTypes", [pensionType]);
    setupCollection("gameState", [{ _id: "current", currentYear: 2020 } as any]);

    const bill = {
      _id: new ObjectId(),
      title: "Enact Pension System Abolition Act",
      billCountry: "de",
      stateId: "de_national",
      provisions: [
        {
          legislationTypeId: "de_pension_system",
          policyOptionId: "de_pension_system_opt_6",
          effectDirection: -1,
          economic: 5,
          social: 5,
        },
      ],
    };

    await onBillEnacted(db as unknown as Db, bill as any, 30);

    const updateCall = db.collectionMocks["statePolicies"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set).toMatchObject({
      scope: "national",
      policyOptionId: "de_pension_system_opt_6",
      policyOptionIndex: 6,
      economic: 5,
      social: 5,
    });
  });
});
