import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { runSavingsMigration } from "@/lib/savings/migration";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const BANK = new ObjectId();
const DEAD = new ObjectId();
const P1 = new ObjectId();
const P2 = new ObjectId();
const P3 = new ObjectId();

function world(mode: "shadow" | "authoritative", readCurrencies: string[] = []): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, savingsAccountsMode: mode, savingsAccountsReadCurrencies: readCurrencies },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: 90, preset: "2019-default" }]);
  db.seed("centralBanks", [{ _id: "US", countryId: "US", externalBroadMoney: 10_000, bankReserveRequirement: 0.1 }]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Holder Bank",
      bankCharter: { type: "retail", status: "active", currency: "USD", cashReserves: 500, npcDeposits: 2_000, totalDeposits: 3_000, totalLoans: 1_000 },
    },
    { _id: DEAD, name: "Dead Bank", bankCharter: { type: "retail", status: "revoked", currency: "USD", cashReserves: 0 } },
  ]);
  db.seed("characters", [
    { _id: P1, name: "One", currencyBalances: { savings: { USD: 700 }, savingsHolder: { USD: BANK.toString() }, pendingSavingsInterest: { USD: 1.5 } } },
    { _id: P2, name: "Two", currencyBalances: { savings: { USD: 300 } } },
    { _id: P3, name: "Three", currencyBalances: { savings: { USD: 50 }, savingsHolder: { USD: DEAD.toString() } } },
  ]);
  return db;
}

function accounts(db: InMemoryDb): SavingsAccount[] {
  return db.collection("savingsAccounts").docs as unknown as SavingsAccount[];
}
function pool(db: InMemoryDb): number {
  return (db.collection("centralBanks").docs[0] as { externalBroadMoney: number }).externalBroadMoney;
}
function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as { bankCharter: { cashReserves: number; playerDeposits?: number } };
}

describe("runSavingsMigration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("refuses to write unless the rollout mode is authoritative", async () => {
    const db = world("shadow");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { plan, batches } = await runSavingsMigration(db as unknown as Db, 90);
    expect(plan.ok).toBe(true);
    expect(batches[0]).toMatchObject({ currency: "USD", applied: 0, reconciled: false });
    expect(batches[0].error).toMatch(/authoritative/);
    expect(accounts(db)).toHaveLength(0);
    expect(pool(db)).toBe(10_000);
  });

  it("refuses a currency that already reads from accounts", async () => {
    const db = world("authoritative", ["USD"]);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { batches } = await runSavingsMigration(db as unknown as Db, 90);
    expect(batches[0].error).toMatch(/already reads/);
    expect(accounts(db)).toHaveLength(0);
  });

  it("creates accounts, moves backing, recognizes liabilities, reconciles, and resumes idempotently", async () => {
    const db = world("authoritative");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const first = await runSavingsMigration(db as unknown as Db, 90);
    expect(first.plan.ok).toBe(true);
    expect(first.batches[0]).toMatchObject({ currency: "USD", applied: 3, replayed: 0, failed: 0, reconciled: true, discrepancies: 0 });

    const rows = accounts(db);
    expect(rows).toHaveLength(3);
    const one = rows.find((a) => a.ownerId.equals(P1))!;
    expect(one).toMatchObject({ balance: 700, holder: BANK.toString(), accruedInterest: 1.5, version: 0, status: "open" });
    const three = rows.find((a) => a.ownerId.equals(P3))!;
    // A dead holder is reassigned to the central bank, balance untouched.
    expect(three).toMatchObject({ balance: 50, holder: "centralBank" });
    expect((db.collection("characters").docs[2] as { currencyBalances: { savingsHolder: { USD: string } } }).currencyBalances.savingsHolder.USD).toBe("centralBank");

    // Backing for the bank-held balance moved pool -> vault; the bank now owes it.
    expect(pool(db)).toBe(10_000 - 700);
    expect(bank(db).bankCharter.cashReserves).toBe(1_200);
    expect(bank(db).bankCharter.playerDeposits).toBe(700);
    expect((db.collection("centralBanks").docs[0] as { householdSavingsLiability: number }).householdSavingsLiability).toBe(350);

    // Displayed balances never changed.
    const savings = (db.collection("characters").docs as { currencyBalances: { savings: { USD: number } } }[]).map((c) => c.currencyBalances.savings.USD);
    expect(savings).toEqual([700, 300, 50]);

    const second = await runSavingsMigration(db as unknown as Db, 91);
    expect(second.batches[0]).toMatchObject({ applied: 0, replayed: 3, failed: 0, reconciled: true });
    expect(accounts(db)).toHaveLength(3);
    expect(pool(db)).toBe(9_300);
    expect(bank(db).bankCharter.playerDeposits).toBe(700);
  });

  it("stops and reports when the pool cannot fund the backing", async () => {
    const db = world("authoritative");
    (db.collection("centralBanks").docs[0] as { externalBroadMoney: number }).externalBroadMoney = 100;
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { plan, batches } = await runSavingsMigration(db as unknown as Db, 90);
    expect(plan.ok).toBe(false);
    expect(plan.invariantFailures.join()).toMatch(/pool short/);
    expect(batches).toEqual([]);
    expect(accounts(db)).toHaveLength(0);
  });
});
