import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  compareSavingsProjections,
  loadLegacySavingsRows,
  processSavingsShadowTurn,
  refreshShadowAccounts,
} from "@/lib/savings/shadow";
import type { SavingsAccountSnapshot } from "@/lib/savings/rules/accounts";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const BANK = new ObjectId();
const P1 = new ObjectId();
const P2 = new ObjectId();

function world(mode: "off" | "shadow" | "authoritative" = "shadow"): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, savingsAccountsMode: mode },
  ]);
  db.seed("centralBanks", [{ _id: "US", countryId: "US", nationalSavingsBalance: 1_500 }]);
  db.seed("characters", [
    {
      _id: P1,
      name: "One",
      currencyBalances: {
        savings: { USD: 1_000 },
        savingsHolder: { USD: BANK.toString() },
        pendingSavingsInterest: { USD: 2 },
        interestEarned: { USD: 10 },
      },
    },
    {
      _id: P2,
      name: "Two",
      savingsAccountsOpened: { USD: true },
      currencyBalances: { savings: { USD: 500 } },
    },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      bankCharter: { status: "active", currency: "USD", npcDeposits: 200, totalDeposits: 1_200 },
    },
  ]);
  return db;
}

function snap(over: Partial<SavingsAccountSnapshot>): SavingsAccountSnapshot {
  return {
    id: new ObjectId().toHexString(),
    ownerType: "character",
    ownerId: P1.toString(),
    currency: "USD",
    balance: 0,
    holder: "centralBank",
    status: "open",
    version: 0,
    accruedInterest: 0,
    interestEarned: 0,
    openedTurn: 1,
    ...over,
  };
}

describe("loadLegacySavingsRows", () => {
  it("reads one row per character and currency, including opened-but-empty accounts", async () => {
    const rows = await loadLegacySavingsRows(world() as unknown as Db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ownerId === P1.toString())).toMatchObject({
      currency: "USD",
      savings: 1_000,
      savingsHolder: BANK.toString(),
      pendingSavingsInterest: 2,
      interestEarned: 10,
    });
    expect(rows.find((r) => r.ownerId === P2.toString())).toMatchObject({
      savings: 500,
      opened: true,
    });
  });
});

describe("refreshShadowAccounts", () => {
  it("creates accounts from legacy rows and is idempotent", async () => {
    const db = world();
    const rows = await loadLegacySavingsRows(db as unknown as Db);
    expect(await refreshShadowAccounts(db as unknown as Db, 10, rows, new Set())).toBe(2);
    expect(db.collection("savingsAccounts").docs).toHaveLength(2);
    const first = db
      .collection("savingsAccounts")
      .docs.find((d) => (d.ownerId as ObjectId).equals(P1)) as {
      balance: number;
      holder: string;
      version: number;
      openedTurn: number;
    };
    expect(first).toMatchObject({
      balance: 1_000,
      holder: BANK.toString(),
      version: 0,
      openedTurn: 10,
    });

    // Legacy moved on; the shadow follows it without creating a second record.
    (
      db.collection("characters").docs[0] as { currencyBalances: { savings: { USD: number } } }
    ).currencyBalances.savings.USD = 1_100;
    const again = await loadLegacySavingsRows(db as unknown as Db);
    await refreshShadowAccounts(db as unknown as Db, 11, again, new Set());
    expect(db.collection("savingsAccounts").docs).toHaveLength(2);
    expect(
      db.collection("savingsAccounts").docs.find((d) => (d.ownerId as ObjectId).equals(P1)) as {
        balance: number;
        openedTurn: number;
      }
    ).toMatchObject({
      balance: 1_100,
      openedTurn: 10,
    });
  });

  it("leaves authoritative currencies alone", async () => {
    const db = world();
    const rows = await loadLegacySavingsRows(db as unknown as Db);
    expect(await refreshShadowAccounts(db as unknown as Db, 10, rows, new Set(["USD"]))).toBe(0);
    expect(db.collection("savingsAccounts").docs).toHaveLength(0);
  });
});

describe("compareSavingsProjections", () => {
  const rows = [
    {
      ownerId: P1.toString(),
      currency: "USD",
      savings: 1_000,
      savingsHolder: BANK.toString() as string,
    },
    { ownerId: P2.toString(), currency: "USD", savings: 500, savingsHolder: null },
  ];

  it("is clean when accounts, charters and legacy agree", () => {
    const comparison = compareSavingsProjections({
      turn: 5,
      rows,
      accounts: [
        snap({ ownerId: P1.toString(), balance: 1_000, holder: BANK.toString() }),
        snap({ ownerId: P2.toString(), balance: 500 }),
      ],
      charters: [
        { bankId: BANK.toString(), currency: "USD", totalDeposits: 1_200, npcDeposits: 200 },
      ],
      centralBankStock: new Map([["USD", 1_500]]),
    });
    expect(comparison.totalDiscrepancies).toBe(0);
    expect(comparison.currencies[0]).toMatchObject({
      legacyOwnerTotal: 1_500,
      accountOwnerTotal: 1_500,
      centralBankAccounts: 500,
      banks: [
        {
          bankId: BANK.toString(),
          charterPointerDeposits: 1_000,
          accountLiability: 1_000,
          drift: 0,
        },
      ],
    });
  });

  it("counts a stale charter aggregate, an owner-total mismatch and row disagreements", () => {
    const comparison = compareSavingsProjections({
      turn: 5,
      rows,
      accounts: [
        snap({ ownerId: P1.toString(), balance: 900, holder: BANK.toString() }),
        snap({ ownerId: P2.toString(), balance: 500 }),
      ],
      charters: [
        { bankId: BANK.toString(), currency: "USD", totalDeposits: 1_200, npcDeposits: 200 },
      ],
      centralBankStock: new Map([["USD", 0]]),
    });
    const usd = comparison.currencies[0];
    expect(usd.rowDiscrepancies).toBe(1);
    expect(usd.banks[0].drift).toBe(-100);
    // row mismatch + owner total + bank drift
    expect(usd.discrepancies).toBe(3);
    expect(comparison.totalDiscrepancies).toBe(3);
  });
});

describe("processSavingsShadowTurn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when the rollout is off", async () => {
    const db = world("off");
    const result = await processSavingsShadowTurn(db as unknown as Db, 20);
    expect(result).toEqual({
      mode: "off",
      accountsRefreshed: 0,
      comparison: { turn: 20, currencies: [], totalDiscrepancies: 0 },
    });
    expect(db.collection("savingsAccounts").docs).toHaveLength(0);
  });

  it("refreshes and compares in shadow mode without changing legacy fields", async () => {
    const db = world("shadow");
    const before = JSON.stringify(db.collection("characters").docs);
    const result = await processSavingsShadowTurn(db as unknown as Db, 20);
    expect(result.mode).toBe("shadow");
    expect(result.accountsRefreshed).toBe(2);
    expect(result.comparison.currencies).toHaveLength(1);
    expect(result.comparison.totalDiscrepancies).toBe(0);
    expect(JSON.stringify(db.collection("characters").docs)).toBe(before);
  });

  it("counts discrepancies on the telemetry when a charter aggregate is stale", async () => {
    const db = world("shadow");
    (
      db.collection("corporations").docs[0] as { bankCharter: { totalDeposits: number } }
    ).bankCharter.totalDeposits = 1_500;
    const result = await processSavingsShadowTurn(db as unknown as Db, 21);
    expect(result.comparison.totalDiscrepancies).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.collection("bankingTelemetry").docs.find((d) => d._id === 21)).toMatchObject({
      counters: { unreconciledProjections: 1 },
    });
  });
});
