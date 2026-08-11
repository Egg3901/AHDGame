import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { PartyBudget } from "@/lib/db/types";

// Drives processPartyGOTV through its real DB path (budgets NOT injected) to
// verify the voter-registration drive (player suggestion #81) end-to-end:
// treasury debit → per-state registration boost → matching pool draw → ledger.
// revenueOverride skips the fund-generation machinery so the test can assert
// exact magnitudes; the treasury/financial-tx side-channels are mocked.

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

describe("processPartyGOTV — voter registration drive (#81) DB path", () => {
  const bulkWrites: Record<string, CapturedOp[]> = {};
  const inserted: Record<string, unknown[]> = {};

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
        _id: "CA_1",
        countryId: "US",
        stateId: "CA",
        partyId: "1",
        organization: 20,
        registration: 5,
        treasury: 0,
      },
    ],
    politicalParties: [
      {
        _id: new ObjectId(),
        sequentialId: 1,
        countryId: "US",
        name: "Test Party",
        treasury: 1_000_000,
        nationalTaxRate: 10,
        economicPosition: 0,
        socialPosition: 0,
      },
    ],
    characters: [],
    npps: [],
    states: [
      { _id: "PA", population: 1000, gdp: 100, votingEligiblePopulation: 800 },
      { _id: "CA", population: 1000, gdp: 100, votingEligiblePopulation: 800 },
    ],
    stateRegistrationPool: [
      {
        _id: "US_PA",
        countryId: "US",
        stateId: "PA",
        independent: 20,
        unregistered: 30,
        lastUpdatedTurn: 0,
      },
      {
        _id: "US_CA",
        countryId: "US",
        stateId: "CA",
        independent: 20,
        unregistered: 30,
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

  it("debits treasury and applies a bounded pool-sourced registration boost", async () => {
    const { processPartyGOTV } = await import("@/lib/turn/demographicTurnoutTurn");

    // revenueOverride = 1000 → spend = 10% = 100; split across 2 states = 50/state;
    // boost = 50 / $5000-per-point = 0.01 pp (below the 0.1 cap → linear).
    await processPartyGOTV(undefined, [], undefined, 1000, undefined, undefined, undefined, 42);

    // Registration boost applied to each of the party's state rows.
    const spoOps = bulkWrites["statePartyOrg"] ?? [];
    const regByRow = new Map<string, number>();
    for (const op of spoOps) {
      const inc = op.updateOne?.update.$inc as { registration?: number } | undefined;
      if (inc?.registration !== undefined) {
        regByRow.set(op.updateOne!.filter._id as string, inc.registration);
      }
    }
    expect(regByRow.get("PA_1")).toBeCloseTo(0.01, 6);
    expect(regByRow.get("CA_1")).toBeCloseTo(0.01, 6);

    // Pool draw exactly matches the boost (100% invariant preserved).
    const poolOps = bulkWrites["stateRegistrationPool"] ?? [];
    expect(poolOps.length).toBe(2);
    for (const op of poolOps) {
      const inc = op.updateOne?.update.$inc as { unregistered: number; independent: number };
      expect(inc.unregistered).toBeCloseTo(-0.01, 6);
      expect(inc.independent).toBe(-0);
    }

    // Treasury debited by the full spend on the national party row.
    const partyOps = bulkWrites["politicalParties"] ?? [];
    const debit = partyOps.find(
      (op) => (op.updateOne?.update.$inc as { treasury?: number })?.treasury !== undefined
    );
    expect((debit?.updateOne?.update.$inc as { treasury: number }).treasury).toBe(-100);

    // Audit ledger written (reg gain + pool draw rows).
    const ledger = inserted["orgRegLedger"] ?? [];
    expect(ledger.some((r) => (r as { metric: string }).metric === "reg")).toBe(true);
    expect(ledger.some((r) => (r as { metric: string }).metric === "unregistered")).toBe(true);

    // National registration spend emitted as a treasury transaction.
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    expect(emitTreasuryTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ category: "operations", amount: 100 })
    );
  });
});
