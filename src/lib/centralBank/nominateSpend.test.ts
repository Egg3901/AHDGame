import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyNominateSpend, type CentralBankNomination } from "./nominateSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";

const { supportMock, getMongoClientMock } = vi.hoisted(() => ({
  supportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
  getDb: vi.fn(),
}));

const nominatorId = new ObjectId();
const targetId = new ObjectId();
const BANK_ID = "US";

function nomination(): CentralBankNomination {
  return {
    characterId: targetId,
    characterName: "Target",
    nominatedBy: nominatorId,
    nominatedByName: "Nominator",
    nominatedAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    bankId: BANK_ID,
    nominatorId,
    nomination: nomination(),
    fingerprint: `${BANK_ID}:${targetId.toHexString()}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function seedWorld(memory: InMemoryDb, opts: { actions?: number } = {}) {
  memory.seed("characters", [{ _id: nominatorId, actions: opts.actions ?? 3 }]);
  memory.seed("centralBanks", [{ _id: BANK_ID, nominations: [] }]);
}

function state(memory: InMemoryDb) {
  const character = memory.collection("characters").docs[0] as { actions: number };
  const bank = memory.collection("centralBanks").docs[0] as { nominations: unknown[] };
  return { actions: character.actions, nominations: bank.nominations.length };
}

function receiptStatus(memory: InMemoryDb, key: string) {
  const doc = memory
    .collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION)
    .docs.find((d) => d._id === key) as { status: string } | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc.status;
}

describe("applyNominateSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges one action and lands the nomination", async () => {
    const memory = createInMemoryDb();
    seedWorld(memory);

    const result = await applyNominateSpend(
      withInjectedCrash(memory, { onCall: 999 }).db,
      input({ idempotencyKey: "happy" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(state(memory)).toEqual({ actions: 2, nominations: 1 });
    expect(receiptStatus(memory, "happy")).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 action debit, 3 nomination push,
  // 4 receipt settle. A crash after any of them reconciles on retry with the
  // same key instead of charging or pushing twice.
  it.each([1, 2, 3, 4])(
    "reconciles a crash after write %i to exactly one nomination",
    async (crashAfter) => {
      const memory = createInMemoryDb();
      seedWorld(memory);
      const key = `crash-${crashAfter}`;
      const faulty = withInjectedCrash(memory, { onCall: crashAfter, afterWrite: true });

      await expect(
        applyNominateSpend(faulty.db, input({ idempotencyKey: key }))
      ).rejects.toBeInstanceOf(InjectedCrash);
      expect(faulty.log).toHaveLength(crashAfter);

      faulty.disarm();
      const result = await applyNominateSpend(faulty.db, input({ idempotencyKey: key }));

      // Every crash allowed the first attempt to claim the receipt, so the
      // retry reconciles as the in-progress attempt rather than a fresh one.
      expect(result).toEqual({ duplicate: true });
      expect(state(memory)).toEqual({ actions: 2, nominations: 1 });
      expect(receiptStatus(memory, key)).toBe("completed");
    }
  );

  it("replays a completed key without charging or pushing again", async () => {
    const memory = createInMemoryDb();
    seedWorld(memory);
    const faulty = withInjectedCrash(memory, { onCall: 999 });

    await applyNominateSpend(faulty.db, input({ idempotencyKey: "replay" }));
    const second = await applyNominateSpend(faulty.db, input({ idempotencyKey: "replay" }));

    expect(second).toEqual({ duplicate: true });
    expect(state(memory)).toEqual({ actions: 2, nominations: 1 });
  });

  it("fails closed on insufficient actions and keeps the failure terminal", async () => {
    const memory = createInMemoryDb();
    seedWorld(memory, { actions: 0 });
    const faulty = withInjectedCrash(memory, { onCall: 999 });

    await expect(applyNominateSpend(faulty.db, input({ idempotencyKey: "poor" }))).rejects.toThrow(
      "INSUFFICIENT_ACTIONS"
    );
    expect(state(memory)).toEqual({ actions: 0, nominations: 0 });
    expect(receiptStatus(memory, "poor")).toBe("failed");

    await expect(
      applyNominateSpend(faulty.db, input({ idempotencyKey: "poor" }))
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    expect(state(memory)).toEqual({ actions: 0, nominations: 0 });
  });

  it("rejects a key reused for a different nomination", async () => {
    const memory = createInMemoryDb();
    seedWorld(memory);
    const faulty = withInjectedCrash(memory, { onCall: 999 });

    await applyNominateSpend(faulty.db, input({ idempotencyKey: "shared" }));
    await expect(
      applyNominateSpend(faulty.db, input({ idempotencyKey: "shared", fingerprint: "US:other" }))
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(state(memory)).toEqual({ actions: 2, nominations: 1 });
  });

  it("refunds the action when the nomination push loses its race", async () => {
    // The in-memory harness cannot express the dotted-array `$ne` guard, so
    // the race is modeled with exact-shape mocks: the push matches nothing
    // on a bank that has never seen the key, which the flow reads as
    // guard-rejected and compensates with the negated leg.
    const db: MockDb = createMockDb();
    db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collection("centralBanks").updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collection("centralBanks").findOne.mockResolvedValue({ _id: BANK_ID, nominations: [] });
    db.collection("nonAtomicMoneyFlowReceipts").insertOne.mockResolvedValue({ insertedId: "race" });
    db.collection("nonAtomicMoneyFlowReceipts").findOne.mockResolvedValue(null);

    await expect(
      applyNominateSpend(db as unknown as Db, input({ idempotencyKey: "race" }))
    ).rejects.toThrow("NOMINATION_CONFLICT");

    const charCalls = db.collection("characters").updateOne.mock.calls;
    expect(charCalls).toHaveLength(2);
    // Debit then keyed compensation with the negated delta.
    expect(charCalls[0][1]).toMatchObject({ $inc: { actions: -1 } });
    expect(charCalls[1][0]).toMatchObject({ _id: nominatorId });
    expect(charCalls[1][1]).toMatchObject({ $inc: { actions: 1 } });
  });

  it("preserves the transaction path when the deployment supports it", async () => {
    supportMock.mockResolvedValue(true);
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: (session: unknown) => Promise<unknown>) =>
      callback({})
    );
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const memory = createInMemoryDb();
    seedWorld(memory);
    const result = await applyNominateSpend(
      withInjectedCrash(memory, { onCall: 999 }).db,
      input({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(state(memory)).toEqual({ actions: 2, nominations: 1 });
    expect(receiptStatus(memory, "tx-path")).toBe("completed");
  });
});
