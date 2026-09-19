import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { charterFingerprint, transferBankCharterToAcquirer } from "../transferCharter";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 150,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: 123_410_000,
    npcDeposits: 71_110_000,
    playerDeposits: 5_000_000,
    totalLoans: 0,
    ...overrides,
  };
}

/**
 * Concurrency hardening (PR #2016): one shell raced toward two acquirers must
 * converge on exactly one owner. The loser returns conflict and writes
 * nothing — no claim left behind, no re-key toward itself — while same-pair
 * retries join the shared plan and converge.
 */
describe("transferBankCharterToAcquirer concurrency hardening", () => {
  let memory: InMemoryDb;
  let targetId: ObjectId;
  let firstId: ObjectId;
  let secondId: ObjectId;
  let loanId: ObjectId;
  let lentId: ObjectId;
  let borrowedId: ObjectId;
  let accountId: ObjectId;
  let depositorId: ObjectId;
  const now = new Date("2026-09-03T23:30:00Z");

  function db(): Db {
    return memory as unknown as Db;
  }

  function seedWorld(): void {
    targetId = new ObjectId();
    firstId = new ObjectId();
    secondId = new ObjectId();
    const otherBankId = new ObjectId();
    loanId = new ObjectId();
    lentId = new ObjectId();
    borrowedId = new ObjectId();
    accountId = new ObjectId();
    depositorId = new ObjectId();

    memory.seed("corporations", [
      { _id: targetId, name: "Shell Bank", bankCharter: { ...makeCharter() } },
      { _id: firstId, name: "First Bidder" },
      { _id: secondId, name: "Second Bidder" },
    ]);
    memory.seed("bankLoans", [
      {
        _id: loanId,
        bankCorporationId: targetId,
        currency: "USD",
        borrowerType: "npcBulk",
        principal: 1_000,
        outstanding: 900,
        ratePercent: 8,
        originatedTurn: 150,
        termTurns: 12,
        status: "current",
      },
    ]);
    memory.seed("interbankLoans", [
      {
        _id: lentId,
        lenderCorporationId: targetId,
        borrowerCorporationId: otherBankId,
        currency: "USD",
        principal: 500,
        outstanding: 500,
        ratePercent: 5,
        originatedTurn: 151,
        status: "current",
      },
      {
        _id: borrowedId,
        lenderCorporationId: otherBankId,
        borrowerCorporationId: targetId,
        currency: "USD",
        principal: 700,
        outstanding: 700,
        ratePercent: 5,
        originatedTurn: 151,
        status: "current",
      },
    ]);
    memory.seed("savingsAccounts", [
      {
        _id: accountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 1000,
        holder: targetId.toString(),
        status: "open",
        version: 1,
        accruedInterest: 0,
        interestEarned: 0,
        openedTurn: 150,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    memory.seed("characters", [
      {
        _id: depositorId,
        name: "Saver",
        currencyBalances: {
          campaign: 0,
          personal: {},
          savingsHolder: { USD: targetId.toString() },
        },
      },
    ]);
  }

  function corp(id: ObjectId): Corporation {
    const doc = memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id));
    if (!doc) throw new Error(`corporation ${id.toHexString()} missing`);
    return doc as unknown as Corporation;
  }

  /** Full ownership assertion: charter owner plus every satellite key. */
  function expectUnifiedToward(winnerId: ObjectId, loserId: ObjectId): void {
    const winnerHex = winnerId.toString();
    expect(corp(winnerId).bankCharter?.currency).toBe("USD");
    expect("bankCharter" in corp(targetId)).toBe(false);
    expect("bankCharter" in corp(loserId)).toBe(false);
    const loans = memory.collection("bankLoans").docs as unknown as {
      bankCorporationId: ObjectId;
    }[];
    expect(loans.every((l) => l.bankCorporationId.equals(winnerId))).toBe(true);
    const interbank = memory.collection("interbankLoans").docs as unknown as {
      lenderCorporationId: ObjectId;
      borrowerCorporationId: ObjectId;
    }[];
    expect(
      interbank.every(
        (l) =>
          !l.lenderCorporationId.equals(targetId) &&
          !l.borrowerCorporationId.equals(targetId) &&
          !l.lenderCorporationId.equals(loserId) &&
          !l.borrowerCorporationId.equals(loserId)
      )
    ).toBe(true);
    const accounts = memory.collection("savingsAccounts").docs as unknown as {
      _id: ObjectId;
      holder: string;
    }[];
    expect(accounts.find((a) => a._id.equals(accountId))?.holder).toBe(winnerHex);
    const characters = memory.collection("characters").docs as unknown as {
      _id: ObjectId;
      currencyBalances: { savingsHolder: Record<string, string> };
    }[];
    expect(
      characters.find((c) => c._id.equals(depositorId))?.currencyBalances.savingsHolder.USD
    ).toBe(winnerHex);
    expect("bankCharterTransfer" in corp(targetId)).toBe(false);
  }

  function winnerOf(): ObjectId {
    if (corp(firstId).bankCharter) return firstId;
    if (corp(secondId).bankCharter) return secondId;
    throw new Error("no acquirer holds the charter");
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    memory = createInMemoryDb();
    seedWorld();
  });

  it("cold-start race converges on exactly one owner with a conflicting loser", async () => {
    const [r1, r2] = await Promise.all([
      transferBankCharterToAcquirer(db(), targetId, firstId, now),
      transferBankCharterToAcquirer(db(), targetId, secondId, now),
    ]);
    const oks = [r1.ok, r2.ok].filter(Boolean);
    expect(oks).toHaveLength(1);
    const loser = r1.ok ? r2 : r1;
    expect(loser.ok).toBe(false);
    const winnerId = winnerOf();
    const loserId = winnerId.equals(firstId) ? secondId : firstId;
    expectUnifiedToward(winnerId, loserId);
  });

  it("late arrival after the winner's release conflicts without writing", async () => {
    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let released = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await orig(filter, update, options);
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      if (
        unset &&
        "bankCharter" in unset &&
        "bankCharterTransfer.attemptId" in (filter as Record<string, unknown>)
      ) {
        released = true;
      }
      return result;
    });

    // Hold the winner before its re-keys so the late arrival lands while the
    // winner's plan is still active (charterless shell, foreign plan).
    const loans = memory.collection("bankLoans");
    const origLoans = loans.updateMany.bind(loans);
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    vi.spyOn(loans, "updateMany").mockImplementation(async (filter, update) => {
      await gate;
      return origLoans(filter, update);
    });

    const winnerCall = transferBankCharterToAcquirer(db(), targetId, firstId, now);
    for (let i = 0; i < 5000 && !released; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    expect(released).toBe(true);

    // The shell is already released toward the winner: the latecomer must
    // conflict, not adopt the plan and not re-key toward itself.
    const late = await transferBankCharterToAcquirer(db(), targetId, secondId, now);
    expect(late.ok).toBe(false);
    expect("bankCharter" in corp(secondId)).toBe(false);

    openGate();
    const winnerResult = await winnerCall;
    expect(winnerResult.ok).toBe(true);
    expectUnifiedToward(firstId, secondId);
  });

  it("loser retry mid-rekey conflicts and leaves charter and satellites alone", async () => {
    const loans = memory.collection("bankLoans");
    const origLoans = loans.updateMany.bind(loans);
    let enteredRekey = false;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    vi.spyOn(loans, "updateMany").mockImplementation(async (filter, update) => {
      enteredRekey = true;
      await gate;
      return origLoans(filter, update);
    });

    const winnerCall = transferBankCharterToAcquirer(db(), targetId, firstId, now);
    for (let i = 0; i < 5000 && !enteredRekey; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    expect(enteredRekey).toBe(true);

    const loser = await transferBankCharterToAcquirer(db(), targetId, secondId, now);
    expect(loser.ok).toBe(false);
    // Loser wrote nothing: winner still owns the claim, loser holds no bank,
    // satellites still name the shell, and the winner's token-owned plan
    // survives for the in-flight attempt to finish.
    expect(corp(firstId).bankCharter?.currency).toBe("USD");
    expect("bankCharter" in corp(secondId)).toBe(false);
    const loanRows = memory.collection("bankLoans").docs as unknown as {
      bankCorporationId: ObjectId;
    }[];
    expect(loanRows.every((l) => l.bankCorporationId.equals(targetId))).toBe(true);
    const plan = corp(targetId).bankCharterTransfer;
    expect(plan?.to.equals(firstId)).toBe(true);
    expect(typeof plan?.attemptId).toBe("string");
    expect(typeof plan?.fingerprint).toBe("string");

    openGate();
    const winnerResult = await winnerCall;
    expect(winnerResult.ok).toBe(true);
    expectUnifiedToward(firstId, secondId);
  });

  it("same-pair concurrent retry joins the shared plan and both succeed", async () => {
    const [r1, r2] = await Promise.all([
      transferBankCharterToAcquirer(db(), targetId, firstId, now),
      transferBankCharterToAcquirer(db(), targetId, firstId, now),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const charters = [corp(targetId), corp(firstId)].filter((c) => c.bankCharter);
    expect(charters).toHaveLength(1);
    expectUnifiedToward(firstId, secondId);
  });

  it("same-turn identical charter metadata on a foreign bank is a conflict", async () => {
    // A genuinely different bank that shares every identity field
    // (currency, turn, type, status) must never read as our claimed copy.
    await memory
      .collection("corporations")
      .updateOne(
        { _id: firstId },
        { $set: { bankCharter: { ...makeCharter({ cashReserves: 999 }) }, updatedAt: now } }
      );

    const fresh = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(fresh.ok).toBe(false);
    expect(corp(targetId).bankCharter?.cashReserves).toBe(123_410_000);
    expect(corp(firstId).bankCharter?.cashReserves).toBe(999);
    expect("bankCharterTransfer" in corp(targetId)).toBe(false);

    // Same verdict when our token-owned plan is already stamped and the
    // acquirer then gains the lookalike bank: fingerprint mismatch means the
    // own-claim resume must not fire.
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharterTransfer: {
            to: firstId,
            currency: "USD",
            attemptId: "attempt-for-collision",
            fingerprint: charterFingerprint(corp(targetId).bankCharter as BankCharter),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );
    const retry = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(retry.ok).toBe(false);
    expect(corp(targetId).bankCharter?.cashReserves).toBe(123_410_000);
    expect(corp(firstId).bankCharter?.cashReserves).toBe(999);
    const loanRows = memory.collection("bankLoans").docs as unknown as {
      bankCorporationId: ObjectId;
    }[];
    expect(loanRows.every((l) => l.bankCorporationId.equals(targetId))).toBe(true);
  });

  it("stale token-owned foreign plan is adopted and the orphan claim cleared", async () => {
    const staleId = new ObjectId();
    memory.seed("corporations", [{ _id: staleId, name: "Stale Bidder" }]);
    await memory
      .collection("corporations")
      .updateOne({ _id: staleId }, { $set: { bankCharter: { ...makeCharter() }, updatedAt: now } });
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharterTransfer: {
            to: staleId,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(corp(targetId).bankCharter as BankCharter),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );

    const result = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(result.ok).toBe(true);
    expect("bankCharter" in corp(staleId)).toBe(false);
    expectUnifiedToward(firstId, secondId);
  });

  it("clear-plan write-then-throw converges on retry without double-apply", async () => {
    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let crashed = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await orig(filter, update, options);
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      if (!crashed && unset && "bankCharterTransfer" in unset) {
        crashed = true;
        throw new Error("crash after clear");
      }
      return result;
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, firstId, now)).rejects.toThrow(
      "crash after clear"
    );
    // Clear landed: single charter on the winner, satellites unified, no plan.
    expect(corp(firstId).bankCharter?.currency).toBe("USD");
    expect("bankCharterTransfer" in corp(targetId)).toBe(false);

    const retry = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(retry).toMatchObject({
      ok: true,
      transferred: false,
      loansRekeyed: 0,
      depositorPointersRekeyed: 0,
    });
    expectUnifiedToward(firstId, secondId);
  });

  it("post-completion retry is an idempotent no-op", async () => {
    const first = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(first).toMatchObject({ ok: true, transferred: true });
    const charterBefore = { ...(corp(firstId).bankCharter as BankCharter) };

    const retry = await transferBankCharterToAcquirer(db(), targetId, firstId, now);
    expect(retry).toMatchObject({
      ok: true,
      transferred: false,
      currency: null,
      loansRekeyed: 0,
      interbankSidesRekeyed: 0,
      savingsAccountsRekeyed: 0,
      depositorPointersRekeyed: 0,
    });
    expect(corp(firstId).bankCharter).toEqual(charterBefore);
    expectUnifiedToward(firstId, secondId);
  });
});
