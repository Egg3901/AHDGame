/** Real NPP decisions, authoritative cash writes and stock reconciliation. */
import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import type { LedgerEntry } from "@/lib/ledger/types";
import { processNppCorporationDecisions } from "@/lib/turn/nppCorporationBehavior";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { glutStaggerEligible } from "./cohort";
import {
  applyCorporationCashWrites,
  buildNppFoundingCashWitness,
  flushNppFoundingCashWitnesses,
} from "./foundingCashLedger";
import { flushNppReinvestmentCashWitnesses } from "./reinvestmentCashLedger";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
beforeEach(() => {
  vi.restoreAllMocks();
  resetLedgerShadowFlagCache();
});
const TURN = 25;
const cases = [
  { countryId: "US", currencyCode: "USD", rate: 1, stateId: "NY" },
  { countryId: "DE", currencyCode: "EUR", rate: 0.9, stateId: "BE" },
  { countryId: "JP", currencyCode: "JPY", rate: 137, stateId: "KAN" },
] as const;
function fixture(row: (typeof cases)[number], mode = "plants", shadow = true) {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  let id = new ObjectId("000000000000000000000001");
  for (let n = 1; !glutStaggerEligible(id.toHexString(), TURN); n++)
    id = new ObjectId(n.toString(16).padStart(24, "0"));
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: shadow, marketSystemMode: mode }]);
  memory.seed("gameState", [
    {
      _id: "current",
      currentTurn: TURN - 1,
      currentYear: 2019,
      startingYear: 2019,
      preset: "2019-default",
      nppCorpStrategyEnabled: false,
    },
  ]);
  memory.seed("exchangeRates", [{ currencyCode: row.currencyCode, rate: row.rate }]);
  memory.seed("corporations", [
    {
      _id: id,
      name: "Synthetic accounting corporation",
      countryId: row.countryId,
      type: "manufacturing",
      headquartersState: row.stateId,
      liquidCurrencyCode: row.currencyCode,
      liquidCapital: 100000000 * row.rate,
      ceoType: "npp",
    },
  ]);
  memory.seed("corporateSectors", [
    {
      _id: new ObjectId(),
      corporationId: id,
      sectorType: "technology",
      countryId: row.countryId,
      stateId: row.stateId,
      revenue: 1000000 * row.rate,
      realizedRevenue: 1000000 * row.rate,
      profitMargin: 30,
      effectiveProfitMargin: 30,
      targetGrowthRate: 2,
      capitalStock: 1000,
      producedUnits: 1000,
      soldUnits: 1000,
      soldFraction: 1,
    },
  ]);
  memory.seed("unownedSectors", [
    {
      _id: new ObjectId(),
      stateId: row.stateId,
      countryId: row.countryId,
      sectorType: "manufacturing",
      revenue: 40000000,
      headroomUnits: computeUnownedHeadroomUnits("manufacturing", 40000000, 1),
    },
  ]);
  return { memory, db, id };
}
for (const mode of ["plants", "off"]) {
  it.each(cases)(
    `reconciles actual ${mode} $currencyCode founding without duplicating reinvestment`,
    async (row) => {
      const { db, id } = fixture(row, mode),
        opening = await collectBalances(db);
      const result = await processNppCorporationDecisions(db, TURN, new Date(), false);
      expect(result.newSectors).toHaveLength(1);
      expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      expect(await db.collection("financialTxLog").countDocuments()).toBe(0);
      expect(result.foundingCashWitnesses).toHaveLength(1);
      expect(result.foundingCashWitnesses![0].key.equals(result.newSectors[0]._id)).toBe(true);
      await applyCorporationCashWrites(
        db,
        result.corpUpdates.map((op) => ({ updateOne: op })),
        result.foundingCashWitnesses ?? [],
        result.reinvestmentCashWitnesses ?? []
      );
      const entries = await db
        .collection<LedgerEntry>("ledgerEntries")
        .find({ turn: TURN })
        .toArray();
      expect(entries.filter((e) => e.txType === "corp_sector_founding")).toHaveLength(1);
      const report = reconcileLedger({
        turn: TURN,
        entries,
        openingBalances: opening,
        closingBalances: await collectBalances(db),
      });
      expect(report.stockVsFlow.findings).toEqual([]);
      expect(report.trialBalance.unbalancedCount).toBe(0);
      expect(report.unattributed).toEqual([]);
      const cash = (await db.collection("corporations").findOne({ _id: id }))!.liquidCapital;
      expect(cash).toBeLessThan(100000000 * row.rate);
      await flushNppFoundingCashWitnesses(db, result.foundingCashWitnesses ?? []);
      await flushNppReinvestmentCashWitnesses(db, result.reinvestmentCashWitnesses ?? []);
      expect(await db.collection("ledgerEntries").countDocuments()).toBe(entries.length);
    }
  );
}
it("keeps identical cash and omits witness stamps with accounting disabled", async () => {
  const enabled = fixture(cases[0]),
    on = await processNppCorporationDecisions(enabled.db, TURN, new Date(), false);
  await applyCorporationCashWrites(
    enabled.db,
    on.corpUpdates.map((op) => ({ updateOne: op })),
    on.foundingCashWitnesses ?? [],
    on.reinvestmentCashWitnesses ?? []
  );
  const disabled = fixture(cases[0], "plants", false),
    off = await processNppCorporationDecisions(disabled.db, TURN, new Date(), false);
  await applyCorporationCashWrites(
    disabled.db,
    off.corpUpdates.map((op) => ({ updateOne: op })),
    off.foundingCashWitnesses ?? [],
    off.reinvestmentCashWitnesses ?? []
  );
  expect(off.foundingCashWitnesses).toBeUndefined();
  expect(await disabled.db.collection("financialTxLog").countDocuments()).toBe(1);
  expect(await disabled.db.collection("ledgerEntries").countDocuments()).toBe(0);
  const a = await enabled.db.collection("corporations").findOne({ _id: enabled.id }),
    b = await disabled.db.collection("corporations").findOne({ _id: disabled.id });
  expect(b!.liquidCapital).toBe(a!.liquidCapital);
  expect(b!.nppFoundingCashWitnessKey).toBeUndefined();
  expect(
    await disabled.db.collection("ledgerEntries").countDocuments({ txType: "corp_sector_founding" })
  ).toBe(0);
});
it("does not publish a founding debit when the authoritative write fails", async () => {
  const { db } = fixture(cases[0]),
    result = await processNppCorporationDecisions(db, TURN, new Date(), false);
  vi.spyOn(db.collection("corporations"), "bulkWrite").mockRejectedValueOnce(
    new Error("cash failed")
  );
  await expect(
    applyCorporationCashWrites(
      db,
      result.corpUpdates.map((op) => ({ updateOne: op })),
      result.foundingCashWitnesses ?? [],
      result.reinvestmentCashWitnesses ?? []
    )
  ).rejects.toThrow("cash failed");
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
  expect(await db.collection("financialTxLog").countDocuments()).toBe(0);
});
it("rejects a stamp from a different or unmatched cash write", async () => {
  const { db, id } = fixture(cases[0]),
    pending = buildNppFoundingCashWitness({
      corporationId: id,
      key: new ObjectId(),
      amountLocal: 100,
      currencyCode: "USD",
      rate: 1,
      turn: TURN,
      now: new Date(),
    })!;
  await db
    .collection("corporations")
    .updateOne({ _id: id }, { $set: { nppFoundingCashWitnessKey: new ObjectId().toHexString() } });
  await flushNppFoundingCashWitnesses(db, [pending]);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});
