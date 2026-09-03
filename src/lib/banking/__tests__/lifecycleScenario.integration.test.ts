/**
 * A bank's whole life on the in-memory adapter, turn by turn, through the
 * real phases in the order the registry runs them: savings interest, the
 * banking pass (recovery first), the shadow comparison, solvency and
 * supervision. A player keeps savings at the bank throughout.
 *
 * What must hold at every turn boundary:
 * - money is conserved: what the world holds changes only by what the
 *   journal explicitly minted or burned;
 * - the health gate is open and nothing is left unfinished;
 * - the savings comparison is clean;
 * - the charter's stage is what the passes say it is.
 *
 * And at the end: the bank is dead (resolved or revoked), the player's
 * account is back with the central bank, open, with the balance intact plus
 * whatever interest it earned, and the central bank holds the backing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import { runSavingsCommand } from "@/lib/savings/accountsShell";
import { buildBankingHealth } from "@/lib/banking/health";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { lifecycleStage, type BankLifecycleStage } from "@/lib/banking/rules/lifecycle";
import { oid } from "@/lib/banking/rules/boundary";
import { processSavingsInterestTurn } from "@/lib/turn/savingsInterestTurn";
import { processBankingTurn } from "@/lib/turn/bankingTurn";
import { processSavingsShadowTurn } from "@/lib/savings/shadow";
import { processBankSolvencyTurn } from "@/lib/turn/bankSolvencyTurn";
import { processBankSupervision } from "@/lib/banking/supervision";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

const BANK = new ObjectId();
const OWNER = new ObjectId();
const START = 400;

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: ["USD"],
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: START, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 200_000,
      householdSavingsLiability: 0,
      nationalSavingsBalance: 0,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("depositInsuranceFunds", [{ _id: "USD", balance: 5_000 }]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      treasuryBalance: 1_000_000,
      spending: { total: 0, byCategory: {} },
      surplus: 0,
    },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Lifecycle Bank",
      type: "financial",
      countryId: "US",
      liquidCapital: 20_000,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: START - 10,
        postedCapital: 20_000,
        cashReserves: 20_000,
        npcDeposits: 30_000,
        totalDeposits: 30_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
      },
    },
  ]);
  db.seed("corporateSectors", [
    { _id: new ObjectId(), corporationId: BANK, sectorType: "financial", capitalStock: 5_000 },
  ]);
  db.seed("characters", [
    {
      _id: OWNER,
      name: "Saver",
      countryId: "US",
      savingsAccountsOpened: { USD: true },
      currencyBalances: { personal: { USD: 8_000 }, savings: { USD: 2_000 } },
    },
  ]);
  return db;
}

function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    liquidCapital: number;
    bankCharter: {
      status: string;
      cashReserves: number;
      npcDeposits: number;
      playerDeposits?: number;
      warningBand?: string;
      revokedReason?: string;
    };
  };
}
function cb(db: InMemoryDb) {
  return db.collection("centralBanks").docs[0] as {
    externalBroadMoney: number;
    householdSavingsLiability: number;
  };
}
function fund(db: InMemoryDb) {
  return (db.collection("depositInsuranceFunds").docs[0] as { balance: number }).balance;
}
function owner(db: InMemoryDb) {
  return db.collection("characters").docs[0] as {
    currencyBalances: {
      personal: { USD: number };
      savings: { USD: number };
      savingsHolder?: { USD: string };
    };
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}
/**
 * Everything that is cash somewhere. Savings balances are claims, not cash,
 * and the treasury balance is the fiscal ledger: a deficit-financed backstop
 * is booked there as spending while the journal records the money it minted.
 */
function money(db: InMemoryDb): number {
  return (
    cb(db).externalBroadMoney +
    bank(db).bankCharter.cashReserves +
    bank(db).liquidCapital +
    owner(db).currencyBalances.personal.USD +
    fund(db)
  );
}
/** Net money the journal says it created (mint) or destroyed (burn). */
function journalNetMinted(db: InMemoryDb): number {
  let net = 0;
  for (const record of db.collection("bankMoneyMoves").docs as Array<{
    legs?: Array<{ kind: string; amount: number; applied: boolean }>;
  }>) {
    for (const leg of record.legs ?? []) {
      if (!leg.applied) continue;
      if (leg.kind === "mint") net += leg.amount;
      if (leg.kind === "burn") net -= leg.amount;
    }
  }
  return net;
}

async function runTurn(db: InMemoryDb, turn: number) {
  const d = db as unknown as Db;
  await db.collection("gameState").updateOne({ _id: "current" }, { $set: { currentTurn: turn } });
  await processSavingsInterestTurn(d, turn);
  const banking = await processBankingTurn(d, turn);
  const shadow = await processSavingsShadowTurn(d, turn);
  const solvency = await processBankSolvencyTurn(d, turn);
  const supervision = await processBankSupervision(d, turn);
  return { banking, shadow, solvency, supervision };
}

