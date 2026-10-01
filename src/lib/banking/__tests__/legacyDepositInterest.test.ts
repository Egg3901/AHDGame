import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { settleLegacyDepositInterest } from "../legacyDepositInterest";
import { resumeSettlement } from "../settlementJournal";
import { MONEY_MOVE_COLLECTION, resumeMoneyMove } from "../moneyMove";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const bankId = new ObjectId(),
  a = new ObjectId(),
  b = new ObjectId();
const input = {
  key: "deposit-interest:fixture:4",
  bankId,
  bankName: "Fixture Bank",
  currency: "USD" as const,
  charteredTurn: 1,
  turn: 4,
  credits: [
    { characterId: a, amount: 10, name: "Saver A" },
    { characterId: b, amount: 20, name: "Saver B" },
  ],
  npcInterestPaid: 5,
  ratePercent: 2,
};
function world() {
  const memory = createInMemoryDb();
  memory.seed("corporations", [
    {
      _id: bankId,
      bankCharter: {
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        cashReserves: 100,
      },
    },
  ]);
  memory.seed(
    "characters",
    [a, b].map((_id) => ({
      _id,
      currencyBalances: { savings: { USD: 1000 }, interestEarned: { USD: 0 } },
    }))
  );
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  return memory;
}
function balances(memory: ReturnType<typeof world>) {
  return {
    bank: (memory.collection("corporations").docs[0].bankCharter as { cashReserves: number })
      .cashReserves,
    savers: memory
      .collection("characters")
      .docs.map((row) => (row.currencyBalances as { savings: { USD: number } }).savings.USD),
  };
}
beforeEach(() => vi.clearAllMocks());
describe("legacy savings interest batches", () => {
  it("freezes allocations and NPC quote, completes once and ignores repriced retries", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const first = await settleLegacyDepositInterest(db, input);
    expect(first.newlyDebited).toBe(30);
    expect([...first.newlyCredited.values()]).toEqual([10, 20]);
    const replay = await settleLegacyDepositInterest(db, {
      ...input,
      credits: [],
      npcInterestPaid: 0,
    });
    expect(replay).toMatchObject({ paid: 30, npcInterestPaid: 5, newlyDebited: 0 });
    expect(replay.newlyCredited.size).toBe(0);
    expect(balances(memory)).toEqual({ bank: 70, savers: [1010, 1020] });
    expect(memory.collection("financialTxLog").docs).toHaveLength(2);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(2);
  });
  it.each([
    ["corporations", "updateOne", false],
    ["corporations", "updateOne", true],
    ["characters", "bulkWrite", false],
    ["characters", "bulkWrite", true],
    ["financialTxLog", "bulkWrite", false],
    ["financialTxLog", "bulkWrite", true],
    ["ledgerEntries", "bulkWrite", false],
    ["ledgerEntries", "bulkWrite", true],
  ] as const)("recovers interruption %s.%s after=%s", async (collection, op, afterWrite) => {
    const memory = world(),
      db = memory as unknown as Db;
    const faulty = withInjectedCrash(memory, { collection, op, afterWrite, onCall: 1 });
    await expect(settleLegacyDepositInterest(faulty.db, input)).rejects.toThrow();
    expect((await resumeMoneyMove(db, input.key)).status).toBe("rejected");
    expect((await resumeSettlement(db, input.key)).status).toBe("applied");
    expect((await resumeSettlement(db, input.key)).status).toBe("replayed");
    expect(balances(memory)).toEqual({ bank: 70, savers: [1010, 1020] });
    expect(memory.collection("financialTxLog").docs).toHaveLength(2);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(2);
    expect(memory.collection(MONEY_MOVE_COLLECTION).docs[0].legs).toMatchObject([
      { applied: true },
      { applied: true },
      { applied: true },
    ]);
  });
  it("conserves the original batch when two deliveries share its key", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await Promise.all([
      settleLegacyDepositInterest(db, input),
      settleLegacyDepositInterest(db, input),
    ]);
    expect(balances(memory)).toEqual({ bank: 70, savers: [1010, 1020] });
    expect(memory.collection("financialTxLog").docs).toHaveLength(2);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(2);
  });
  it("resumes a partially delivered recipient bulk without recrediting its first saver", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const original = memory
      .collection("characters")
      .bulkWrite.bind(memory.collection("characters"));
    let interrupted = false;
    const write = vi
      .spyOn(memory.collection("characters"), "bulkWrite")
      .mockImplementation(async (ops) => {
        if (!interrupted) {
          interrupted = true;
          await original(ops.slice(0, 1));
          throw new Error("recipient bulk interrupted after first saver");
        }
        return original(ops);
      });
    await expect(settleLegacyDepositInterest(db, input)).rejects.toThrow("first saver");
    expect(balances(memory)).toEqual({ bank: 70, savers: [1010, 1000] });
    const resumed = await settleLegacyDepositInterest(db, {
      ...input,
      credits: [],
      npcInterestPaid: 0,
    });
    expect(resumed.newlyDebited).toBe(0);
    expect([...resumed.newlyCredited]).toEqual([[b.toHexString(), 20]]);
    expect(balances(memory)).toEqual({ bank: 70, savers: [1010, 1020] });
    write.mockRestore();
  });
  it("keeps write round trips constant for two and two hundred recipients", async () => {
    const counts: number[] = [];
    for (const count of [2, 200]) {
      const memory = world();
      const credits = Array.from({ length: count }, () => ({
        characterId: new ObjectId(),
        amount: 0.1,
        name: "Synthetic saver",
      }));
      await memory.collection("characters").deleteMany({});
      memory.seed(
        "characters",
        credits.map((credit) => ({
          _id: credit.characterId,
          currencyBalances: { savings: { USD: 1 } },
        }))
      );
      const measured = withInjectedCrash(memory, { onCall: 10000 });
      await settleLegacyDepositInterest(measured.db, { ...input, credits });
      counts.push(measured.log.length);
      expect(memory.collection("financialTxLog").docs).toHaveLength(count);
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(6);
  });
  it("requires manual recovery for an old claim without durable allocations", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    memory.seed(MONEY_MOVE_COLLECTION, [{ _id: input.key, status: "partial", legs: [] }]);
    await expect(settleLegacyDepositInterest(db, input)).rejects.toThrow("manual recovery");
    expect(balances(memory)).toEqual({ bank: 100, savers: [1000, 1000] });
  });
  it("never redirects an original recipient or credits an unfunded batch", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await db.collection("characters").deleteOne({ _id: b });
    await expect(settleLegacyDepositInterest(db, input)).rejects.toThrow("recipient missing");
    expect(balances(memory).bank).toBe(100);
    expect(balances(memory).savers).toEqual([1000]);
  });
});
