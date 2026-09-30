import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { CentralBank } from "@/lib/db/types";
import {
  executeReservePoolTransfer,
  resumeReservePoolTransfers,
  type ReservePoolTransferInput,
} from "./reservePoolTransferCommands";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
function fixture() {
  const memory = createInMemoryDb();
  memory.seed("centralBanks", [
    { _id: "US", forexRevenue: 1000, reserveBalance: 800, nationalSavingsBalance: 10000 },
  ]);
  memory.seed("gameConfig", [{ _id: "default", auditLog: true, privateBankingEnabled: false }]);
  const input: ReservePoolTransferInput = {
    operationId: "synthetic-transfer",
    countryId: "US",
    direction: "toLending",
    amount: 400,
    turn: 100,
    isAdmin: false,
    userId: new ObjectId().toHexString(),
  };
  const bank = () => memory.collection("centralBanks").docs[0] as unknown as CentralBank;
  const db = memory as unknown as Db;
  return {
    memory,
    input,
    bank,
    db,
    run: (command = input) => executeReservePoolTransfer(db, structuredClone(bank()), command),
  };
}
describe("journaled reserve-pool commands", () => {
  it.each(["toLending", "toForex"] as const)(
    "preserves %s cash, cooldown and original retry result",
    async (direction) => {
      const f = fixture(),
        command = { ...f.input, direction };
      const result = await f.run(command);
      expect(await f.run({ ...command, turn: 101 })).toEqual(result);
      expect(f.bank()).toMatchObject(
        direction === "toLending"
          ? { forexRevenue: 600, reserveBalance: 1200 }
          : { forexRevenue: 1400, reserveBalance: 400 }
      );
      expect(f.memory.collection("actionAuditLog").docs).toHaveLength(1);
      expect(f.memory.collection("actionAuditLog").docs[0]).toMatchObject({
        actor: { userId: new ObjectId(command.userId) },
      });
    }
  );
  it("refuses conflicting reuse while allowing deliberate new admin transfers", async () => {
    const f = fixture();
    await f.run({ ...f.input, isAdmin: true });
    await expect(f.run({ ...f.input, amount: 200 })).rejects.toThrow("different reserve transfer");
    await f.run({ ...f.input, operationId: "synthetic-next", amount: 200, isAdmin: true });
    expect(f.bank().forexRevenue).toBe(400);
    expect(f.bank().reserveBalance).toBe(1400);
  });
  it("same-ID concurrent delivery moves cash once", async () => {
    const f = fixture();
    const results = await Promise.all([f.run(), f.run()]);
    expect(results[0]).toEqual(results[1]);
    expect(f.bank().forexRevenue).toBe(600);
    expect(f.memory.collection("bankMoneyMoves").docs).toHaveLength(1);
  });
  it("competing original quotes preserve the first cash and cooldown result", async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.run(),
      f.run({ ...f.input, operationId: "competing-transfer" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.bank().forexRevenue).toBe(600);
  });
  it.each([false, true])("recovers financial interruption afterWrite=%s", async (afterWrite) => {
    const f = fixture(),
      col = f.memory.collection("centralBanks"),
      original = col.updateOne.bind(col);
    let failed = false;
    vi.spyOn(col, "updateOne").mockImplementation(async (...args) => {
      if (!failed) {
        failed = true;
        if (afterWrite) await original(...args);
        throw Error("synthetic interruption");
      }
      return original(...args);
    });
    await expect(f.run()).rejects.toThrow("synthetic interruption");
    await resumeReservePoolTransfers(f.db);
    await resumeReservePoolTransfers(f.db);
    expect(f.bank().forexRevenue).toBe(600);
    expect(f.bank().reserveBalance).toBe(1200);
    expect(f.memory.collection("reservePoolTransferCommands").docs[0].status).toBe("applied");
  });
  it("refuses an active loan-book mutation before quoting", async () => {
    const f = fixture();
    await f.memory
      .collection("centralBanks")
      .updateOne({ _id: "US" }, { $set: { pendingLocBookMutationId: "synthetic-loan" } });
    await expect(f.run()).rejects.toThrow("loan settlement is in progress");
    expect(f.bank().reserveBalance).toBe(800);
    expect(f.memory.collection("bankMoneyMoves").docs).toHaveLength(0);
  });
  it("refuses a changed liability revision instead of publishing an old reserve quote", async () => {
    const f = fixture(),
      commands = f.memory.collection("reservePoolTransferCommands");
    const original = commands.insertOne.bind(commands);
    vi.spyOn(commands, "insertOne").mockImplementation(async (...args) => {
      const result = await original(...args);
      await f.memory
        .collection("centralBanks")
        .updateOne({ _id: "US" }, { $inc: { locBookRevision: 1 } });
      return result;
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.bank().reserveBalance).toBe(800);
    expect(f.bank().forexRevenue).toBe(1000);
  });
  it("recovers audit acknowledgement without repeating cash or actor", async () => {
    const f = fixture(),
      col = f.memory.collection("actionAuditLog"),
      original = col.updateOne.bind(col);
    let failed = false;
    vi.spyOn(col, "updateOne").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!failed) {
        failed = true;
        throw Error("synthetic audit acknowledgement");
      }
      return result;
    });
    await f.run();
    expect(f.memory.collection("reservePoolTransferCommands").docs[0].recoveryPending).toBe(true);
    await resumeReservePoolTransfers(f.db);
    await resumeReservePoolTransfers(f.db);
    expect(f.memory.collection("actionAuditLog").docs).toHaveLength(1);
    expect(f.bank().forexRevenue).toBe(600);
    expect(f.memory.collection("reservePoolTransferCommands").docs[0].recoveryPending).toBe(false);
  });
});
