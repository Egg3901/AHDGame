import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { executeMonetaryOperation } from "./operations";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", async (original) => ({
  ...(await original<typeof import("@/lib/audit/recordAudit")>()),
  recordAudit: vi.fn(),
  recordAuditBulk: vi.fn(),
}));
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture(type: "liquidity_injection" | "treasury_advance") {
  const memory = createInMemoryDb();
  memory.seed("centralBanks", [{ _id: "US", reserveBalance: 100, netMoneyCreatedLifetime: 0 }]);
  memory.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: false, ledgerShadow: false, auditLog: false },
  ]);
  memory.seed("federalBudget", [{ _id: "federal", countryId: "US", treasuryBalance: 0 }]);
  const input = {
    countryId: "US" as const,
    type,
    turn: 20,
    actorName: "Synthetic admin",
    amount: 250,
    operationId: `admin-admission-${type}`,
    bypassCooldown: true,
  };
  const reservation =
    type === "liquidity_injection" ? input.operationId : `monetary:${input.operationId}`;
  const collection =
    type === "liquidity_injection" ? "bankLiquidityOperations" : "monetaryOperationCommands";
  return { memory, db: memory as unknown as Db, input, reservation, collection };
}
function delayedDb(
  memory: ReturnType<typeof createInMemoryDb>,
  hook: (
    name: string,
    method: string,
    args: unknown[],
    apply: () => Promise<unknown>
  ) => Promise<unknown>
): Db {
  return {
    collection: (name: string) => {
      const collection = memory.collection(name);
      return new Proxy(collection, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) =>
            hook(name, String(property), args, () => value.apply(target, args));
        },
      });
    },
  } as unknown as Db;
}
describe("monetary admission interleavings", () => {
  it.each(["liquidity_injection", "treasury_advance"] as const)(
    "releases a delayed %s retry's reservation after the original result completed",
    async (type) => {
      const { memory, db, input, reservation } = fixture(type);
      const paused = latch(),
        resume = latch();
      let delayed = false;
      const slow = delayedDb(memory, async (name, method, args, apply) => {
        if (
          !delayed &&
          name === "centralBanks" &&
          method === "findOne" &&
          (args[0] as Record<string, unknown>).pendingLiquidityOperationId === reservation
        ) {
          delayed = true;
          paused.release();
          await resume.promise;
        }
        return apply();
      });
      const first = executeMonetaryOperation(slow, input);
      await paused.promise;
      const result = await executeMonetaryOperation(db, input);
      resume.release();
      expect(await first).toEqual(result);
      const bank = memory.collection("centralBanks").docs[0];
      expect(bank.pendingLiquidityOperationId).toBeUndefined();
      expect(bank.monetaryOperations).toHaveLength(1);
      expect(bank.reserveBalance).toBe(type === "liquidity_injection" ? 350 : 100);
      expect(memory.collection("federalBudget").docs[0].treasuryBalance).toBe(
        type === "treasury_advance" ? 250 : 0
      );
    }
  );
  it.each(["liquidity_injection", "treasury_advance"] as const)(
    "a rejected %s command cannot retain a later reservation or deliver money",
    async (type) => {
      const { memory, input, reservation, collection } = fixture(type);
      await memory
        .collection("centralBanks")
        .updateOne({ _id: "US" }, { $set: { pendingLiquidityOperationId: "another-command" } });
      const observed = latch(),
        allowReject = latch(),
        claimed = latch(),
        allowAdmit = latch();
      let reads = 0;
      const rejecter = delayedDb(memory, async (name, method, args, apply) => {
        const result = await apply();
        if (
          name === "centralBanks" &&
          method === "findOne" &&
          (args[0] as Record<string, unknown>).pendingLiquidityOperationId === reservation &&
          ++reads === 2
        ) {
          observed.release();
          await allowReject.promise;
        }
        return result;
      });
      const first = executeMonetaryOperation(rejecter, input).then(
        () => "applied",
        () => "rejected"
      );
      await observed.promise;
      await memory
        .collection("centralBanks")
        .updateOne({ _id: "US" }, { $unset: { pendingLiquidityOperationId: "" } });
      const contender = delayedDb(memory, async (name, method, args, apply) => {
        const update = args[1] as { $set?: { status?: string } } | undefined;
        if (name === collection && method === "updateOne" && update?.$set?.status === "admitted") {
          claimed.release();
          await allowAdmit.promise;
        }
        return apply();
      });
      const second = executeMonetaryOperation(contender, input).then(
        () => "applied",
        () => "rejected"
      );
      await claimed.promise;
      allowReject.release();
      expect(await first).toBe("rejected");
      allowAdmit.release();
      expect(await second).toBe("rejected");
      const bank = memory.collection("centralBanks").docs[0];
      expect(bank.pendingLiquidityOperationId).toBeUndefined();
      expect(bank.monetaryOperations).toBeUndefined();
      expect(bank.reserveBalance).toBe(100);
      expect(memory.collection("federalBudget").docs[0].treasuryBalance).toBe(0);
      expect(memory.collection(collection).docs[0].status).toBe("rejected");
    }
  );
});
