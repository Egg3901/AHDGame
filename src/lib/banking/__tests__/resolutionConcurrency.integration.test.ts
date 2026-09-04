/**
 * Resolution under contention and under crashes.
 *
 * The claim is taken before any money moves, the accounts are frozen before
 * the waterfall, and the settlement stamp lands with the waterfall's own
 * projections. So: two attempts settle once; a deposit racing the waterfall
 * is refused; a crash after the claim leaves a `resolving` estate that the
 * next attempt finishes under the same key; and the accounts are released
 * to the central bank only once it holds their backing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import { runSavingsCommand } from "@/lib/savings/accountsShell";
import { resolveFailedBankDepositors } from "@/lib/banking/insurance";
import { revokeCharter } from "@/lib/banking/charter";
import { lifecycleStage } from "@/lib/banking/rules/lifecycle";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

const BANK = new ObjectId();
const OWNER = new ObjectId();
const TURN = 200;

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
      name: "Contested Bank",
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
      npcDeposits: number;
      playerDeposits?: number;
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

async function failBank(db: InMemoryDb) {
  await db
    .collection("corporations")
    .updateOne(
      { _id: BANK },
      { $set: { "bankCharter.status": "failed", "bankCharter.failedTurn": TURN } }
    );
}

describe("resolution under contention", () => {
  let db: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const moved = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    expect(moved.ok).toBe(true);
    expect(bank(db).bankCharter.playerDeposits).toBe(1_000);
  });

  it("settles once when two attempts race", async () => {
    await failBank(db);
    const before = totalMoney(db);
    const [a, b] = await Promise.all([
      resolveFailedBankDepositors(db as unknown as Db, BANK, TURN),
      resolveFailedBankDepositors(db as unknown as Db, BANK, TURN),
    ]);
    // Exactly one attempt reports the settlement.
    expect([a.resolved, b.resolved].filter(Boolean)).toHaveLength(1);
    expect(a.npcReturned + b.npcReturned).toBe(5_000);
    // 11_000 in the vault after the holder move, 5_000 returned; a failed
    // bank's residual stays in the estate for the wind-down, never the owner.
    expect(bank(db).bankCharter.cashReserves).toBe(6_000);
    expect(bank(db).liquidCapital).toBe(0);
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(cb(db).householdSavingsLiability).toBe(1_000);
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open", balance: 1_000 });
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolved");
    expect(totalMoney(db)).toBe(before);
    // A third attempt on a settled estate does nothing.
    const again = await resolveFailedBankDepositors(db as unknown as Db, BANK, TURN + 1);
    expect(again.resolved).toBe(false);
    expect(bank(db).bankCharter.cashReserves).toBe(6_000);
  });

  it("refuses movements into or out of a frozen account and a resolving bank", async () => {
    await failBank(db);
    // Claim and freeze, then crash before the waterfall moves anything: the
    // freeze is the last write before the settlement claims its key.
    const faulty = withInjectedCrash(db, {
      collection: "savingsAccounts",
      op: "updateMany",
      onCall: 1,
      afterWrite: true,
    }).db;
    await expect(resolveFailedBankDepositors(faulty, BANK, TURN)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolving");
    expect(account(db).status).toBe("frozen");

    const withdraw = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "withdraw", amount: 100 },
      "w1"
    );
    expect(withdraw.ok).toBe(false);
    expect((withdraw as { error: string }).error).toMatch(/frozen/i);
    const deposit = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "deposit", amount: 100 },
      "d1"
    );
    expect(deposit.ok).toBe(false);
    // Another saver cannot point savings at a resolving bank either.
    const other = new ObjectId();
    db.seed("characters", [
      {
        _id: other,
        name: "Latecomer",
        countryId: "US",
        savingsAccountsOpened: { USD: true },
        currencyBalances: { personal: { USD: 100 }, savings: { USD: 500 } },
      },
    ]);
    const late = await moveCharacterSavings(db as unknown as Db, other, "USD", BANK.toString());
    expect(late.ok).toBe(false);
    expect((late as { error: string }).error).toMatch(
      /in resolution|may not take deposits|must have an active/
    );
    expect(account(db).balance).toBe(1_000);
  });

  it("finishes a crashed resolution on the next attempt under the same key", async () => {
    await failBank(db);
    const before = totalMoney(db);
    // Crash right after the pool credit landed: the vault debit and the pool
    // credit are done, the liability and aggregate projections are not.
    const faulty = withInjectedCrash(db, {
      collection: "centralBanks",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    }).db;
    const crashed = await resolveFailedBankDepositors(faulty, BANK, TURN).then(
      (result) => result,
      (error) => error
    );
    // The journal catches a crash inside a leg and reports it as partial; a
    // crash outside one propagates. Either way the estate is not settled.
    if (crashed instanceof Error) expect(crashed).toBeInstanceOf(InjectedCrash);
    else expect(crashed.resolved).toBe(false);
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolving");
    const claimTurn = bank(db).bankCharter.resolutionClaimedTurn;
    expect(claimTurn).toBe(TURN);

    // The sweep on a later turn: the estate is still failed and unsettled.
    const recovered = await resolveFailedBankDepositors(db as unknown as Db, BANK, TURN + 2);
    expect(recovered.resolved).toBe(true);
    expect(bank(db).bankCharter.resolutionClaimedTurn).toBe(TURN);
    expect(bank(db).bankCharter.depositorsResolvedTurn).toBe(TURN);
    expect(lifecycleStage(bank(db).bankCharter as never)).toBe("resolved");
    expect(bank(db).bankCharter.cashReserves).toBe(6_000);
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(cb(db).householdSavingsLiability).toBe(1_000);
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open", balance: 1_000 });
    expect(totalMoney(db)).toBe(before);
    // Only one settlement record exists for the estate.
    const moves = db
      .collection("bankMoneyMoves")
      .docs.filter((m) => String((m as { _id: string })._id).includes(BANK.toString()));
    expect(moves).toHaveLength(1);
  });

  it("revokes once when two revocations race, and refuses the loser", async () => {
    const before = totalMoney(db);
    const [a, b] = await Promise.all([
      revokeCharter(db as unknown as Db, BANK, "voluntary"),
      revokeCharter(db as unknown as Db, BANK, "voluntary"),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok) as { error: string };
    expect(loser.error).toMatch(/already being revoked|no longer active|no active/);
    expect(bank(db).bankCharter.status).toBe("revoked");
    // Depositors first, then the owner: the household book and the player
    // book both went back to the central bank, and the residual to the parent.
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(cb(db).householdSavingsLiability).toBe(1_000);
    // 11_000 in the vault (10_000 plus the 1_000 backing that came in with
    // the holder move), 5_000 returned to depositors, 6_000 of equity out.
    expect(bank(db).liquidCapital).toBe(6_000);
    expect(bank(db).bankCharter.cashReserves).toBe(0);
    expect(account(db)).toMatchObject({ holder: "centralBank", status: "open" });
    expect(totalMoney(db)).toBe(before);
  });
});
