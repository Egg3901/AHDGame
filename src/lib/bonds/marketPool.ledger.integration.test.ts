/** Actual bond-pool cash movements must have balanced, currency-correct witnesses. */
import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { processBondMarketPoolTurn } from "./marketPoolTurn";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import { deriveLedgerEntry } from "@/lib/ledger/deriveFromTx";
import { loadBondPoolLedgerContext, withBondPoolLedgerBatch } from "./marketPoolLedger";
import { creditBondPool, debitBondPoolGated } from "./marketPool";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn().mockResolvedValue(null),
}));
beforeEach(() => {
  vi.clearAllMocks();
  resetLedgerShadowFlagCache();
});
const NOW = new Date("2026-10-01T00:00:00Z"),
  TURN = 25;
const cases = [
  { currency: "USD" as const, rate: 1 },
  { currency: "GBP" as const, rate: 0.5 },
];
it.each(cases)("reconciles actual modeled upkeep in $currency", async ({ currency, rate }) => {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, preset: "1991-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: currency, rate }]);
  memory.seed("bondMarketPools", [{ _id: currency, cashLocal: 100, targetCashLocal: 500 }]);
  memory.seed("moneySupplySnapshots", [{ currencyCode: currency, m2: 10000, turn: 24 }]);
  const opening = await collectBalances(db);
  const result = await processBondMarketPoolTurn(db, TURN, NOW);
  expect(result.inflowLocalByCurrency[currency]).toBe(8);
  const closing = await collectBalances(db);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  const report = reconcileLedger({
    turn: TURN,
    entries,
    openingBalances: opening,
    closingBalances: closing,
  });
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
  expect(report.stockVsFlow.findings).toEqual([]);
});
it.each(cases)("reconciles actual coupon receipts in $currency", async ({ currency, rate }) => {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, preset: "1991-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: currency, rate }]);
  memory.seed("bondMarketPools", [{ _id: currency, cashLocal: 100, targetCashLocal: 500 }]);
  const opening = await collectBalances(db);
  await creditBondPool(db, currency, 2.345, "couponsIn", NOW);
  const closing = await collectBalances(db);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  const report = reconcileLedger({
    turn: TURN,
    entries,
    openingBalances: opening,
    closingBalances: closing,
  });
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
  expect(report.stockVsFlow.findings).toEqual([]);
});

function fixture(currency: "USD" | "GBP" = "USD", rate = 1, cashLocal = 100, enabled = true) {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: enabled }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, preset: "1991-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: currency, rate }]);
  memory.seed("bondMarketPools", [{ _id: currency, cashLocal, targetCashLocal: 500 }]);
  memory.seed("moneySupplySnapshots", [{ currencyCode: currency, m2: 10000, turn: TURN - 1 }]);
  return { memory, db };
}

it.each(cases)(
  "reconciles actual sweep in $currency with excluded inventory attribution",
  async ({ currency, rate }) => {
    const { db } = fixture(currency, rate, 1200);
    const opening = await collectBalances(db);
    const result = await processBondMarketPoolTurn(db, TURN, NOW);
    expect(result.sweptLocalByCurrency[currency]).toBe(450);
    const closing = await collectBalances(db);
    const entries = await db
      .collection<LedgerEntry>("ledgerEntries")
      .find({ turn: TURN })
      .toArray();
    const report = reconcileLedger({
      turn: TURN,
      entries,
      openingBalances: opening,
      closingBalances: closing,
    });
    expect(report.stockVsFlow.findings).toEqual([]);
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.unattributed).toEqual([]);
    expect(entries[0].legs[1].account).toBe(`sink:bond_pool_excluded_liquidity:${currency}`);
    expect(report.moneySupply.findings[0].byReason).toEqual([
      { reason: "bond_pool_excluded_liquidity", mint: 0, sink: 450 / rate },
    ]);
  }
);

