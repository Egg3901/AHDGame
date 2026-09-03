import { describe, expect, it } from "vitest";
import { planSavingsMigration, renderMigrationPlan, type MigrationCharterInput } from "./migration";

const BANK = "a".repeat(24);
const INVESTMENT = "b".repeat(24);
const DEAD = "d".repeat(24);

function charter(over: Partial<MigrationCharterInput> = {}): MigrationCharterInput {
  return {
    bankId: BANK,
    currency: "USD",
    status: "active",
    acceptsDeposits: true,
    cashReserves: 500,
    npcDeposits: 2_000,
    totalDeposits: 3_000,
    totalLoans: 1_800,
    borrowings: 0,
    ...over,
  };
}

describe("planSavingsMigration", () => {
  it("plans accounts, backing transfers and post-recognition balance sheets per currency", () => {
    const plan = planSavingsMigration({
      rows: [
        { ownerId: "p1", currency: "USD", savings: 600, savingsHolder: BANK },
        { ownerId: "p2", currency: "USD", savings: 400, savingsHolder: BANK },
        { ownerId: "p3", currency: "USD", savings: 250, savingsHolder: null },
        { ownerId: "p4", currency: "GBP", savings: 10, savingsHolder: null },
      ],
      charters: [charter()],
      poolByCurrency: new Map([
        ["USD", 5_000],
        ["GBP", 0],
      ]),
      reserveRatioByCurrency: new Map([["USD", 0.1]]),
    });
    expect(plan.ok).toBe(true);
    const usd = plan.currencies.find((c) => c.currency === "USD")!;
    expect(usd).toMatchObject({
      accountsToCreate: 3,
      ownerTotal: 1_250,
      centralBankHeld: 250,
      bankHeld: 1_000,
      backingRequired: 1_000,
      poolAvailable: 5_000,
      poolShortfall: 0,
      aggregateDifference: 0,
    });
    expect(usd.banks[0]).toMatchObject({
      accounts: 2,
      liability: 1_000,
      backingTransfer: 1_000,
      charterPointerDeposits: 1_000,
      cashAfter: 1_500,
      requiredReservesAfter: 300,
      reserveBreach: false,
      // 1500 + 1800 - 3000 = 300
      equityAfter: 300,
      solvencyBreach: false,
    });
    expect(plan.currencies.find((c) => c.currency === "GBP")).toMatchObject({
      accountsToCreate: 1,
      bankHeld: 0,
    });
  });

  it("flags banks that would breach reserves or equity once the liability is real", () => {
    const plan = planSavingsMigration({
      rows: [{ ownerId: "p1", currency: "USD", savings: 10_000, savingsHolder: BANK }],
      charters: [
        charter({
          cashReserves: 100,
          npcDeposits: 20_000,
          totalDeposits: 30_000,
          totalLoans: 5_000,
        }),
      ],
      poolByCurrency: new Map([["USD", 100_000]]),
      reserveRatioByCurrency: new Map([["USD", 0.5]]),
    });
    const bank = plan.currencies[0].banks[0];
    // cash 10_100 vs required 15_000; equity 10_100 + 5_000 - 30_000 < 0
    expect(bank.reserveBreach).toBe(true);
    expect(bank.solvencyBreach).toBe(true);
    // Breaches are reported, not invariants: the plan still describes them.
    expect(plan.ok).toBe(true);
  });

  it("reassigns rows pointing at a dead or non-deposit-taking holder to the central bank", () => {
    const plan = planSavingsMigration({
      rows: [
        { ownerId: "p1", currency: "USD", savings: 100, savingsHolder: DEAD },
        { ownerId: "p2", currency: "USD", savings: 50, savingsHolder: INVESTMENT },
      ],
      charters: [charter(), charter({ bankId: INVESTMENT, acceptsDeposits: false })],
      poolByCurrency: new Map([["USD", 1_000]]),
      reserveRatioByCurrency: new Map([["USD", 0.1]]),
    });
    expect(plan.ok).toBe(true);
    const usd = plan.currencies[0];
    expect(usd.centralBankHeld).toBe(150);
    expect(usd.bankHeld).toBe(0);
    expect(usd.unmappable.map((u) => [u.reason, u.remedy])).toEqual([
      ["unknown_holder", "reassign_to_central_bank"],
      ["holder_not_deposit_taking", "reassign_to_central_bank"],
    ]);
  });

  it("blocks on a short pool, negative balances and duplicate rows", () => {
    const plan = planSavingsMigration({
      rows: [
        { ownerId: "p1", currency: "USD", savings: 900, savingsHolder: BANK },
        { ownerId: "p1", currency: "USD", savings: 900, savingsHolder: BANK },
        { ownerId: "p2", currency: "USD", savings: -5, savingsHolder: null },
      ],
      charters: [charter()],
      poolByCurrency: new Map([["USD", 100]]),
      reserveRatioByCurrency: new Map([["USD", 0.1]]),
    });
    expect(plan.ok).toBe(false);
    expect(plan.invariantFailures.join("\n")).toMatch(/duplicate/);
    expect(plan.invariantFailures.join("\n")).toMatch(/negative/);
    expect(plan.invariantFailures.join("\n")).toMatch(/short by 800/);
    expect(renderMigrationPlan(plan)).toMatch(/PLAN BLOCKED/);
  });

  it("counts accounts that already exist from an earlier partial run", () => {
    const plan = planSavingsMigration({
      rows: [
        { ownerId: "p1", currency: "USD", savings: 1, savingsHolder: null },
        { ownerId: "p2", currency: "USD", savings: 1, savingsHolder: null },
      ],
      charters: [],
      poolByCurrency: new Map(),
      reserveRatioByCurrency: new Map(),
      existingAccountKeys: new Set(["p1:USD"]),
    });
    expect(plan.currencies[0]).toMatchObject({ accountsToCreate: 1, accountsExisting: 1 });
    expect(renderMigrationPlan(plan)).toMatch(/PLAN OK/);
  });
});
