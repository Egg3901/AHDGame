import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { openPosition, closePosition, quoteForexPosition } from "../propTrading";
import { recoverPropForexFees, settlePendingPropForexFee } from "../propForexFees";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { resumeSettlement } from "../settlementJournal";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const BANK = new ObjectId();
const ticket = { asset: "forex" as const, ref: "GBP", units: 100_000 };
function world() {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      bankPropForexFeesEnabled: true,
    },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 100 }]);
  memory.seed("exchangeRates", [
    { currencyCode: "USD", rate: 1 },
    { currencyCode: "GBP", rate: 2 },
  ]);
  memory.seed("centralBanks", [
    { _id: "US", forexRevenue: 0, spreadFeeReserveBalances: { USD: 0 } },
  ]);
  memory.seed("corporations", [
    {
      _id: BANK,
      name: "Test Bank",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 0,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        cashReserves: 1_000_000,
        postedCapital: 1_000_000,
        depositOffset: 0,
        lendingOffset: 0,
        propBook: [],
        propBookMarkValue: 0,
      },
    },
  ]);
  return memory;
}
function bank(memory: InMemoryDb) {
  return memory.collection("corporations")
    .docs[0] as unknown as import("@/lib/db/types").Corporation;
}
beforeEach(() => {
  vi.clearAllMocks();
  resetCorpFxRateCacheForTests();
});