it.each(cases)(
  "pairs actual coupon and maturity receipts with the issuer in $currency",
  async ({ currency, rate }) => {
    const { memory, db } = fixture(currency, rate);
    const issuer = new ObjectId();
    memory.seed("corporations", [
      { _id: issuer, liquidCapital: 1000, liquidCurrencyCode: currency },
    ]);
    const opening = await collectBalances(db);
    for (const [kind, txType, paid] of [
      ["couponsIn", "bond_coupon", 2.35],
      ["maturitiesIn", "bond_maturity", 100],
    ] as const) {
      await db
        .collection("corporations")
        .updateOne({ _id: issuer }, { $inc: { liquidCapital: -paid } });
      const issuerEntry = deriveLedgerEntry({
        type: txType,
        turn: TURN,
        createdAt: NOW,
        subjectType: "corporation",
        subjectId: issuer,
        amount: -paid,
        currencyCode: currency,
        anchorAmount: -paid / rate,
      });
      expect(issuerEntry).not.toBeNull();
      await emitLedgerEntries(db, [issuerEntry!]);
      await creditBondPool(db, currency, paid, kind, NOW);
    }
    const closing = await collectBalances(db);
    const entries = await db
      .collection<LedgerEntry>("ledgerEntries")
      .find({ turn: TURN })
      .toArray();
    expect(entries).toHaveLength(4);
    const report = reconcileLedger({
      turn: TURN,
      entries,
      openingBalances: opening,
      closingBalances: closing,
    });
    expect(report.stockVsFlow.findings).toEqual([]);
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.unattributed).toEqual([]);
    expect(report.moneySupply.findings[0].netDrift).toBe(0);
  }
);

it("does not emit for failed, stamped-repeat or zero gated debits and invalid credits", async () => {
  const { db } = fixture();
  const opening = await collectBalances(db);
  expect(await debitBondPoolGated(db, "USD", 101, "sweepOut", NOW)).toEqual({ ok: false });
  expect(await debitBondPoolGated(db, "USD", 0, "sweepOut", NOW)).toEqual({
    ok: true,
    cashAfter: 100,
  });
  for (const amount of [0, -1, NaN, Infinity])
    await creditBondPool(db, "USD", amount, "couponsIn", NOW);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
  expect(await debitBondPoolGated(db, "USD", 10, "sweepOut", NOW, { stamp: "sweep-once" })).toEqual(
    { ok: true, cashAfter: 90 }
  );
  expect(await debitBondPoolGated(db, "USD", 10, "sweepOut", NOW, { stamp: "sweep-once" })).toEqual(
    { ok: false }
  );
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(1);
  const closing = await collectBalances(db);
  expect(
    reconcileLedger({ turn: TURN, entries, openingBalances: opening, closingBalances: closing })
      .stockVsFlow.findings
  ).toEqual([]);
});

it("preserves cash outcomes with shadow disabled", async () => {
  const { db } = fixture("USD", 1, 100, false);
  await processBondMarketPoolTurn(db, TURN, NOW);
  await creditBondPool(db, "USD", 2.345, "couponsIn", NOW);
  expect(
    (
      await db
        .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
        .findOne({ _id: "USD" })
    )?.cashLocal
  ).toBe(110.35);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});

it("keeps primary placement journal-owned while witnessing secondary trades", async () => {
  const { db } = fixture();
  await creditBondPool(db, "USD", 20, "purchasesIn", NOW);
  await debitBondPoolGated(db, "USD", 20, "issuanceOut", NOW);
  await debitBondPoolGated(db, "USD", 20, "salesOut", NOW);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(2);
});

it("uses the processing turn rather than a stale game clock", async () => {
  const { memory, db } = fixture();
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1 }]);
  await processBondMarketPoolTurn(db, TURN, NOW);
  expect(await db.collection("ledgerEntries").countDocuments({ turn: TURN })).toBe(1);
  expect(await db.collection("ledgerEntries").countDocuments({ turn: TURN - 1 })).toBe(0);
});

it("matches the snapshot fallback when a currency has no FX observation", async () => {
  const { memory, db } = fixture("GBP", 0);
  memory.seed("exchangeRates", []);
  const opening = await collectBalances(db);
  await creditBondPool(db, "GBP", 2.345, "maturitiesIn", NOW);
  const closing = await collectBalances(db);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries[0].legs[0].anchorAmount).toBe(2.35);
  expect(
    reconcileLedger({ turn: TURN, entries, openingBalances: opening, closingBalances: closing })
      .stockVsFlow.findings
  ).toEqual([]);
});

