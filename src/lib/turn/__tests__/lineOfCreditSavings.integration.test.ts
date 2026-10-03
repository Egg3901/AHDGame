/**
 * A line-of-credit payment that overflows into savings.
 *
 * The payment drains the wallet first and takes the rest from savings. Under
 * the legacy pointer model that was a bare decrement of a number nothing stood
 * behind. Once a currency's savings accounts are the book of record the
 * balance IS the account and its backing sits in the central bank's household
 * pool, so the overflow has to be withdrawn through the journal: backing out
 * of the pool, into the wallet, out of the wallet to the lender.
 *
 * The bug this covers: the payment decremented the legacy projection directly
 * while the account kept the money and no backing moved, so the player's real
 * balance never fell and the world gained cash. Nothing else in the turn or
 * the savings suites could see it, because the two representations are only
 * compared once a currency is in the read cohort.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { processLineOfCreditTurn } from "@/lib/turn/lineOfCreditTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const OWNER = new ObjectId();
const TURN = 500;
/** Drawn principal, with no wallet cash: the whole payment must come from savings. */
const DRAWN = 100_000;

function world(readCurrencies: string[]): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      forexEnabled: true,
      lineOfCreditEnabled: true,
      privateBankingEnabled: false,
      savingsAccountsMode: readCurrencies.length > 0 ? "authoritative" : "shadow",
      savingsAccountsReadCurrencies: readCurrencies,
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 5,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 1_000_000,
      householdSavingsLiability: 50_000,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("exchangeRates", [{ _id: "USD", code: "USD", rateToInternal: 1 }]);
  db.seed("characters", [
    {
      _id: OWNER,
      name: "Borrower",
      countryId: "US",
      savingsAccountsOpened: { USD: true },
      currencyBalances: {
        personal: { USD: 0 },
        savings: { USD: 50_000 },
      },
      lineOfCredit: {
        balances: { USD: DRAWN },
        arrears: {},
        accountsOpened: { USD: true },
      },
    },
  ]);
  db.seed("savingsAccounts", [
    {
      _id: new ObjectId(),
      ownerType: "character",
      ownerId: OWNER,
      currency: "USD",
      balance: 50_000,
      holder: "centralBank",
      status: "open",
      version: 0,
      accruedInterest: 0,
      interestEarned: 0,
      openedTurn: 1,
    },
  ]);
  return db;
}

function character(db: InMemoryDb) {
  return db.collection("characters").docs[0] as {
    currencyBalances: { personal: { USD: number }; savings: { USD: number } };
    lineOfCredit: { balances: { USD?: number }; arrears: { USD?: number } };
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}
function pool(db: InMemoryDb): number {
  return (db.collection("centralBanks").docs[0] as { externalBroadMoney: number })
    .externalBroadMoney;
}

async function run(db: InMemoryDb) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  return processLineOfCreditTurn(
    db as unknown as Db,
    TURN,
    new Map([[OWNER.toString(), 0]]),
    new Map(),
    true
  );
}

