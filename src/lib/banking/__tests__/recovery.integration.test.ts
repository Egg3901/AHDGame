/**
 * The recovery worker finishes what a crash left: a failed estate claimed
 * and not settled, a revocation claimed and not settled, a settlement whose
 * legs did not all land. It touches only earlier turns, reports what it
 * could not finish, and the health gate opens only once it has nothing left.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import { resolveFailedBankDepositors } from "@/lib/banking/insurance";
import { revokeCharter } from "@/lib/banking/charter";
import { recoverBankingSettlements } from "@/lib/banking/recovery";
import { buildBankingHealth } from "@/lib/banking/health";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { lifecycleStage } from "@/lib/banking/rules/lifecycle";
import { oid } from "@/lib/banking/rules/boundary";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

const BANK = new ObjectId();
const OWNER = new ObjectId();
const TURN = 300;

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
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 50_000,
      householdSavingsLiability: 0,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("depositInsuranceFunds", [{ _id: "USD", balance: 10_000 }]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Recovered Bank",
      type: "financial",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 10_000,
        cashReserves: 10_000,
        npcDeposits: 4_000,
        totalDeposits: 4_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
      },
    },
  ]);
  db.seed("corporateSectors", [
    { _id: new ObjectId(), corporationId: BANK, sectorType: "financial", capitalStock: 1_000 },
  ]);
  db.seed("characters", [
    {
      _id: OWNER,
      name: "Saver",
      countryId: "US",
      savingsAccountsOpened: { USD: true },
      currencyBalances: { personal: { USD: 5_000 }, savings: { USD: 1_000 } },
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
      revokedReason?: string;
      pendingRevocationReason?: string;
      resolutionClaimedTurn?: number;
      depositorsResolvedTurn?: number;
    };
  };
}
function cb(db: InMemoryDb) {
  return db.collection("centralBanks").docs[0] as {
    externalBroadMoney: number;
    householdSavingsLiability: number;
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}
function totalMoney(db: InMemoryDb): number {
  const fund = (db.collection("depositInsuranceFunds").docs[0] as { balance: number }).balance;
  const owner = db.collection("characters").docs[0] as {
    currencyBalances: { personal: { USD: number } };
  };
  return (
    cb(db).externalBroadMoney +
    bank(db).bankCharter.cashReserves +
    bank(db).liquidCapital +
    fund +
    owner.currencyBalances.personal.USD
  );
}

describe("recovery worker", () => {
  let db: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const moved = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    expect(moved.ok).toBe(true);
  });

  it("finishes a failed estate whose resolution crashed, and only on a later turn", async () => {
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.status": "failed" } });
    const before = totalMoney(db);
    const faulty = withInjectedCrash(db, {
      collection: "centralBanks",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    }).db;
    await resolveFailedBankDepositors(faulty, BANK, TURN).catch((error) => {
      expect(error).toBeInstanceOf(InjectedCrash);
    });
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolving");

    // Same turn: the claim may still be in flight elsewhere, so nothing happens.
    const sameTurn = await recoverBankingSettlements(db as unknown as Db, TURN);
    expect(sameTurn.estatesRecovered).toEqual([]);
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolving");
    const gateBefore = (await buildBankingHealth(db as unknown as Db)).gate;
    expect(gateBefore.ok).toBe(true); // claimed THIS turn is not stuck yet

    await db
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { currentTurn: TURN + 1 } });
    const gateStuck = (await buildBankingHealth(db as unknown as Db)).gate;
    expect(gateStuck.ok).toBe(false);
    expect(gateStuck.reasons.join(" ")).toMatch(/still in resolution/);

    const later = await recoverBankingSettlements(db as unknown as Db, TURN + 1);
    expect(later.estatesRecovered).toEqual([BANK.toString()]);
    expect(later.estatesStillResolving).toEqual([]);
    expect(later.stillPartial).toEqual([]);
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolved");
    expect(bank(db).bankCharter.cashReserves).toBe(6_000);
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(cb(db).householdSavingsLiability).toBe(1_000);
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open", balance: 1_000 });
    expect(totalMoney(db)).toBe(before);

    const gateAfter = (await buildBankingHealth(db as unknown as Db)).gate;
    expect(gateAfter.ok).toBe(true);
    expect((await buildBankingHealth(db as unknown as Db)).resolvingEstates).toEqual([]);
  });

  it("finishes a revocation that crashed after claiming, with the reason it was started with", async () => {
    const before = totalMoney(db);
    // Claim and freeze, then crash before the waterfall moves anything: the
    // freeze is the last write before the settlement claims its key.
    const faulty = withInjectedCrash(db, {
      collection: "savingsAccounts",
      op: "updateMany",
      onCall: 1,
      afterWrite: true,
    }).db;
    await expect(revokeCharter(faulty, BANK, "supervisory")).rejects.toBeInstanceOf(InjectedCrash);
    expect(bank(db).bankCharter.status).toBe("active");
    expect(bank(db).bankCharter.pendingRevocationReason).toBe("supervisory");
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolving");
    expect(account(db).status).toBe("frozen");

    const later = await recoverBankingSettlements(db as unknown as Db, TURN + 1);
    expect(later.estatesRecovered).toEqual([BANK.toString()]);
    expect(bank(db).bankCharter.status).toBe("revoked");
    expect(bank(db).bankCharter.revokedReason).toBe("supervisory");
    expect(bank(db).bankCharter.pendingRevocationReason).toBeUndefined();
    expect(bank(db).liquidCapital).toBe(6_000);
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open" });
    expect(totalMoney(db)).toBe(before);
  });

  it("resumes a settlement that crashed between two legs and reports one it cannot finish", async () => {
    const before = totalMoney(db);
    // A transfer from the vault to the pool, crashing after the debit landed.
    const faulty = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    }).db;
    const transition = {
      key: `test-move:${BANK.toString()}:${TURN}`,
      kind: "test_move",
      turn: TURN,
      currency: "USD",
      legs: [
        {
          kind: "debit" as const,
          amount: 2_000,
          collection: "corporations",
          filter: { _id: oid(BANK.toString()) },
          path: "bankCharter.cashReserves",
          note: "vault out",
        },
        {
          kind: "credit" as const,
          amount: 2_000,
          collection: "centralBanks",
          filter: { _id: "US" },
          path: "externalBroadMoney",
          note: "pool in",
        },
      ],
      projections: [],
      event: { kind: "bank.resolved" as const, command: "test" },
    };
    await expect(settleTransition(faulty, transition)).rejects.toBeInstanceOf(InjectedCrash);
    expect(bank(db).bankCharter.cashReserves).toBe(9_000);
    expect(cb(db).externalBroadMoney).toBe(49_000);

    const gate = (await buildBankingHealth(db as unknown as Db)).gate;
    expect(gate.ok).toBe(true); // this turn's record is not stale yet

    const recovered = await recoverBankingSettlements(db as unknown as Db, TURN + 1);
    expect(recovered.resumedSettlements).toEqual([transition.key]);
    expect(bank(db).bankCharter.cashReserves).toBe(9_000);
    expect(cb(db).externalBroadMoney).toBe(51_000);
    expect(totalMoney(db)).toBe(before);
    // Second pass: nothing left.
    const again = await recoverBankingSettlements(db as unknown as Db, TURN + 2);
    expect(again.resumedSettlements).toEqual([]);

    // A record whose remaining debit can no longer be covered stays partial
    // and is reported, never forced.
    await db.collection("bankMoneyMoves").insertOne({
      _id: `hopeless:${TURN}`,
      kind: "test_move",
      turn: TURN,
      status: "partial",
      createdAt: new Date(),
      legs: [
        {
          kind: "debit",
          amount: 1_000_000,
          note: "too much",
          applied: false,
          collection: "corporations",
          filter: { _id: BANK },
          path: "bankCharter.cashReserves",
        },
        { kind: "burn", amount: 1_000_000, note: "gone", applied: false },
      ],
    });
    const hopeless = await recoverBankingSettlements(db as unknown as Db, TURN + 3);
    expect(hopeless.stillPartial).toHaveLength(1);
    expect(hopeless.stillPartial[0].key).toBe(`hopeless:${TURN}`);
    expect(bank(db).bankCharter.cashReserves).toBe(9_000);
    await db
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { currentTurn: TURN + 3 } });
    const gated = (await buildBankingHealth(db as unknown as Db)).gate;
    expect(gated.ok).toBe(false);
    expect(gated.reasons.join(" ")).toMatch(/unfinished/);
  });
});