describe("a bank's life on the in-memory adapter", () => {
  let db: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("runs from operating through failure to resolution with money conserved and the gate open", async () => {
    const stages: BankLifecycleStage[] = [];
    const baseline = money(db);
    const check = async (label: string) => {
      // Conservation: cash changed only by what the journal minted or burned.
      expect(money(db) - baseline, label).toBeCloseTo(journalNetMinted(db), 2);
      const health = await buildBankingHealth(db as unknown as Db);
      expect(health.gate.reasons, label).toEqual([]);
      const partials = db
        .collection("bankMoneyMoves")
        .docs.filter((m) => (m as { status: string }).status === "partial")
        .map((m) => {
          const record = m as {
            _id: string;
            error?: string;
            legs?: unknown;
            projections?: unknown;
          };
          return {
            key: record._id,
            error: record.error,
            legs: record.legs,
            projections: record.projections,
          };
        });
      expect(health.unfinishedSettlements.count, `${label}: ${JSON.stringify(partials)}`).toBe(0);
      expect(health.savingsAccounts.comparison?.totalDiscrepancies ?? 0, label).toBe(0);
      stages.push(lifecycleStage(bank(db).bankCharter as never));
    };

    // The player joins the bank, and deposits a little more.
    const moved = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    expect(moved.ok).toBe(true);
    const deposited = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "deposit", amount: 500 },
      "d1"
    );
    expect(deposited.ok).toBe(true);
    expect(account(db)).toMatchObject({ holder: BANK.toString(), balance: 2_500 });
    expect(bank(db).bankCharter.playerDeposits).toBe(2_500);
    await check("after joining");

    // Three quiet turns: the bank pays interest, the comparison stays clean.
    for (let turn = START + 1; turn <= START + 3; turn += 1) {
      const result = await runTurn(db, turn);
      expect(result.banking.recovery.stillPartial).toBe(0);
      expect(result.banking.unfinishedSettlements).toBe(0);
      await check(`quiet turn ${turn}`);
    }
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("operating");
    const balanceBeforeShock = account(db).balance;
    expect(balanceBeforeShock).toBeGreaterThan(2_500);
    expect(bank(db).bankCharter.playerDeposits).toBeCloseTo(balanceBeforeShock, 6);

    // A shock: most of the vault is lost, through the journal, so the
    // conservation check sees the burn.
    const cash = bank(db).bankCharter.cashReserves;
    const shock = Math.floor(cash * 0.97);
    const burned = await settleTransition(db as unknown as Db, {
      key: `scenario-shock:${BANK.toString()}`,
      kind: "scenario_shock",
      turn: START + 3,
      currency: "USD",
      legs: [
        {
          kind: "debit",
          amount: shock,
          collection: "corporations",
          filter: { _id: oid(BANK.toString()) },
          path: "bankCharter.cashReserves",
          note: "the shock",
        },
        { kind: "burn", amount: shock, note: "the shock" },
      ],
      projections: [],
      event: { kind: "bank.failed", command: "scenario.shock" },
    });
    expect(burned.status).toBe("applied");
    await check("after the shock");

    // The passes notice: band drops, depositors flee, the bank fails, and the
    // resolution sweep runs in the same solvency pass or the next.
    let dead = false;
    for (let turn = START + 4; turn <= START + 12 && !dead; turn += 1) {
      const result = await runTurn(db, turn);
      expect(result.banking.recovery.stillPartial).toBe(0);
      await check(`stressed turn ${turn}`);
      const stage = lifecycleStage(bank(db).bankCharter as never);
      dead = stage === "resolved" || stage === "revoked";
    }
    expect(dead).toBe(true);
    expect(stages).toContain("impaired");
    // The stage path never goes backwards from dead, and never skips the claim.
    const firstDead = stages.findIndex((s) => s === "resolved" || s === "revoked");
    expect(stages.slice(firstDead).every((s) => s === "resolved" || s === "revoked")).toBe(true);

    // The player: account back with the central bank, open, balance intact.
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open" });
    expect(account(db).balance).toBeGreaterThanOrEqual(balanceBeforeShock);
    expect(owner(db).currencyBalances.savings.USD).toBeCloseTo(account(db).balance, 6);
    expect(owner(db).currencyBalances.savingsHolder?.USD).toBe("centralBank");
    expect(cb(db).householdSavingsLiability).toBeCloseTo(account(db).balance, 6);
    expect(bank(db).bankCharter.playerDeposits ?? 0).toBe(0);

    // The player can move the money again at once.
    const withdrawn = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "withdraw", amount: 100 },
      "w1"
    );
    expect(withdrawn.ok).toBe(true);
    await check("after the withdrawal");

    // Two more turns: recovery has nothing to do, the estate stays settled.
    for (let turn = START + 13; turn <= START + 14; turn += 1) {
      const result = await runTurn(db, turn);
      expect(result.banking.recovery).toEqual({
        resumedSettlements: 0,
        stillPartial: 0,
        estatesRecovered: 0,
        estatesStillResolving: 0,
      });
      await check(`aftermath turn ${turn}`);
    }
  }, 30_000);
});