describe("line-of-credit payment overflowing into savings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("withdraws through the account and moves the backing when the currency reads authoritatively", async () => {
    const db = world(["USD"]);
    const poolBefore = pool(db);
    const savingsBefore = account(db).balance;

    await run(db);

    const paid = savingsBefore - account(db).balance;
    expect(paid).toBeGreaterThan(0);
    // The account is the balance of record and it fell by what was paid.
    expect(account(db).balance).toBeCloseTo(savingsBefore - paid, 6);
    // Its backing left the central bank's pool: the money is real.
    expect(poolBefore - pool(db)).toBeCloseTo(paid, 6);
    // The legacy projection followed the account rather than being written past it.
    expect(character(db).currencyBalances.savings.USD).toBeCloseTo(account(db).balance, 6);
    // The wallet is a conduit, not a resting place.
    expect(character(db).currencyBalances.personal.USD).toBeCloseTo(0, 6);
    // The debt actually came down.
    expect(character(db).lineOfCredit.balances.USD ?? 0).toBeLessThan(DRAWN);
  });

  it("does not cancel debt when authoritative savings backing refuses withdrawal", async () => {
    const db = world(["USD"]);
    Object.assign(db.collection("centralBanks").docs[0], { externalBroadMoney: 0 });
    const savingsBefore = account(db).balance;
    await run(db);
    expect(character(db).lineOfCredit.balances.USD).toBe(DRAWN);
    expect(character(db).lineOfCredit.arrears.USD).toBeGreaterThan(0);
    expect(account(db).balance).toBe(savingsBefore);
    expect(character(db).currencyBalances.personal.USD).toBe(0);
  });

  it("keeps the legacy decrement when the currency is not in the cohort", async () => {
    const db = world([]);
    const poolBefore = pool(db);
    const accountBefore = account(db).balance;

    await run(db);

    const paid = 50_000 - character(db).currencyBalances.savings.USD;
    expect(paid).toBeGreaterThan(0);
    // Pointer model: the number goes down, nothing stands behind it, and the
    // shadow account is left for the next shadow refresh to re-sync.
    expect(account(db).balance).toBe(accountBefore);
    expect(pool(db)).toBe(poolBefore);
  });

  it("resumes rather than re-charges when the same turn's pass runs again", async () => {
    const db = world(["USD"]);
    await run(db);
    const after = {
      savings: account(db).balance,
      pool: pool(db),
      debt: character(db).lineOfCredit.balances.USD,
      records: db.collection("bankMoneyMoves").docs.length,
    };

    // A retried turn finds this turn's service record and resumes it.
    const second = await run(db);

    expect(second.charactersProcessed).toBeGreaterThan(0);
    expect(account(db).balance).toBe(after.savings);
    expect(pool(db)).toBe(after.pool);
    expect(character(db).lineOfCredit.balances.USD).toBe(after.debt);
    expect(db.collection("bankMoneyMoves").docs.length).toBe(after.records);
  });
});

/**
 * The pass reuses journal documents it has just read or written instead of
 * reading them again, and reads every CEO credit snapshot in one query. These
 * pin that it lands exactly where the read-back path lands, and that a crash
 * at any of the new seams still resumes without moving money twice.
 */
