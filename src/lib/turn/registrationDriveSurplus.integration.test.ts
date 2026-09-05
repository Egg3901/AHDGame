import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { PartyBudget } from "@/lib/db/types";

// Companion to registrationDrive.integration.test.ts, for the case that made
// the feature inert in every saturated country: the state's Independent +
// Unregistered pool is EMPTY. Every US pool has read 0 since live turn ~155
// (RU ~176, UK ~143), so a fully funded drive applied nothing at all. The
// shortfall must now come from parties holding Reg above their own Org target,
// exactly as passive drift does.

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/collections", () => ({
  getPartyBudgetCollection: vi.fn(),
  getStateDemographicTurnoutCollection: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: vi.fn().mockResolvedValue({}),
  emitTxBulk: vi.fn(),
}));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransaction: vi.fn() }));

interface CapturedOp {
  updateOne?: { filter: Record<string, unknown>; update: Record<string, unknown> };
}

describe("processPartyGOTV — registration drive with an exhausted pool", () => {
  const bulkWrites: Record<string, CapturedOp[]> = {};
  const inserted: Record<string, unknown[]> = {};

  // Buyer (party 1) sits far below its Org target; donor (party 2) holds 40%
  // Reg against 10% Org, i.e. 30 pp of surplus. The pool is empty.
  const data: Record<string, unknown[]> = {
    statePartyOrg: [
      {
        _id: "PA_1",
        countryId: "US",
        stateId: "PA",
        partyId: "1",
        organization: 20,
        registration: 5,
        treasury: 0,
      },
      {
        _id: "PA_2",
        countryId: "US",
        stateId: "PA",
        partyId: "2",
        organization: 10,
        registration: 40,
        treasury: 0,
      },
    ],
    politicalParties: [
      {
        _id: new ObjectId(),
        sequentialId: 1,
        countryId: "US",
        name: "Buyer Party",
        treasury: 1_000_000,
        nationalTaxRate: 10,
        economicPosition: 0,
        socialPosition: 0,
      },
      {
        _id: new ObjectId(),
        sequentialId: 2,
        countryId: "US",
        name: "Donor Party",
        treasury: 1_000_000,
        nationalTaxRate: 10,
        economicPosition: 0,
        socialPosition: 0,
      },
    ],
    characters: [],
    npps: [],
    states: [{ _id: "PA", population: 1000, gdp: 100, votingEligiblePopulation: 800 }],
    stateRegistrationPool: [
      {
        _id: "US_PA",
        countryId: "US",
        stateId: "PA",
        independent: 0,
        unregistered: 0,
        lastUpdatedTurn: 0,
      },
    ],
  };

  const budget: PartyBudget = {
    _id: new ObjectId(),
    partyId: "1",
    countryId: "US",
    scope: "national",
    gotvBudgetPerTurn: 0,
    gotvBudgetPercent: 0,
    suppressionBudgetPercent: 0,
    orgBuildingPercent: 0,
    registrationBudgetPercent: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(bulkWrites)) delete bulkWrites[k];
    for (const k of Object.keys(inserted)) delete inserted[k];

    const collection = (name: string) => ({
      find: () => ({ toArray: async () => data[name] ?? [] }),
      findOne: async () =>
        name === "gameConfig" ? { _id: "default", nppEconomyEnabled: false } : null,
      bulkWrite: async (ops: CapturedOp[]) => {
        (bulkWrites[name] ??= []).push(...ops);
      },
      insertMany: async (docs: unknown[]) => {
        (inserted[name] ??= []).push(...docs);
      },
    });
    const mockDb = { collection: (name: string) => collection(name) };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getPartyBudgetCollection } = await import("@/lib/db/collections");
    vi.mocked(getPartyBudgetCollection).mockResolvedValue({
      find: () => ({ toArray: async () => [budget] }),
    } as never);
  });

  it("sources the boost from an over-registered rival when the pool is empty", async () => {
    const { processPartyGOTV } = await import("@/lib/turn/demographicTurnoutTurn");

    // revenueOverride = 1000 → spend = 10% = 100; one state → 100/state;
    // boost = 100 / $5000-per-point = 0.02 pp (below the 0.1 cap).
    await processPartyGOTV(undefined, [], undefined, 1000, undefined, undefined, undefined, 42);

    const spoOps = bulkWrites["statePartyOrg"] ?? [];
    const regByRow = new Map<string, number>();
    for (const op of spoOps) {
      const inc = op.updateOne?.update.$inc as { registration?: number } | undefined;
      if (inc?.registration !== undefined) {
        regByRow.set(op.updateOne!.filter._id as string, inc.registration);
      }
    }

    // The buyer gains the full boost even though the pool had nothing to give.
    expect(regByRow.get("PA_1")).toBeCloseTo(0.02, 6);
    // The donor funds it out of its surplus — conserving the 100% invariant
    // without any pool capacity.
    expect(regByRow.get("PA_2")).toBeCloseTo(-0.02, 6);

    // Nothing was drawn from the empty pool.
    const poolOps = bulkWrites["stateRegistrationPool"] ?? [];
    for (const op of poolOps) {
      const inc = op.updateOne?.update.$inc as
        { unregistered?: number; independent?: number } | undefined;
      expect(inc?.unregistered ?? 0).toBeCloseTo(0, 6);
      expect(inc?.independent ?? 0).toBeCloseTo(0, 6);
    }

    // Treasury is debited, because the drive actually delivered this time.
    const partyOps = bulkWrites["politicalParties"] ?? [];
    const debit = partyOps.find(
      (op) => (op.updateOne?.update.$inc as { treasury?: number })?.treasury !== undefined
    );
    expect((debit?.updateOne?.update.$inc as { treasury: number }).treasury).toBe(-100);

    // Both sides of the transfer are on the audit ledger.
    const ledger = inserted["orgRegLedger"] ?? [];
    const regRows = ledger.filter((r) => (r as { metric: string }).metric === "reg");
    expect(regRows.some((r) => (r as { delta: number }).delta > 0)).toBe(true);
    expect(regRows.some((r) => (r as { delta: number }).delta < 0)).toBe(true);
  });

  it("applies nothing and charges nothing when no rival holds surplus", async () => {
    const donor = data.statePartyOrg[1] as { registration: number };
    const originalReg = donor.registration;
    donor.registration = 10; // exactly at its Org target — no surplus to give
    try {
      const { processPartyGOTV } = await import("@/lib/turn/demographicTurnoutTurn");
      await processPartyGOTV(undefined, [], undefined, 1000, undefined, undefined, undefined, 42);

      const spoOps = bulkWrites["statePartyOrg"] ?? [];
      const regInc = spoOps.filter(
        (op) => (op.updateOne?.update.$inc as { registration?: number })?.registration !== undefined
      );
      expect(regInc).toHaveLength(0);

      // A drive that delivered nothing must not bill the party for it.
      const partyOps = bulkWrites["politicalParties"] ?? [];
      const debit = partyOps.find(
        (op) => (op.updateOne?.update.$inc as { treasury?: number })?.treasury !== undefined
      );
      expect(debit).toBeUndefined();
    } finally {
      donor.registration = originalReg;
    }
  });
});
