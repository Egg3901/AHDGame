import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { executeMonetaryOperation, type ExecuteMonetaryOperationInput } from "./operations";
import { resumeMonetaryOperations } from "./monetaryOperationJournal";
import { runInAuditContext } from "@/lib/observability/context";
beforeEach(() => vi.clearAllMocks());
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const bondId = new ObjectId();
function world(shadow = false) {
  const memory = createInMemoryDb();
  memory.seed("centralBanks", [
    { _id: "US", reserveBalance: 100, externalBroadMoney: 1000, netMoneyCreatedLifetime: 0 },
  ]);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: shadow }]);
  memory.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 2 }]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: -1000,
      debt: { principal: 1000 },
    },
  ]);
  memory.seed("bonds", [
    {
      _id: bondId,
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      matured: false,
      defaulted: false,
      publicFloat: 100,
      centralBankHoldings: 10,
      totalIssued: 110000,
      marketPrice: 1,
    },
  ]);
  memory.seed("bondMarketPools", [
    { _id: "USD", cashLocal: 10000, lifetime: { qeIn: 0, qtOut: 0 } },
  ]);
  return memory;
}
function command(
  type: ExecuteMonetaryOperationInput["type"] = "qe"
): ExecuteMonetaryOperationInput {
  return {
    operationId: `test-operation-${type}`,
    countryId: "US",
    type,
    turn: 12,
    actorName: "Chair",
    bondId: bondId.toHexString(),
    units: 5,
    amount: 250,
  };
}
function state(memory: ReturnType<typeof world>) {
  return {
    bank: memory.collection("centralBanks").docs[0],
    bond: memory.collection("bonds").docs[0],
    pool: memory.collection("bondMarketPools").docs[0],
    budget: memory.collection("federalBudget").docs[0],
  };
}
describe("journaled monetary commands", () => {
  it.each(["qe", "qt", "treasury_advance"] as const)(
    "keeps the original %s result across concurrent and later retries",
    async (type) => {
      const memory = world(true),
        db = memory as unknown as Db,
        input = command(type);
      const attempts = await Promise.allSettled([
        executeMonetaryOperation(db, input),
        executeMonetaryOperation(db, input),
      ]);
      expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
      await resumeMonetaryOperations(db, 6);
      const result = await executeMonetaryOperation(db, input);
      const { bank, bond, pool, budget } = state(memory);
      expect(bank.monetaryOperations).toHaveLength(1);
      expect(memory.collection("actionAuditLog").docs).toHaveLength(1);
      expect(memory.collection("actionAuditLog").docs[0]).toMatchObject({
        action: "bank.monetary.executed",
        outcome: "ok",
        meta: { command: `monetary.${type}` },
      });
      expect(bank.reserveBalance).toBe(100);
      expect(bank.externalBroadMoney).toBe(1000);
      expect(bank.pendingLiquidityOperationId).toBeUndefined();
      expect(Number(bond.publicFloat) + Number(bond.centralBankHoldings)).toBe(110);
      expect(pool.cashLocal).toBe(type === "qe" ? 15000 : type === "qt" ? 5000 : 10000);
      expect(budget.treasuryBalance).toBe(type === "treasury_advance" ? -750 : -1000);
      expect(budget.debt).toEqual({ principal: 1000 });
      expect(bank.netMoneyCreatedLifetime).toBe(type === "qe" ? 5000 : type === "qt" ? -5000 : 250);
      expect(result.moneySupplyDelta).toBe(
        type === "treasury_advance" ? 0 : type === "qe" ? 5000 : -5000
      );
      if (type === "treasury_advance") {
        const entries = memory.collection("ledgerEntries").docs;
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ balanced: true, anchorRate: 2 });
        expect(entries[0].legs).toMatchObject([
          { amount: 250, anchorAmount: 125 },
          { amount: -250, anchorAmount: -125 },
        ]);
      }
      const before = JSON.stringify(state(memory));
      expect(await executeMonetaryOperation(db, { ...input, turn: 18 })).toEqual(result);
      expect(JSON.stringify(state(memory))).toBe(before);
      await expect(executeMonetaryOperation(db, { ...input, reason: "different" })).rejects.toThrow(
        /different monetary inputs/
      );
    }
  );
  it.each([
    { type: "qe", collection: "bonds", onCall: 1, afterWrite: true },
    { type: "qe", collection: "bondMarketPools", onCall: 2, afterWrite: true },
    { type: "qt", collection: "bondMarketPools", onCall: 1, afterWrite: true },
    { type: "qt", collection: "bonds", onCall: 1, afterWrite: false },
    { type: "treasury_advance", collection: "federalBudget", onCall: 1, afterWrite: true },
    { type: "treasury_advance", collection: "ledgerEntries", onCall: 1, afterWrite: true },
    { type: "qe", collection: "centralBanks", onCall: 2, afterWrite: true },
  ] as const)("recovers original cash, assets and metadata after %j", async ({ type, ...plan }) => {
    const memory = world(true),
      db = memory as unknown as Db;
    const fault = withInjectedCrash(memory, plan);
    await executeMonetaryOperation(fault.db, command(type)).catch(() => undefined);
    fault.disarm();
    await resumeMonetaryOperations(db, 6);
    await resumeMonetaryOperations(db, 6);
    const result = await executeMonetaryOperation(db, command(type));
    expect(result.amount).toBe(type === "treasury_advance" ? 250 : 5000);
    const { bank, bond, pool, budget } = state(memory);
    expect(bank.monetaryOperations).toHaveLength(1);
    expect(Number(bond.publicFloat) + Number(bond.centralBankHoldings)).toBe(110);
    expect(pool.cashLocal).toBe(type === "qe" ? 15000 : type === "qt" ? 5000 : 10000);
    expect(budget.treasuryBalance).toBe(type === "treasury_advance" ? -750 : -1000);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(
      type === "treasury_advance" ? 1 : 0
    );
  });
  it("refunds a funded QT refusal once even when completion stops after the refund", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const pools = memory.collection("bondMarketPools");
    const poolWrite = pools.updateOne.bind(pools);
    let funded = false;
    vi.spyOn(pools, "updateOne").mockImplementation(async (...args) => {
      const outcome = await poolWrite(...args);
      if (!funded && state(memory).pool.cashLocal === 5000) {
        funded = true;
        await memory.collection("bonds").updateOne({ _id: bondId }, { $set: { matured: true } });
      }
      return outcome;
    });
    const banks = memory.collection("centralBanks"),
      bankWrite = banks.updateOne.bind(banks);
    let interrupt = true;
    vi.spyOn(banks, "updateOne").mockImplementation(async (...args) => {
      if (interrupt && "$unset" in args[1])
        throw new Error("stopped after refund before completion");
      return bankWrite(...args);
    });
    await expect(executeMonetaryOperation(db, command("qt"))).rejects.toThrow(/stopped/);
    expect(state(memory).pool.cashLocal).toBe(10000);
    expect(state(memory).pool.lifetime).toEqual({ qeIn: 0, qtOut: 0 });
    expect(memory.collection("monetaryOperationCommands").docs[0].status).toBe("refunding");
    interrupt = false;
    await resumeMonetaryOperations(db, 6);
    await resumeMonetaryOperations(db, 6);
    await expect(executeMonetaryOperation(db, command("qt"))).rejects.toThrow(/inventory changed/);
    const { bank, pool, bond } = state(memory);
    expect(pool.cashLocal).toBe(10000);
    expect(pool.lifetime).toEqual({ qeIn: 0, qtOut: 0 });
    expect(bond.publicFloat).toBe(100);
    expect(bond.centralBankHoldings).toBe(10);
    expect(bank.monetaryOperations).toBeUndefined();
    expect(bank.netMoneyCreatedLifetime).toBe(0);
    expect(bank.pendingLiquidityOperationId).toBeUndefined();
  });
  it("keeps an unfunded QT refusal final after later pool funding", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await memory
      .collection("bondMarketPools")
      .updateOne({ _id: "USD" }, { $set: { cashLocal: 0 } });
    await expect(executeMonetaryOperation(db, command("qt"))).rejects.toThrow(/cannot absorb/);
    await memory
      .collection("bondMarketPools")
      .updateOne({ _id: "USD" }, { $set: { cashLocal: 10000 } });
    await expect(executeMonetaryOperation(db, command("qt"))).rejects.toThrow(/cannot absorb/);
    expect(state(memory).bond.publicFloat).toBe(100);
    expect(state(memory).pool.cashLocal).toBe(10000);
  });
  it("preserves a concurrent fiscal credit and leaves negative treasury cash valid", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const budgets = memory.collection("federalBudget"),
      write = budgets.updateOne.bind(budgets);
    let added = false;
    vi.spyOn(budgets, "updateOne").mockImplementation(async (...args) => {
      if (!added) {
        added = true;
        await write({ _id: "federal" }, { $inc: { treasuryBalance: 100 } });
      }
      return write(...args);
    });
    const result = await executeMonetaryOperation(db, command("treasury_advance"));
    expect(state(memory).budget.treasuryBalance).toBe(-650);
    expect(result.moneySupplyDelta).toBe(0);
  });
  it("keeps native flag-off credit without FX and rejects unpriced shadow credit before mutation", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    memory.collection("exchangeRates").docs.splice(0);
    await executeMonetaryOperation(db, command("treasury_advance"));
    expect(state(memory).budget.treasuryBalance).toBe(-750);
    await memory
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { ledgerShadow: true } });
    await expect(
      executeMonetaryOperation(db, {
        ...command("treasury_advance"),
        operationId: "unpriced-new-command",
        bypassCooldown: true,
      })
    ).rejects.toThrow(/exchange rate/);
    expect(state(memory).budget.treasuryBalance).toBe(-750);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(0);
  });
  it("shares pending exclusion with liquidity, and permits deliberate admin commands with fresh IDs", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await memory
      .collection("centralBanks")
      .updateOne(
        { _id: "US" },
        { $set: { pendingLiquidityOperationId: "other-liquidity-command" } }
      );
    await expect(executeMonetaryOperation(db, command())).rejects.toThrow(/pending/);
    await memory
      .collection("centralBanks")
      .updateOne({ _id: "US" }, { $unset: { pendingLiquidityOperationId: "" } });
    await executeMonetaryOperation(db, command("treasury_advance"));
    await expect(
      executeMonetaryOperation(db, {
        ...command("treasury_advance"),
        operationId: "second-deliberate-command",
      })
    ).rejects.toThrow(/cooldown/);
    await executeMonetaryOperation(db, {
      ...command("treasury_advance"),
      operationId: "admin-deliberate-command",
      bypassCooldown: true,
    });
    expect(state(memory).budget.treasuryBalance).toBe(-500);
    expect(state(memory).bank.monetaryOperations).toHaveLength(2);
  });
  it.each([
    { collection: "actionAuditLog", onCall: 1, afterWrite: false },
    { collection: "actionAuditLog", onCall: 1, afterWrite: true },
    { collection: "monetaryOperationCommands", onCall: 3, afterWrite: true },
  ])(
    "recovers optional audit delivery with the original actor and one row after %j",
    async (plan) => {
      const memory = world(),
        db = memory as unknown as Db;
      const fault = withInjectedCrash(memory, { ...plan, op: "updateOne" });
      const actorId = new ObjectId();
      const input = { ...command("treasury_advance"), actorClass: "player" as const };
      const result = await runInAuditContext(
        "original-request-trace",
        () => executeMonetaryOperation(fault.db, input),
        { kind: "player", userId: actorId.toHexString() }
      );
      expect(result.amount).toBe(250);
      expect(state(memory).budget.treasuryBalance).toBe(-750);
      expect(memory.collection("monetaryOperationCommands").docs[0].status).toBe("applied");
      fault.disarm();
      await runInAuditContext("different-recovery-trace", () => resumeMonetaryOperations(db, 6), {
        kind: "system",
      });
      await executeMonetaryOperation(db, input);
      const audits = memory.collection("actionAuditLog").docs;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        traceId: "original-request-trace",
        seq: 0,
        actor: { kind: "player", userId: actorId },
        amount: 250,
        outcome: "ok",
      });
      expect(memory.collection("monetaryOperationCommands").docs[0]).toMatchObject({
        auditDelivered: true,
        recoveryPending: false,
      });
      expect(state(memory).budget.treasuryBalance).toBe(-750);
      expect(state(memory).bank.monetaryOperations).toHaveLength(1);
    }
  );
  it("keeps the audit kill switch and indexes only pending recovery", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await memory
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { auditLog: false } });
    await executeMonetaryOperation(db, command());
    await resumeMonetaryOperations(db, 6);
    expect(memory.collection("actionAuditLog").docs).toHaveLength(0);
    expect(memory.collection("monetaryOperationCommands").docs[0].recoveryPending).toBe(false);
    expect(await memory.collection("monetaryOperationCommands").indexes()).toContainEqual(
      expect.objectContaining({
        key: { recoveryPending: 1, _id: 1 },
        partialFilterExpression: { recoveryPending: true },
      })
    );
  });
  it.each([false, true])(
    "retains rejected-admission audit recovery after delivery interruption (ack: %s)",
    async (afterWrite) => {
      const memory = world(),
        db = memory as unknown as Db;
      await memory
        .collection("centralBanks")
        .updateOne({ _id: "US" }, { $set: { pendingLiquidityOperationId: "competing-command" } });
      const fault = withInjectedCrash(memory, {
        collection: "actionAuditLog",
        op: "updateOne",
        onCall: 1,
        afterWrite,
      });
      await expect(executeMonetaryOperation(fault.db, command())).rejects.toThrow(/pending/);
      expect(memory.collection("monetaryOperationCommands").docs[0]).toMatchObject({
        status: "rejected",
        recoveryPending: true,
      });
      fault.disarm();
      await resumeMonetaryOperations(db, 6);
      await resumeMonetaryOperations(db, 6);
      const audits = memory.collection("actionAuditLog").docs;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "bank.monetary.executed",
        outcome: "rejected",
        meta: { command: "monetary.qe" },
      });
      expect(memory.collection("monetaryOperationCommands").docs[0]).toMatchObject({
        recoveryPending: false,
        auditDelivered: true,
      });
      expect(state(memory).bank.pendingLiquidityOperationId).toBe("competing-command");
      expect(state(memory).pool.cashLocal).toBe(10000);
      expect(state(memory).bond.publicFloat).toBe(100);
    }
  );
  it.each(["null", "missing"])("retains legacy %s holdings compatibility", async (kind) => {
    const memory = world(),
      db = memory as unknown as Db;
    await memory
      .collection("bonds")
      .updateOne(
        { _id: bondId },
        kind === "null"
          ? { $set: { centralBankHoldings: null } }
          : { $unset: { centralBankHoldings: "" } }
      );
    const result = await executeMonetaryOperation(db, command());
    expect(result.units).toBe(5);
    expect(state(memory).bond).toMatchObject({ publicFloat: 95, centralBankHoldings: 5 });
    await executeMonetaryOperation(db, command());
    expect(state(memory).pool.cashLocal).toBe(15000);
  });
});