describe("line-of-credit service without redundant reads", () => {
  const ACCOUNT = new ObjectId();
  const CORP = new ObjectId();

  function seeded(): InMemoryDb {
    const db = world(["USD"]);
    db.collection("savingsAccounts").docs[0]._id = ACCOUNT;
    db.seed("corporations", [
      { _id: CORP, ceoId: OWNER, countryId: "US", creditCompositeSnapshot: 72 },
    ]);
    return db;
  }

  /** Every collection, with wall-clock dates and freshly minted ids masked. */
  function snapshot(db: InMemoryDb) {
    const fixed = new Set([OWNER, ACCOUNT, CORP].map((id) => id.toHexString()));
    const mask = (value: unknown): unknown => {
      if (value instanceof Date) return "<date>";
      if (value instanceof ObjectId)
        return fixed.has(value.toHexString()) ? value.toHexString() : "<id>";
      if (Array.isArray(value)) return value.map(mask);
      if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v)]));
      return value;
    };
    const names = [
      "characters",
      "centralBanks",
      "savingsAccounts",
      "bankMoneyMoves",
      "locLedger",
      "financialTxLog",
      "ledgerEntries",
      "corporations",
    ];
    return Object.fromEntries(names.map((name) => [name, mask(db.collection(name).docs)]));
  }

  /** Force every read the pass now skips: the behaviour before the change. */
  function readBack(db: InMemoryDb) {
    const journal = db.collection("bankMoneyMoves");
    const update = journal.updateOne.bind(journal);
    vi.spyOn(journal, "findOneAndUpdate").mockImplementation(async (filter, spec) => {
      await update(filter, spec);
      return null;
    });
    vi.spyOn(journal, "updateOne").mockImplementation(async (filter, spec, options) => {
      const result = await update(filter, spec, options);
      const set = !Array.isArray(spec) ? (spec.$set as Record<string, unknown>) : undefined;
      return set && Object.keys(set).some((path) => path.startsWith("locTargetOutcomes."))
        ? { ...result, matchedCount: 0 }
        : result;
    });
    const corps = db.collection("corporations");
    const find = corps.find.bind(corps);
    vi.spyOn(corps, "find").mockImplementation((filter) => {
      const cursor = find(filter);
      const toArray = cursor.toArray;
      // A ceoId shape the batch refuses to interpret sends every character
      // back to its own findOne.
      cursor.toArray = async () => [...(await toArray()), { ceoId: "not-an-id", countryId: "US" }];
      return cursor;
    });
  }

  /** Reads of this pass's own journal records; the savings withdrawal keeps its own. */
  function countReads(db: InMemoryDb) {
    const journal = db.collection("bankMoneyMoves");
    const corps = db.collection("corporations");
    const counts = { journalReads: 0, corpFindOne: 0 };
    const ours = (filter: Record<string, unknown> = {}) =>
      filter.kind === "line_of_credit" || String(filter._id).startsWith("loc:");
    const findOne = journal.findOne.bind(journal);
    vi.spyOn(journal, "findOne").mockImplementation(async (filter) => {
      if (ours(filter)) counts.journalReads += 1;
      return findOne(filter);
    });
    const find = journal.find.bind(journal);
    vi.spyOn(journal, "find").mockImplementation((filter) => {
      if (ours(filter)) counts.journalReads += 1;
      return find(filter);
    });
    const corpFindOne = corps.findOne.bind(corps);
    vi.spyOn(corps, "findOne").mockImplementation(async (filter) => {
      counts.corpFindOne += 1;
      return corpFindOne(filter);
    });
    return counts;
  }

  beforeEach(() => vi.restoreAllMocks());

  it("lands on the same documents and balances as the read-back path", async () => {
    const fast = seeded();
    const slow = seeded();
    readBack(slow);
    const fastResult = await run(fast);
    const slowResult = await run(slow);
    expect(fastResult).toEqual(slowResult);
    expect(fastResult.charactersProcessed).toBe(1);
    expect(snapshot(fast)).toEqual(snapshot(slow));
    expect(
      fast.collection("bankMoneyMoves").docs.find((d) => d.kind === "line_of_credit")
    ).toMatchObject({ status: "applied" });
  });

  it("reads the journal three times per settled character instead of nine", async () => {
    const db = seeded();
    const counts = countReads(db);
    await run(db);
    // Per turn: recovery's queue scan and the started-records batch. Per
    // settled character: the post-insert load and one publication read for
    // each of its two targets (cash, lender interest reserve). Before: nine
    // (load, post-insert load, resume load, post-prepare load, a publication
    // read and an outcome read-back per target, and a final result load).
    expect(counts.journalReads).toBe(2 + 3);
    expect(counts.corpFindOne).toBe(0);
  });

  it.each([
    ["prepare", "findOneAndUpdate"],
    ["outcome", "updateOne"],
    ["completion", "updateOne"],
  ] as const)(
    "resumes after a crash at the %s write without moving money twice",
    async (point, method) => {
      const clean = seeded();
      await run(clean);

      const db = seeded();
      const journal = db.collection("bankMoneyMoves");
      const original = journal[method].bind(journal) as (...args: unknown[]) => Promise<unknown>;
      let fired = false;
      vi.spyOn(journal, method).mockImplementation((async (...args: unknown[]) => {
        const result = await original(...args);
        const spec = args[1] as { $set?: Record<string, unknown> };
        const set = Object.keys(spec.$set ?? {});
        const hit =
          point === "prepare" ||
          (point === "outcome" && set.some((path) => path.startsWith("locTargetOutcomes."))) ||
          (point === "completion" && spec.$set?.status === "applied");
        if (!fired && hit) {
          fired = true;
          throw new Error(`crashed after ${point}`);
        }
        return result;
      }) as never);
      await expect(run(db)).rejects.toThrow(`crashed after ${point}`);
      vi.restoreAllMocks();
      const resumed = await run(db);
      expect(resumed.charactersProcessed).toBe(1);
      // A third pass is a pure replay.
      await run(db);
      expect(snapshot(db)).toEqual(snapshot(clean));
    }
  );

  it("falls back to findOne when a character runs two corporations in its country", async () => {
    const db = seeded();
    db.seed("corporations", [
      { _id: new ObjectId(), ceoId: OWNER, countryId: "US", creditCompositeSnapshot: 10 },
    ]);
    const counts = countReads(db);
    await run(db);
    expect(counts.corpFindOne).toBe(1);
  });
});