it("keeps successful cash when shadow publication fails", async () => {
  const { db } = fixture(cases[0]),
    result = await processNppCorporationDecisions(db, TURN, new Date(), false);
  vi.spyOn(db.collection("ledgerEntries"), "bulkWrite").mockRejectedValueOnce(
    new Error("shadow failed")
  );
  await expect(
    applyCorporationCashWrites(
      db,
      result.corpUpdates.map((op) => ({ updateOne: op })),
      result.foundingCashWitnesses ?? [],
      result.reinvestmentCashWitnesses ?? []
    )
  ).resolves.toBeDefined();
});
it("does not produce accounting intent for a rejected founding decision", async () => {
  const { db, id } = fixture(cases[0]);
  await db.collection("corporations").updateOne({ _id: id }, { $set: { liquidCapital: 100 } });
  const result = await processNppCorporationDecisions(db, TURN, new Date(), false);
  expect(result.newSectors).toEqual([]);
  expect(result.foundingCashWitnesses).toBeUndefined();
});

it("does not publish reinvestment history for an unmatched atomic stamp", async () => {
  const { db, id } = fixture(cases[0]);
  const result = await processNppCorporationDecisions(db, TURN, new Date(), false);
  expect(result.reinvestmentCashWitnesses).toHaveLength(1);
  await db
    .collection("corporations")
    .updateOne(
      { _id: id },
      { $set: { nppReinvestmentCashWitnessKey: new ObjectId().toHexString() } }
    );
  await flushNppReinvestmentCashWitnesses(db, result.reinvestmentCashWitnesses ?? []);
  expect(await db.collection("financialTxLog").countDocuments()).toBe(0);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});

it("recovers failed reinvestment history publication without debiting cash again", async () => {
  const { db, id } = fixture(cases[0]);
  const opening = await collectBalances(db);
  const result = await processNppCorporationDecisions(db, TURN, new Date(), false);
  vi.spyOn(db.collection("financialTxLog"), "bulkWrite").mockRejectedValueOnce(
    new Error("history failed")
  );
  await expect(
    applyCorporationCashWrites(
      db,
      result.corpUpdates.map((op) => ({ updateOne: op })),
      result.foundingCashWitnesses ?? [],
      result.reinvestmentCashWitnesses ?? []
    )
  ).resolves.toBeDefined();
  const cash = (await db.collection("corporations").findOne({ _id: id }))!.liquidCapital;
  expect(await db.collection("financialTxLog").countDocuments()).toBe(0);
  await flushNppReinvestmentCashWitnesses(db, result.reinvestmentCashWitnesses ?? []);
  await flushNppReinvestmentCashWitnesses(db, result.reinvestmentCashWitnesses ?? []);
  expect((await db.collection("corporations").findOne({ _id: id }))!.liquidCapital).toBe(cash);
  expect(await db.collection("financialTxLog").countDocuments()).toBe(1);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  const report = reconcileLedger({
    turn: TURN,
    entries,
    openingBalances: opening,
    closingBalances: await collectBalances(db),
  });
  expect(report.stockVsFlow.findings).toEqual([]);
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
});
