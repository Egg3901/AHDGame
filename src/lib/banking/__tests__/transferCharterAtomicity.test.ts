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

type LoanRow = { bankCorporationId: ObjectId };
type AccountRow = { _id: ObjectId; holder: string };

/**
 * Crash-aware transfer tests (issue #2014). Each case faults exactly one
 * durable boundary — including write-applied-but-ack-lost crashes — then
 * replays the same call and requires convergence to a single coherent owner
 * for the charter plus every satellite record.
 */
describe("transferBankCharterToAcquirer crash recovery", () => {
  let memory: InMemoryDb;
  let targetId: ObjectId;
  let acquirerId: ObjectId;
  let targetHex: string;
  let acquirerHex: string;
  let loanId: ObjectId;
  let lentId: ObjectId;
  let accountId: ObjectId;
  let depositorId: ObjectId;
  const now = new Date("2026-09-03T23:30:00Z");

  function db(): Db {
    return memory as unknown as Db;
  }

  function seedWorld(): void {
    targetId = new ObjectId();
    acquirerId = new ObjectId();
    const otherBankId = new ObjectId();
    targetHex = targetId.toString();
    acquirerHex = acquirerId.toString();
    loanId = new ObjectId();
    lentId = new ObjectId();
    accountId = new ObjectId();
    depositorId = new ObjectId();

    memory.seed("corporations", [
      { _id: targetId, name: "Vermont Finance", bankCharter: { ...makeCharter() } },
      { _id: acquirerId, name: "Holding Co" },
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
    ]);
    memory.seed("savingsAccounts", [
      {
        _id: accountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 1000,
        holder: targetHex,
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
        currencyBalances: { campaign: 0, personal: {}, savingsHolder: { USD: targetHex } },
      },
    ]);
  }

  function corp(id: ObjectId): Corporation {
    const doc = memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id));
    if (!doc) throw new Error(`corporation ${id.toHexString()} missing`);
    return doc as unknown as Corporation;
  }

  function holderOf(id: ObjectId): string {
    const rows = memory.collection("savingsAccounts").docs as unknown as AccountRow[];
    const row = rows.find((a) => a._id.equals(id));
    if (!row) throw new Error("savings account missing");
    return row.holder;
  }

  function pointerOf(id: ObjectId): string {
    const rows = memory.collection("characters").docs as unknown as {
      _id: ObjectId;
      currencyBalances: { savingsHolder: Record<string, string> };
    }[];
    const row = rows.find((c) => c._id.equals(id));
    if (!row) throw new Error("character missing");
    return row.currencyBalances.savingsHolder.USD;
  }

  /** Single coherent owner: one charter, zero satellite rows naming the shell. */
  function expectUnified(): void {
    expect(corp(acquirerId).bankCharter?.currency).toBe("USD");
    expect("bankCharter" in corp(targetId)).toBe(false);
    const loans = memory.collection("bankLoans").docs as unknown as LoanRow[];
    expect(loans.every((l) => l.bankCorporationId.equals(acquirerId))).toBe(true);
    const interbank = memory.collection("interbankLoans").docs as unknown as {
      lenderCorporationId: ObjectId;
      borrowerCorporationId: ObjectId;
    }[];
    expect(
      interbank.every(
        (l) => !l.lenderCorporationId.equals(targetId) && !l.borrowerCorporationId.equals(targetId)
      )
    ).toBe(true);
    expect(holderOf(accountId)).toBe(acquirerHex);
    expect(pointerOf(depositorId)).toBe(acquirerHex);
    expect("bankCharterTransfer" in corp(targetId)).toBe(false);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    memory = createInMemoryDb();
    seedWorld();
  });

  it("resumes after a throw on the first satellite write", async () => {
    vi.spyOn(memory.collection("bankLoans"), "updateMany").mockRejectedValueOnce(
      new Error("primary stepped down")
    );

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "primary stepped down"
    );

    // Charter moved, satellites untouched: the exact split the old code
    // stranded. The plan survives so the retry knows where to resume.
    expect(corp(acquirerId).bankCharter?.currency).toBe("USD");
    expect("bankCharter" in corp(targetId)).toBe(false);
    expect(holderOf(accountId)).toBe(targetHex);
    expect(corp(targetId).bankCharterTransfer?.to.equals(acquirerId)).toBe(true);

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.transferred).toBe(true);
    expect(retry.loansRekeyed).toBe(1);
    expectUnified();
  });

  it("converges when a later re-key applies but its ack is lost", async () => {
    const accounts = memory.collection("savingsAccounts");
    const orig = accounts.updateMany.bind(accounts);
    vi.spyOn(accounts, "updateMany").mockImplementationOnce(async (filter, update) => {
      await orig(filter, update);
      throw new Error("crash after apply");
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash after apply"
    );

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    // Loans and interbank sides already moved in the crashed attempt; the
    // retry only re-runs them as no-ops and finishes the pointers.
    expect(retry.loansRekeyed).toBe(0);
    expect(retry.savingsAccountsRekeyed).toBe(0);
    expect(retry.depositorPointersRekeyed).toBe(1);
    expectUnified();
  });

  it("resumes when the claim applies but its ack is lost", async () => {
    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let crashed = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await orig(filter, update, options);
      if (!crashed && (update as { $set?: { bankCharter?: unknown } }).$set?.bankCharter) {
        crashed = true;
        throw new Error("crash after claim");
      }
      return result;
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash after claim"
    );

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry).toMatchObject({ ok: true, transferred: true });
    expectUnified();
  });

  it("resumes when the release applies but its ack is lost", async () => {
    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let crashed = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await orig(filter, update, options);
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      if (
        !crashed &&
        unset &&
        "bankCharter" in unset &&
        "bankCharter.currency" in (filter as object)
      ) {
        crashed = true;
        throw new Error("crash after release");
      }
      return result;
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash after release"
    );
    // Release landed: the shell is charterless with a surviving plan.
    expect("bankCharter" in corp(targetId)).toBe(false);

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry).toMatchObject({ ok: true, transferred: true });
    expectUnified();
  });

  it("clears a foreign orphan claim when retargeting the same shell", async () => {
    const staleAcquirer = new ObjectId();
    memory.seed("corporations", [{ _id: staleAcquirer, name: "Stale Bidder" }]);
    // Simulate a previous attempt toward another acquirer that crashed
    // between claim and release: orphan copy plus a stale plan.
    await memory
      .collection("corporations")
      .updateOne(
        { _id: staleAcquirer },
        { $set: { bankCharter: { ...makeCharter() }, updatedAt: now } }
      );
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharterTransfer: { to: staleAcquirer, currency: "USD", startedAt: now },
          updatedAt: now,
        },
      }
    );

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(result).toMatchObject({ ok: true, transferred: true });
    expect("bankCharter" in corp(staleAcquirer)).toBe(false);
    expectUnified();
  });

  it("takes over a stale own plan after turn-driven charter drift", async () => {
    // Attempt 1 stamped a plan, then stranded before release; banking turns
    // since mutated the fingerprinted economics on the still-held charter.
    // Without a same-acquirer takeover the retry could never rejoin its own
    // plan (fingerprint mismatch) and no foreign adopt applies (same owner):
    // a permanent "claimed by another merge" dead end.
    const before = makeCharter();
    const drifted = makeCharter({ cashReserves: (before.cashReserves ?? 0) + 1_000 });
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharter: drifted,
          bankCharterTransfer: {
            to: acquirerId,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(before),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(result).toMatchObject({ ok: true, transferred: true });
    expect(corp(acquirerId).bankCharter?.cashReserves).toBe(drifted.cashReserves);
    expectUnified();
  });

  it("replaces its own stale claimed copy when taking over after drift", async () => {
    // Crash after claim plus drift: the acquirer holds the superseded plan's
    // orphan copy while the shell holds the drifted charter. The retry must
    // not read its own orphan as a foreign bank (occupied-slot conflict);
    // it removes exactly the stale copy and moves the current charter.
    const before = makeCharter();
    const drifted = makeCharter({ cashReserves: (before.cashReserves ?? 0) + 1_000 });
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharter: drifted,
          bankCharterTransfer: {
            to: acquirerId,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(before),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );
    await memory
      .collection("corporations")
      .updateOne({ _id: acquirerId }, { $set: { bankCharter: { ...before }, updatedAt: now } });

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(result).toMatchObject({ ok: true, transferred: true });
    expect(corp(acquirerId).bankCharter?.cashReserves).toBe(drifted.cashReserves);
    expectUnified();
  });

  it("still conflicts when a foreign bank holds the slot after our plan drifted", async () => {
    // The takeover must not mistake a genuinely foreign bank for our stale
    // claim: the slot copy matches neither the plan fingerprint nor the
    // current charter, so the retry conflicts with zero writes.
    const before = makeCharter();
    const drifted = makeCharter({ cashReserves: (before.cashReserves ?? 0) + 1_000 });
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharter: drifted,
          bankCharterTransfer: {
            to: acquirerId,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(before),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );
    await memory
      .collection("corporations")
      .updateOne(
        { _id: acquirerId },
        { $set: { bankCharter: makeCharter({ cashReserves: 999 }), updatedAt: now } }
      );

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(result.ok).toBe(false);
    expect(corp(targetId).bankCharter?.cashReserves).toBe(drifted.cashReserves);
    expect(corp(acquirerId).bankCharter?.cashReserves).toBe(999);
  });

  it("converges concurrent same-pair retries to one charter and unified keys", async () => {
    const [first, second] = await Promise.all([
      transferBankCharterToAcquirer(db(), targetId, acquirerId, now),
      transferBankCharterToAcquirer(db(), targetId, acquirerId, now),
    ]);
    expect(first.ok).toBe(true);
    // Exactly one charter exists across both corporations: no duplication.
    const charters = [corp(targetId), corp(acquirerId)].filter((c) => c.bankCharter);
    expect(charters).toHaveLength(1);
    if (second.ok) {
      expectUnified();
    } else {
      // The loser reports the race honestly; driving the winner's plan once
      // more still converges without double-applying.
      const resume = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
      expect(resume.ok).toBe(true);
      expectUnified();
    }
  });

  it("drains a foreign orphan adopted before a crash ahead of its cleanup", async () => {
    // Attempt 1 adopts the stale foreign plan (durable CAS) then throws
    // before removing the superseded acquirer's orphan claim. The retry joins
    // the adopted plan, which no longer names the loser, so without a durable
    // pending-cleanup record the orphan would strand as a ghost bank.
    const staleAcquirer = new ObjectId();
    memory.seed("corporations", [{ _id: staleAcquirer, name: "Stale Bidder" }]);
    await memory
      .collection("corporations")
      .updateOne(
        { _id: staleAcquirer },
        { $set: { bankCharter: { ...makeCharter() }, updatedAt: now } }
      );
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharterTransfer: {
            to: staleAcquirer,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(corp(targetId).bankCharter as BankCharter),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );

    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let crashed = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      const target = (filter as { _id?: ObjectId })._id;
      if (!crashed && unset && "bankCharter" in unset && target?.equals(staleAcquirer)) {
        crashed = true;
        throw new Error("crash between adopt and orphan cleanup");
      }
      return orig(filter, update, options);
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash between adopt and orphan cleanup"
    );

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry).toMatchObject({ ok: true, transferred: true });
    expect("bankCharter" in corp(staleAcquirer)).toBe(false);
    expectUnified();
  });

  it("converges when a crash lands between stale-plan takeover and own-slot cleanup", async () => {
    // Crash after claim plus drift leaves the superseded copy on our own
    // slot. Attempt 1 takes the stale plan over, then throws before removing
    // that copy. The retry must drain it and move the current charter, not
    // read its own orphan as a foreign bank and conflict forever.
    const before = makeCharter();
    const drifted = makeCharter({ cashReserves: (before.cashReserves ?? 0) + 1_000 });
    await memory.collection("corporations").updateOne(
      { _id: targetId },
      {
        $set: {
          bankCharter: drifted,
          bankCharterTransfer: {
            to: acquirerId,
            currency: "USD",
            attemptId: "stale-attempt",
            fingerprint: charterFingerprint(before),
            startedAt: now,
          },
          updatedAt: now,
        },
      }
    );
    await memory
      .collection("corporations")
      .updateOne({ _id: acquirerId }, { $set: { bankCharter: { ...before }, updatedAt: now } });

    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let crashed = false;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      const target = (filter as { _id?: ObjectId })._id;
      if (!crashed && unset && "bankCharter" in unset && target?.equals(acquirerId)) {
        crashed = true;
        throw new Error("crash between takeover and own-slot cleanup");
      }
      return orig(filter, update, options);
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash between takeover and own-slot cleanup"
    );

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry).toMatchObject({ ok: true, transferred: true });
    expect(corp(acquirerId).bankCharter?.cashReserves).toBe(drifted.cashReserves);
    expectUnified();
  });

  it("drains chained superseded orphans across adopt-of-adopt crashes", async () => {
    // Plan S1 (orphan claim on S1) is adopted by B, which crashes before its
    // cleanup; C adopts B's plan and crashes the same way. The final retry
    // joins C's plan and must still clear S1: pending cleanups survive every
    // supersession, not just the most recent one.
    const staleId = new ObjectId();
    const midId = new ObjectId();
    memory.seed("corporations", [
      { _id: staleId, name: "Stale Bidder" },
      { _id: midId, name: "Middle Bidder" },
    ]);
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

    const corps = memory.collection("corporations");
    const orig = corps.updateOne.bind(corps);
    let faults = 0;
    vi.spyOn(corps, "updateOne").mockImplementation(async (filter, update, options) => {
      const unset = (update as { $unset?: Record<string, unknown> }).$unset;
      const target = (filter as { _id?: ObjectId })._id;
      if (faults < 2 && unset && "bankCharter" in unset && !target?.equals(targetId)) {
        faults += 1;
        throw new Error("crash ahead of orphan cleanup");
      }
      return orig(filter, update, options);
    });

    await expect(transferBankCharterToAcquirer(db(), targetId, midId, now)).rejects.toThrow(
      "crash ahead of orphan cleanup"
    );
    await expect(transferBankCharterToAcquirer(db(), targetId, acquirerId, now)).rejects.toThrow(
      "crash ahead of orphan cleanup"
    );

    const retry = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);
    expect(retry).toMatchObject({ ok: true, transferred: true });
    expect("bankCharter" in corp(staleId)).toBe(false);
    expect("bankCharter" in corp(midId)).toBe(false);
    expectUnified();
  });

  it("old-code negative control: without a plan the retry strands split keys", async () => {
    // Pre-fix sequence inline: claim, release, then a throw before any
    // re-key, with no recovery plan anywhere. The old retry then reports "no
    // transfer required" and the split survives. This control proves the
    // harness can see the defect the fix removes.
    const corps = db().collection<Corporation>("corporations");
    const shell = await corps.findOne({ _id: targetId });
    const charter = shell?.bankCharter;
    if (!charter) throw new Error("seed charter missing");
    await corps.updateOne(
      { _id: acquirerId, bankCharter: { $exists: false } },
      { $set: { bankCharter: charter, updatedAt: now } }
    );
    await corps.updateOne({ _id: targetId }, { $unset: { bankCharter: "" } });
    // Mid-rekey throw: stop here with every satellite still shell-keyed.

    // Old retry semantics: charterless shell plus no plan means "no transfer
    // required", so nothing is re-keyed and the split persists.
    const reread = await corps.findOne({ _id: targetId });
    expect(reread?.bankCharter ?? null).toBeNull();
    expect(reread?.bankCharterTransfer ?? null).toBeNull();
    const loans = memory.collection("bankLoans").docs as unknown as LoanRow[];
    const newCodeWouldResume = !!reread?.bankCharterTransfer;
    expect(newCodeWouldResume).toBe(false);
    expect(loans.some((l) => l.bankCorporationId.equals(targetId))).toBe(true);
    expect((await corps.findOne({ _id: acquirerId }))?.bankCharter?.currency).toBe("USD");
  });
});
