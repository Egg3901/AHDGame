import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { buildBill, getMembers, getConflict, autonomyActive, loadWorldPreset } = vi.hoisted(() => ({
  buildBill: vi.fn(),
  getMembers: vi.fn(),
  getConflict: vi.fn(),
  autonomyActive: vi.fn(),
  loadWorldPreset: vi.fn().mockResolvedValue("1953-default"),
}));

vi.mock("@/lib/internationalOrganizations/commands/buildJoinConflictBill", () => ({
  buildJoinConflictBill: (...args: unknown[]) => buildBill(...args),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: (...args: unknown[]) => getMembers(...args),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({
  getConflict: (...args: unknown[]) => getConflict(...args),
}));
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => autonomyActive(...args),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: (...args: unknown[]) => loadWorldPreset(...args),
}));

import { reconcileAutonomousWarEntryBills } from "./reconcileAutonomousWarEntry";

const resolutionId = new ObjectId();
const resolution = {
  _id: resolutionId,
  organizationId: "NATO",
  type: "join_conflict",
  title: "NATO Entry into the War for Germany",
  parties: [],
  proposingCountryId: "US",
  proposedByCharacterId: new ObjectId(),
  status: "active",
  votes: [],
  joinConflictTheaterId: "germany",
  joinConflictSide: "A",
};

function setup(existingBills: unknown[] = []): MockDb {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    nppForeignPolicyMode: "active",
  });
  db.collection("organizationLegislation").find().toArray.mockResolvedValue([resolution]);
  db.collection("bills").find().toArray.mockResolvedValue(existingBills);
  db.collection("governmentFormations").findOne.mockImplementation(
    async ({ _id }: { _id: string }) =>
      _id === "FR"
        ? { _id: "FR", countryId: "FR", status: "formed", pmNppId: new ObjectId() }
        : null
  );
  db.collection("npps").findOne.mockResolvedValue({
    _id: new ObjectId(),
    countryId: "FR",
    name: "French Premier",
    party: "1",
  });
  return db;
}

beforeEach(() => {
  buildBill.mockReset().mockResolvedValue(undefined);
  getMembers.mockReset().mockResolvedValue(["US", "FR", "BE"]);
  getConflict.mockReset().mockResolvedValue({
    _id: "germany",
    name: "The War for Germany",
    status: "active",
    sideA: { label: "United States", countries: ["US"] },
    sideB: { label: "East Germany", countries: ["DD", "RU"] },
  });
  autonomyActive
    .mockReset()
    .mockImplementation(async (_db: Db, countryId: string) => countryId === "FR");
});

describe("reconcileAutonomousWarEntryBills", () => {
  it("files the missing national bill for a policy-active autonomous member", async () => {
    const db = setup();

    await expect(reconcileAutonomousWarEntryBills(db as unknown as Db)).resolves.toBe(1);

    expect(buildBill).toHaveBeenCalledTimes(1);
    expect(buildBill).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "FR",
        organizationId: "NATO",
        provision: expect.objectContaining({
          theaterId: "germany",
          side: "A",
          resolutionId: resolutionId.toString(),
        }),
        sponsor: expect.objectContaining({ isNpp: true, characterName: "French Premier" }),
      })
    );
  });

  it("backfills pressure without duplicating an existing war-entry bill", async () => {
    const billId = new ObjectId();
    const db = setup([
      {
        _id: billId,
        countryId: "FR",
        status: "active_both",
        provisions: [
          {
            type: "join_conflict",
            theaterId: "germany",
            side: "A",
            organizationId: "NATO",
            resolutionId: resolutionId.toString(),
          },
        ],
      },
    ]);

    await expect(reconcileAutonomousWarEntryBills(db as unknown as Db)).resolves.toBe(1);
    expect(buildBill).not.toHaveBeenCalled();
    expect(db.collection("bills").updateOne).toHaveBeenCalledWith(
      { _id: billId },
      expect.objectContaining({
        $set: expect.objectContaining({
          "provisions.$[entry].entryStake": "discretionary",
          "provisions.$[entry].politicalPressure": expect.any(Object),
        }),
      }),
      expect.objectContaining({ arrayFilters: expect.any(Array) })
    );
  });

  it("stays off until autonomous foreign policy is active", async () => {
    const db = setup();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "shadow",
    });

    await expect(reconcileAutonomousWarEntryBills(db as unknown as Db)).resolves.toBe(0);
    expect(buildBill).not.toHaveBeenCalled();
  });
});
