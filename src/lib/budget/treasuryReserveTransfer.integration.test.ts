import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  executeTreasuryReserveTransfer,
  resumeTreasuryReserveTransfers,
} from "./treasuryReserveTransfer";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const actorId = new ObjectId();
const command = {
  operationId: "original",
  countryId: "US" as const,
  amount: 1000,
  turn: 100,
  isAdmin: true,
  actorId,
  actorName: "Synthetic minister",
};
function world(treasury = 10000, reserves = 5000) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", auditLog: true, ledgerShadow: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: 100, preset: "1991-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      treasuryBalance: treasury,
      revenue: { total: 1000000 },
      spending: { total: 900000 },
      surplus: 100000,
      debt: { principal: 0, ceiling: 10000000 },
      gdp: 100000000,
    },
  ]);
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", reserveBalance: reserves, treasuryTransferHistory: [] },
  ]);
  return db;
}
function state(db: ReturnType<typeof world>) {
  const budget = db.collection("federalBudget").docs[0];
  const bank = db.collection("centralBanks").docs[0];
  return {
    treasury: budget.treasuryBalance,
    reserves: bank.reserveBalance,
    spending: budget.spending,
    surplus: budget.surplus,
    history: bank.treasuryTransferHistory,
    pending: bank.pendingTreasuryReserveKey,
  };
}
beforeEach(() => vi.restoreAllMocks());
describe("treasury reserve settlement", () => {
  it.each([
    [10000, 5000],
    [-1000, -5000],
  ])(
    "exchanges signed cash once from %s and %s without changing annual appropriations",
    async (treasury, reserves) => {
      const db = world(treasury, reserves);
      const first = await executeTreasuryReserveTransfer(db as unknown as Db, command);
      expect(first.amount).toBe(1000);
      const after = state(db);
      expect(after).toMatchObject({
        treasury: treasury - 1000,
        reserves: reserves + 1000,
        spending: { total: 900000 },
        surplus: 100000,
        pending: undefined,
      });
      expect(after.history).toHaveLength(1);
      await executeTreasuryReserveTransfer(db as unknown as Db, { ...command, turn: 101 });
      expect(state(db)).toEqual(after);
      expect(db.collection("actionAuditLog").docs).toHaveLength(1);
      expect(db.collection("ledgerEntries").docs).toHaveLength(1);
      expect(db.collection("ledgerEntries").docs[0].balanced).toBe(true);
    }
  );
  it("rejects a reused ID with changed amount or actor", async () => {
    const db = world();
    await executeTreasuryReserveTransfer(db as unknown as Db, command);
    await expect(
      executeTreasuryReserveTransfer(db as unknown as Db, { ...command, amount: 500 })
    ).rejects.toThrow(/different transfer inputs/);
    await expect(
      executeTreasuryReserveTransfer(db as unknown as Db, { ...command, actorId: new ObjectId() })
    ).rejects.toThrow(/different transfer inputs/);
    expect(state(db).treasury).toBe(9000);
  });
  it("accepts a distinct subsequent admin command", async () => {
    const db = world();
    await executeTreasuryReserveTransfer(db as unknown as Db, command);
    await executeTreasuryReserveTransfer(db as unknown as Db, {
      ...command,
      operationId: "second",
    });
    expect(state(db)).toMatchObject({ treasury: 8000, reserves: 7000 });
    expect(state(db).history).toHaveLength(2);
  });
  it.each(["federalBudget", "centralBanks"])(
    "recovers a lost %s cash acknowledgement",
    async (collection) => {
      const db = world();
      const target = db.collection(collection);
      const original = target.updateOne.bind(target);
      let fired = false;
      const fault = vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
        const result = await original(...args);
        if (!fired && args[1].$inc) {
          fired = true;
          throw new Error("lost cash acknowledgement");
        }
        return result;
      });
      await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
        "lost cash acknowledgement"
      );
      expect(fired).toBe(true);
      fault.mockRestore();
      await resumeTreasuryReserveTransfers(db as unknown as Db);
      await executeTreasuryReserveTransfer(db as unknown as Db, command);
      expect(state(db)).toMatchObject({ treasury: 9000, reserves: 6000, pending: undefined });
      expect(state(db).history).toHaveLength(1);
      expect(db.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(1);
    }
  );
  it.each(["federalBudget", "centralBanks"])(
    "recovers an evicted %s receipt without a second cash write",
    async (collection) => {
      const db = world();
      const target = db.collection(collection);
      const original = target.updateOne.bind(target);
      let fired = false;
      const fault = vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
        const out = await original(...args);
        if (!fired && args[1].$inc) {
          fired = true;
          throw new Error("lost acknowledgement");
        }
        return out;
      });
      await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
        "lost acknowledgement"
      );
      fault.mockRestore();
      target.docs[0].settledKeys = Array.from({ length: 200 }, (_, i) => `unrelated:${i}`);
      await resumeTreasuryReserveTransfers(db as unknown as Db);
      expect(state(db)).toMatchObject({ treasury: 9000, reserves: 6000, pending: undefined });
      await executeTreasuryReserveTransfer(db as unknown as Db, {
        ...command,
        operationId: "later",
      });
      await executeTreasuryReserveTransfer(db as unknown as Db, command);
      expect(state(db)).toMatchObject({ treasury: 8000, reserves: 7000, pending: undefined });
    }
  );

  it("recovers a failed ledger projection after both cash legs", async () => {
    const db = world();
    const fault = vi
      .spyOn(db.collection("ledgerEntries"), "insertOne")
      .mockRejectedValueOnce(new Error("ledger interruption"));
    await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
      "ledger interruption"
    );
    fault.mockRestore();
    await resumeTreasuryReserveTransfers(db as unknown as Db);
    expect(state(db)).toMatchObject({ treasury: 9000, reserves: 6000, pending: undefined });
    expect(db.collection("ledgerEntries").docs).toHaveLength(1);
  });
  it("keeps a successful financial result when audit delivery is unavailable and recovers the original event", async () => {
    const db = world();
    const fault = vi
      .spyOn(db.collection("actionAuditLog"), "updateOne")
      .mockRejectedValueOnce(new Error("audit interruption"));
    await executeTreasuryReserveTransfer(db as unknown as Db, command);
    expect(state(db)).toMatchObject({ treasury: 9000, reserves: 6000, pending: undefined });
    fault.mockRestore();
    await resumeTreasuryReserveTransfers(db as unknown as Db);
    expect(db.collection("actionAuditLog").docs).toHaveLength(1);
    expect(db.collection("actionAuditLog").docs[0].turn).toBe(100);
  });
  it("does not release another command's reservation after admission rejection", async () => {
    const db = world();
    db.collection("centralBanks").docs[0].pendingTreasuryReserveKey = "other";
    await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
      /another transfer is pending/
    );
    expect(state(db)).toMatchObject({ treasury: 10000, reserves: 5000, pending: "other" });
    delete db.collection("centralBanks").docs[0].pendingTreasuryReserveKey;
    await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
      /another transfer is pending/
    );
    expect(db.collection("actionAuditLog").docs[0].outcome).toBe("rejected");
  });
  it("concurrent same-ID delivery transfers once", async () => {
    const db = world();
    await Promise.all([
      executeTreasuryReserveTransfer(db as unknown as Db, command),
      executeTreasuryReserveTransfer(db as unknown as Db, command),
    ]);
    expect(state(db)).toMatchObject({ treasury: 9000, reserves: 6000, pending: undefined });
    expect(state(db).history).toHaveLength(1);
  });
  it("refuses missing cash or an excessive quote before claiming or changing reserves", async () => {
    const db = world();
    delete db.collection("federalBudget").docs[0].treasuryBalance;
    await expect(executeTreasuryReserveTransfer(db as unknown as Db, command)).rejects.toThrow(
      /Treasury cash is unavailable/
    );
    expect(db.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    await expect(
      executeTreasuryReserveTransfer(world() as unknown as Db, { ...command, amount: 5001 })
    ).rejects.toThrow(/per-turn cap/);
  });
});