it("reuses a loaded context without a flag, clock or FX query per receipt", async () => {
  const { db } = fixture();
  const context = await loadBondPoolLedgerContext(db, TURN);
  const configRead = vi.spyOn(db.collection("gameConfig"), "findOne");
  const fxRead = vi.spyOn(db.collection("exchangeRates"), "find");
  const stateRead = vi.spyOn(db.collection("gameState"), "findOne");
  await creditBondPool(db, "USD", 2.35, "couponsIn", NOW, { ledgerContext: context });
  await creditBondPool(db, "USD", 100, "maturitiesIn", NOW, { ledgerContext: context });
  expect(configRead).not.toHaveBeenCalled();
  expect(fxRead).not.toHaveBeenCalled();
  expect(stateRead).not.toHaveBeenCalled();
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(2);
});

it("does not fail successful cash writes when shadow insertion fails", async () => {
  const { db } = fixture();
  vi.spyOn(db.collection("ledgerEntries"), "insertMany").mockRejectedValue(
    new Error("shadow insert failure")
  );
  await expect(creditBondPool(db, "USD", 2.35, "couponsIn", NOW)).resolves.toBeUndefined();
  expect(
    (
      await db
        .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
        .findOne({ _id: "USD" })
    )?.cashLocal
  ).toBe(102.35);
});

it("publishes no witness when the authoritative credit fails", async () => {
  const { db } = fixture();
  vi.spyOn(db.collection("bondMarketPools"), "updateOne").mockRejectedValue(
    new Error("cash write failure")
  );
  await expect(creditBondPool(db, "USD", 2.35, "couponsIn", NOW)).rejects.toThrow(
    "cash write failure"
  );
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});

it("uses the cash writer's session for the witness", async () => {
  const { db } = fixture();
  const session = { id: "synthetic-session" } as unknown as ClientSession;
  const cashWrite = vi.spyOn(db.collection("bondMarketPools"), "updateOne");
  const ledgerWrite = vi.spyOn(db.collection("ledgerEntries"), "insertMany");
  await creditBondPool(db, "USD", 2.35, "couponsIn", NOW, { session });
  expect(cashWrite.mock.calls[0][2]).toEqual({ upsert: true, session });
  expect(ledgerWrite.mock.calls[0][1]).toEqual({ ordered: false, session });
});

it("publishes one shadow insert for all currency pools in upkeep", async () => {
  const { db } = fixture();
  await db
    .collection<{ _id: string; cashLocal: number; targetCashLocal: number }>("bondMarketPools")
    .insertOne({ _id: "GBP", cashLocal: 100, targetCashLocal: 500 });
  await db.collection("exchangeRates").insertOne({ currencyCode: "GBP", rate: 0.5 });
  await db
    .collection("moneySupplySnapshots")
    .insertOne({ currencyCode: "GBP", m2: 10000, turn: TURN - 1 });
  const opening = await collectBalances(db);
  const insert = vi.spyOn(db.collection("ledgerEntries"), "insertMany");
  await processBondMarketPoolTurn(db, TURN, NOW);
  expect(insert).toHaveBeenCalledTimes(1);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  const closing = await collectBalances(db);
  expect(
    reconcileLedger({ turn: TURN, entries, openingBalances: opening, closingBalances: closing })
      .stockVsFlow.findings
  ).toEqual([]);
});

it("flushes landed cash witnesses when a later phase operation fails", async () => {
  const { db } = fixture();
  const opening = await collectBalances(db);
  const context = await loadBondPoolLedgerContext(db, TURN);
  const insert = vi.spyOn(db.collection("ledgerEntries"), "insertMany");
  await expect(
    withBondPoolLedgerBatch(db, context, async (batch) => {
      await creditBondPool(db, "USD", 2.35, "couponsIn", NOW, { ledgerContext: batch });
      await creditBondPool(db, "USD", 100, "maturitiesIn", NOW, { ledgerContext: batch });
      throw new Error("later phase failure");
    })
  ).rejects.toThrow("later phase failure");
  expect(insert).toHaveBeenCalledTimes(1);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  const closing = await collectBalances(db);
  expect(
    reconcileLedger({ turn: TURN, entries, openingBalances: opening, closingBalances: closing })
      .stockVsFlow.findings
  ).toEqual([]);
});
