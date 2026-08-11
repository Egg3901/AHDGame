import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("federalBudget");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

function budgetDoc(overrides: Record<string, unknown>) {
  return {
    _id: "CN",
    countryId: "CN",
    gdp: 48_000, // makes per-turn slicing easy: /48
    revenue: { total: 48_000 },
    spending: { total: 0, debtInterest: 0 },
    debt: { principal: 0, interestRate: 0, ceiling: 1_000_000, ceilingLastRaisedYear: 2019 },
    debtToGdpRatio: 0,
    investorConfidence: 70,
    treasuryBalance: 0,
    ...overrides,
  };
}

function mockBudgets(docs: Record<string, unknown>[]) {
  db.collectionMocks.federalBudget.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
}

describe("processTreasuryTurn", () => {
  it("credits one turn's primary surplus and resyncs derived fields", async () => {
    mockBudgets([budgetDoc({})]);
    const { processTreasuryTurn } = await import("./treasuryTurn");
    await processTreasuryTurn(10);
    // revenue 48_000, spending-ex-interest 0 ⇒ primary/turn = 48_000/48 = 1_000
    const upd = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(upd.treasuryBalance).toBe(1_000);
    expect(upd["debt.principal"]).toBe(0); // still in surplus
  });

  it("accrues debt-service while negative (the spiral)", async () => {
    mockBudgets([budgetDoc({ treasuryBalance: -48_000, revenue: { total: 0 } })]);
    const { processTreasuryTurn } = await import("./treasuryTurn");
    await processTreasuryTurn(10);
    const upd = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    // primary 0; debt-service > 0 ⇒ balance drops below -48_000.
    expect(upd.treasuryBalance).toBeLessThan(-48_000);
    expect(upd["debt.principal"]).toBeGreaterThan(48_000);
  });

  it("heals a null treasuryBalance from -debt.principal, then accrues this turn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No treasuryBalance; principal 0; revenue 48_000 ⇒ inits to 0 then +1_000.
    const doc = budgetDoc({});
    delete (doc as Record<string, unknown>).treasuryBalance;
    mockBudgets([doc]);
    const { processTreasuryTurn } = await import("./treasuryTurn");
    const res = await processTreasuryTurn(10);
    expect(res.countriesProcessed).toBe(1);
    const upd = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(upd.treasuryBalance).toBe(1_000);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("heals a null balance from existing debt (negative start)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // principal 48_000 ⇒ inits to -48_000; revenue 0 ⇒ debt-service pushes lower.
    const doc = budgetDoc({
      revenue: { total: 0 },
      debt: {
        principal: 48_000,
        interestRate: 0.05,
        ceiling: 1_000_000,
        ceilingLastRaisedYear: 2019,
      },
    });
    delete (doc as Record<string, unknown>).treasuryBalance;
    mockBudgets([doc]);
    const { processTreasuryTurn } = await import("./treasuryTurn");
    await processTreasuryTurn(10);
    const upd = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(upd.treasuryBalance).toBeLessThan(-48_000);
    warn.mockRestore();
  });

  it("does NOT accrue interest while positive (savings flat, ex-primary)", async () => {
    mockBudgets([
      budgetDoc({
        treasuryBalance: 10_000,
        revenue: { total: 0 },
        spending: { total: 0, debtInterest: 0 },
      }),
    ]);
    const { processTreasuryTurn } = await import("./treasuryTurn");
    await processTreasuryTurn(10);
    const upd = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(upd.treasuryBalance).toBe(10_000); // unchanged: no primary, no interest on savings
  });
});