describe("funded forex prop fees", () => {
  it.each(["npc", "authoritative-player"])(
    "keeps %s deposit cash outside prop equity",
    async (kind) => {
      const memory = world();
      const charter = bank(memory).bankCharter!;
      charter.type = "universal";
      if (kind === "npc") charter.npcDeposits = 940_000;
      else {
        charter.playerDeposits = 940_000;
        memory.collection("gameConfig").docs[0].savingsAccountsMode = "authoritative";
        memory.collection("gameConfig").docs[0].savingsAccountsReadCurrencies = ["USD"];
      }
      const result = await openPosition(memory as unknown as Db, BANK, ticket);
      expect(result).toEqual({ ok: false, error: "Trade would breach per-currency forex cap" });
      expect(charter.cashReserves).toBe(1_000_000);
      expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
    }
  );
  it("quotes without writing and refuses a worse live cash price", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const snapshot = JSON.stringify(memory.collection("corporations").docs[0]);
    const quote = await quoteForexPosition(db, BANK, ticket);
    expect(quote.ok).toBe(true);
    expect(JSON.stringify(memory.collection("corporations").docs[0])).toBe(snapshot);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
    if (!quote.ok) return;
    memory.collection("exchangeRates").docs[1].rate = 1;
    const result = await openPosition(db, BANK, { ...ticket, maxCost: quote.cost });
    expect(result).toEqual({ ok: false, error: "Cash quote changed; request a new quote" });
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
    expect(bank(memory).bankCharter!.cashReserves).toBe(1_000_000);
  });
  it("prevents concurrent different purchases from overwriting the book or duplicating fees", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const results = await Promise.all([
      openPosition(db, BANK, ticket),
      openPosition(db, BANK, { ...ticket, units: 110_000 }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results.find((result) => result.ok)!;
    if (!winner.ok) return;
    expect(bank(memory).bankCharter!.propBook).toHaveLength(1);
    expect(bank(memory).bankCharter!.cashReserves).toBeCloseTo(1_000_000 - winner.cost, 6);
    expect(bank(memory).bankPropForexVolume).toEqual([
      { turn: 100, anchorAmount: winner.position.markValue },
    ]);
    expect(memory.collection("centralBanks").docs[0].forexRevenue).toBe(
      roundSavingsAmount(winner.fee! * 0.25, "USD")
    );
  });
  it("conserves bank wealth, CB receipts and the published burn on a round trip", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const opened = await openPosition(db, BANK, ticket);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.fee).toBeGreaterThan(0);
    expect(opened.position.markValue).toBe(50_000);
    expect(bank(memory).bankCharter!.cashReserves).toBeCloseTo(950_000 - opened.fee!, 6);
    expect(bank(memory).bankPropForexFee).toBeUndefined();
    const closed = await closePosition(db, BANK, ticket);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.realizedPnl).toBeCloseTo(-opened.fee! - closed.fee!, 6);
    const cb = memory.collection("centralBanks").docs[0];
    const totalFee = opened.fee! + closed.fee!;
    const burned = memory
      .collection("bankMoneyMoves")
      .docs.filter((row) => row.kind === "bank.prop.forex.fee")
      .flatMap((row) => row.legs as { kind: string; amount: number }[])
      .filter((row) => row.kind === "burn")
      .reduce((sum, row) => sum + row.amount, 0);
    expect(
      bank(memory).bankCharter!.cashReserves! +
        Number(cb.forexRevenue) +
        Number((cb.spreadFeeReserveBalances as { USD: number }).USD) +
        burned
    ).toBeCloseTo(1_000_000, 6);
    expect(bank(memory).bankCharter!.cashReserves).toBeCloseTo(1_000_000 - totalFee, 6);
    expect(bank(memory).bankPropForexVolume).toEqual([{ turn: 100, anchorAmount: 100_000 }]);
  });
  it.each([false, true])(
    "recovers a CB fee credit interruption once (after=%s)",
    async (afterWrite) => {
      const memory = world();
      const faulty = withInjectedCrash(memory, {
        collection: "centralBanks",
        op: "updateOne",
        onCall: 1,
        afterWrite,
        matches: (args) =>
          Number((args[1] as { $inc?: Record<string, number> }).$inc?.forexRevenue ?? 0) > 0,
      });
      const result = await openPosition(faulty.db, BANK, ticket);
      expect(result.ok).toBe(true);
      expect(bank(memory).bankPropForexFee).toBeDefined();
      const cash = bank(memory).bankCharter!.cashReserves;
      faulty.disarm();
      expect(await settlePendingPropForexFee(memory as unknown as Db, BANK)).toBe(true);
      expect(await settlePendingPropForexFee(memory as unknown as Db, BANK)).toBe(true);
      expect(bank(memory).bankCharter!.cashReserves).toBe(cash);
      expect(bank(memory).bankPropForexFee).toBeUndefined();
      expect(
        memory.collection("bankMoneyMoves").docs.filter((row) => row.kind === "bank.prop.forex.fee")
      ).toHaveLength(1);
      if (result.ok)
        expect(memory.collection("centralBanks").docs[0].forexRevenue).toBe(
          roundSavingsAmount(result.fee! * 0.25, "USD")
        );
    }
  );
  it("recovers an unclaimed fee after the atomic book write and preserves its original epoch", async () => {
    const memory = world();
    const faulty = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) =>
        Number(
          (args[1] as { $inc?: Record<string, number> }).$inc?.["bankCharter.cashReserves"] ?? 0
        ) < 0,
    });
    await openPosition(faulty.db, BANK, ticket).catch(() => undefined);
    const receipt = memory
      .collection("bankMoneyMoves")
      .docs.find((row) => row.kind === "bank.prop.buy")!;
    expect(bank(memory).bankPropForexFee).toBeDefined();
    await resumeSettlement(memory as unknown as Db, String(receipt._id));
    bank(memory).bankCharter!.charteredTurn = 101;
    bank(memory).bankCharter!.cashReserves = 1234;
    expect(await recoverPropForexFees(memory as unknown as Db, 101)).toEqual([]);
    expect(bank(memory).bankCharter!.cashReserves).toBe(1234);
    expect(bank(memory).bankPropForexFee).toBeUndefined();
    expect(memory.collection("centralBanks").docs[0].forexRevenue).toBeGreaterThan(0);
  });
  it("retains the per-currency cap after deducting fees from equity", async () => {
    const memory = world();
    const result = await openPosition(memory as unknown as Db, BANK, {
      ...ticket,
      units: 1_000_000,
    });
    expect(result).toEqual({ ok: false, error: "Trade would breach per-currency forex cap" });
    expect(bank(memory).bankCharter!.cashReserves).toBe(1_000_000);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
  });
  it("keeps legacy forex trading when the fee flag is off", async () => {
    const memory = world();
    memory.collection("gameConfig").docs[0].bankPropForexFeesEnabled = false;
    memory.collection("centralBanks").docs.length = 0;
    const reads = vi.spyOn(memory.collection("corporations"), "findOne");
    const feeRecipientReads = vi.spyOn(memory.collection("centralBanks"), "findOne");
    const result = await openPosition(memory as unknown as Db, BANK, ticket);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cost).toBe(50_000);
    expect(feeRecipientReads).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledWith(
      { _id: BANK },
      { projection: { bankPropForexFee: 0, bankPropForexVolume: 0 } }
    );
    expect(bank(memory).bankPropForexVolume).toBeUndefined();
    expect(
      memory.collection("bankMoneyMoves").docs.filter((row) => row.kind === "bank.prop.forex.fee")
    ).toHaveLength(0);
  });
});
