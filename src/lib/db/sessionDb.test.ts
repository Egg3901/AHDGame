import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession, Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./runRequiredTransaction", () => ({
  runRequiredTransaction: mocks.run,
  RequiredTransactionCleanupError: class extends Error {},
}));
import { afterCommit, boundSession, unboundDb, withSessionDb } from "./sessionDb";
describe("session-bound domain shell", () => {
  const session = {} as ClientSession;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockImplementation(async (work) => work(session));
  });
  const fixture = () => Object.assign(createMockDb(), { client: {} }) as unknown as Db;
  it("binds writes, lazy cursor reads and nested callbacks to one session", async () => {
    const db = fixture();
    const effect = vi.fn(async () => {});
    await withSessionDb(db, async (tx) => {
      expect(boundSession(tx)).toBe(session);
      expect(unboundDb(tx)).toBe(db);
      await tx
        .collection<{ _id: string; balance: number }>("accounts")
        .updateOne({ _id: "x" }, { $inc: { balance: -1 } });
      await tx.collection("accounts").find({}).project({ balance: 1 }).toArray();
      await withSessionDb(tx, async (nested) => {
        expect(nested).toBe(tx);
      });
      await afterCommit(tx, effect);
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(db.collection("accounts").updateOne).toHaveBeenCalledWith(
      { _id: "x" },
      { $inc: { balance: -1 } },
      { session }
    );
    expect(db.collection("accounts").find).toHaveBeenCalledWith({}, { session });
  });
  it("never announces an aborted write", async () => {
    const effect = vi.fn(async () => {});
    await expect(
      withSessionDb(fixture(), async (tx) => {
        await afterCommit(tx, effect);
        throw new Error("failed write");
      })
    ).rejects.toThrow("failed write");
    expect(effect).not.toHaveBeenCalled();
  });
  it("serializes existing Promise.all operations", async () => {
    const db = fixture();
    let active = 0;
    let peak = 0;
    vi.mocked(db.collection("accounts").findOne).mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return null;
    });
    await withSessionDb(db, async (tx) => {
      await Promise.all([
        tx.collection("accounts").findOne({}),
        tx.collection("accounts").findOne({}),
      ]);
    });
    expect(peak).toBe(1);
  });
  it("does not fall back to ambient Mongo when an injected DB lacks a client", async () => {
    const work = vi.fn();
    await expect(withSessionDb(createMockDb() as unknown as Db, work)).rejects.toThrow(
      "supplied Mongo client"
    );
    expect(work).not.toHaveBeenCalled();
  });
  it("stops queued operations after the first transaction error", async () => {
    const db = fixture();
    const write = vi
      .mocked(db.collection("accounts").updateOne)
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(
      withSessionDb(db, async (tx) => {
        await Promise.all([
          tx.collection("accounts").updateOne({}, { $set: { balance: 1 } }),
          tx.collection("accounts").updateOne({}, { $set: { balance: 2 } }),
        ]);
      })
    ).rejects.toThrow("write failed");
    expect(write).toHaveBeenCalledOnce();
  });
  it("discards external effects from a driver retry", async () => {
    const first = vi.fn(async () => {});
    const committed = vi.fn(async () => {});
    let attempt = 0;
    mocks.run.mockImplementation(async (work) => {
      try {
        await work(session);
      } catch {}
      return work(session);
    });
    await withSessionDb(fixture(), async (tx) => {
      attempt++;
      await afterCommit(tx, attempt === 1 ? first : committed);
      if (attempt === 1) throw new Error("retry");
    });
    expect(first).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledOnce();
  });
});
