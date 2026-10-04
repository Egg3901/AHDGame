/** Actual organization cash writes must reconcile both treasuries and pooled funds. */
import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { runWithLedgerTurn } from "@/lib/ledger/ledgerTurn";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import {
  chargeOrganizationDues,
  creditOrganizationFund,
  disburseFromOrganizationFund,
} from "./organizationFund";
import { payOrganizationAid } from "./aid";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  resetLedgerShadowFlagCache();
});
const TURN = 25;
const cases = [
  { organizationId: "UN", countryId: "US" as const, currency: "USD" as const, rate: 1 },
  { organizationId: "EU", countryId: "DE" as const, currency: "EUR" as const, rate: 0.9 },
];
function fixture(row: (typeof cases)[number]) {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, preset: "2019-default" }]);
  memory.seed("exchangeRates", [
    { currencyCode: row.currency, rate: row.rate },
    ...(row.currency === "USD" ? [] : [{ currencyCode: "USD", rate: 1 }]),
  ]);
  memory.seed("federalBudget", [
    {
      _id: new ObjectId(),
      countryId: row.countryId,
      currencyCode: row.currency,
      treasuryBalance: 1000,
    },
  ]);
  memory.seed("organizationFunds", [
    {
      _id: new ObjectId(),
      organizationId: row.organizationId,
      currencyCountryId: row.countryId,
      balanceLocal: 1000,
      duesRateAnnual: 0.00006,
    },
  ]);
  return { memory, db };
}
async function expectConserved(db: Db, opening: Record<string, number>, entries: LedgerEntry[]) {
  const closing = await collectBalances(db);
  const report = reconcileLedger({
    turn: TURN,
    entries,
    openingBalances: opening,
    closingBalances: closing,
  });
  expect(report.stockVsFlow.findings).toEqual([]);
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
}
it.each(cases)("snapshots real $currency organization cash", async (row) => {
  const { db } = fixture(row);
  const balances = await collectBalances(db);
  expect(balances[`org:${row.organizationId}:${row.currency}`]).toBe(1000 / row.rate);
});
it.each(cases)("reconciles actual $currency member dues and pooled receipts", async (row) => {
  const { db } = fixture(row),
    opening = await collectBalances(db);
  await chargeOrganizationDues(db, row.organizationId, [
    { countryId: row.countryId, gdpUsd: 48000000 },
  ]);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  await expectConserved(db, opening, entries);
});
it.each(cases)("reconciles actual $currency aid and treasury receipts", async (row) => {
  const { db } = fixture(row),
    opening = await collectBalances(db);
  expect(await payOrganizationAid(db, row.organizationId, row.countryId, 100)).toBe(true);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  await expectConserved(db, opening, entries);
});
it("settles funded cross-currency dues once from Treasury cash", async () => {
  const { memory, db } = fixture(cases[0]);
  await db
    .collection("gameConfig")
    .updateOne({ _id: "default" as never }, { $set: { treasuryCashLedgerEnabled: true } });
  await db
    .collection("federalBudget")
    .updateOne({ countryId: "US" }, { $set: { treasuryCashLocal: 1_000 } });
  memory.seed("organizationFunds", [
    {
      _id: new ObjectId(),
      organizationId: "EU",
      currencyCountryId: "DE",
      balanceLocal: 1_000,
      duesRateAnnual: 0.00006,
    },
  ]);
  memory.seed("exchangeRates", [
    { currencyCode: "USD", rate: 1 },
    { currencyCode: "EUR", rate: 0.9 },
  ]);
  expect(await chargeOrganizationDues(db, "EU", [{ countryId: "US", gdpUsd: 48_000_000 }])).toBe(
    54
  );
  await chargeOrganizationDues(db, "EU", [{ countryId: "US", gdpUsd: 48_000_000 }]);
  expect(
    (await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryCashLocal
  ).toBe(940);
  expect((await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance).toBe(
    940
  );
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "EU" }))?.balanceLocal
  ).toBe(1_054);
  expect(
    await db
      .collection("bankMoneyMoves")
      .countDocuments({ status: "applied", kind: "organization_dues" })
  ).toBe(1);
});
it("does not fund an organization receipt when Treasury cash is unavailable", async () => {
  const { db } = fixture(cases[0]);
  await db
    .collection("gameConfig")
    .updateOne({ _id: "default" as never }, { $set: { treasuryCashLedgerEnabled: true } });
  await db
    .collection("federalBudget")
    .updateOne({ countryId: "US" }, { $set: { treasuryCashLocal: 0 } });
  expect(await chargeOrganizationDues(db, "UN", [{ countryId: "US", gdpUsd: 48_000_000 }])).toBe(0);
  expect((await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance).toBe(
    1_000
  );
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "UN" }))?.balanceLocal
  ).toBe(1_000);
  expect(await db.collection("bankMoneyMoves").countDocuments()).toBe(0);
});
it("funds cross-currency aid from the organization balance and replays once", async () => {
  const { memory, db } = fixture(cases[1]);
  await db
    .collection("gameConfig")
    .updateOne({ _id: "default" as never }, { $set: { treasuryCashLedgerEnabled: true } });
  await db
    .collection("federalBudget")
    .updateOne({ countryId: "DE" }, { $set: { treasuryCashLocal: 1_000 } });
  await db.collection("federalBudget").insertOne({
    _id: new ObjectId(),
    countryId: "US",
    currencyCode: "USD",
    treasuryBalance: 500,
    treasuryCashLocal: 100,
  });
  memory.seed("exchangeRates", [
    { currencyCode: "EUR", rate: 0.9 },
    { currencyCode: "USD", rate: 1 },
  ]);
  expect(await payOrganizationAid(db, "EU", "US", 90)).toBe(true);
  const replayed = await payOrganizationAid(db, "EU", "US", 90);
  expect(replayed).toBe(true);
  expect(
    (await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryCashLocal
  ).toBe(200);
  expect((await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance).toBe(
    600
  );
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "EU" }))?.balanceLocal
  ).toBe(910);
  expect(
    await db
      .collection("bankMoneyMoves")
      .countDocuments({ status: "applied", kind: "organization_aid" })
  ).toBe(1);
});
it.each(cases)("reconciles actual $currency spending and refund", async (row) => {
  const { db } = fixture(row),
    opening = await collectBalances(db);
  expect(await disburseFromOrganizationFund(db, row.organizationId, 100.4)).toBe(true);
  await creditOrganizationFund(db, row.organizationId, 100.4);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  await expectConserved(db, opening, entries);
});

it("does not witness rejected or zero cash movements", async () => {
  const { db } = fixture(cases[0]);
  expect(await disburseFromOrganizationFund(db, "UN", 2000)).toBe(false);
  expect(await disburseFromOrganizationFund(db, "UN", 0.4)).toBe(false);
  await creditOrganizationFund(db, "UN", 0.4);
  expect(await chargeOrganizationDues(db, "UN", [{ countryId: "UK", gdpUsd: 48000000 }])).toBe(0);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "UN" }))?.balanceLocal
  ).toBe(1000);
});

it("keeps identical cash outcomes with shadow accounting disabled", async () => {
  const { db } = fixture(cases[0]);
  await db
    .collection("gameConfig")
    .updateOne({ _id: "default" as never }, { $set: { ledgerShadow: false } });
  expect(await chargeOrganizationDues(db, "UN", [{ countryId: "US", gdpUsd: 48000000 }])).toBe(60);
  expect(await payOrganizationAid(db, "UN", "US", 100)).toBe(true);
  expect((await db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance).toBe(
    1040
  );
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "UN" }))?.balanceLocal
  ).toBe(960);
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});

it("flushes a landed debit if the subsequent fund credit fails", async () => {
  const { db } = fixture(cases[0]);
  vi.spyOn(db.collection("organizationFunds"), "updateOne").mockRejectedValueOnce(
    new Error("credit failed")
  );
  await expect(
    chargeOrganizationDues(db, "UN", [{ countryId: "US", gdpUsd: 48000000 }])
  ).rejects.toThrow("credit failed");
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(1);
  expect(entries[0].legs[0].account).toBe("government:US:USD");
  expect(entries[0].legs[0].amount).toBe(-60);
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "UN" }))?.balanceLocal
  ).toBe(1000);
});

it("does not witness an authoritative write that throws", async () => {
  const { db } = fixture(cases[0]);
  vi.spyOn(db.collection("organizationFunds"), "updateOne").mockRejectedValueOnce(
    new Error("debit failed")
  );
  await expect(disburseFromOrganizationFund(db, "UN", 100)).rejects.toThrow("debit failed");
  expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
});

it("preserves landed cash when the shadow insert fails", async () => {
  const { db } = fixture(cases[0]);
  vi.spyOn(db.collection("ledgerEntries"), "insertMany").mockRejectedValueOnce(
    new Error("shadow unavailable")
  );
  expect(await disburseFromOrganizationFund(db, "UN", 100)).toBe(true);
  expect(
    (await db.collection("organizationFunds").findOne({ organizationId: "UN" }))?.balanceLocal
  ).toBe(900);
});

it("uses the processing turn and one batch for a whole member cohort", async () => {
  const { db } = fixture(cases[0]);
  const insert = vi.spyOn(db.collection("ledgerEntries"), "insertMany");
  const config = vi.spyOn(db.collection("gameConfig"), "findOne");
  // The dues phase runs inside the turn's ledger scope, as processTurn does.
  await runWithLedgerTurn(TURN + 1, () =>
    chargeOrganizationDues(
      db,
      "UN",
      [
        { countryId: "US", gdpUsd: 48000000 },
        { countryId: "US", gdpUsd: 48000000 },
      ],
      { turn: TURN + 1 }
    )
  );
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
  expect(entries).toHaveLength(3);
  expect(entries.every((entry) => entry.turn === TURN + 1)).toBe(true);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(config).toHaveBeenCalledTimes(1);
});

it("resolves legacy native fund currencies without counting a balanceUsd UI fallback", async () => {
  const { memory, db } = fixture(cases[0]);
  memory.seed("customInternationalOrganizations", [{ id: "custom", foundingMembers: ["DE"] }]);
  await db.collection("organizationFunds").deleteMany({});
  memory.seed("organizationFunds", [
    { organizationId: "EU", balanceLocal: 90 },
    { organizationId: "custom", balanceLocal: 180 },
    { organizationId: "UN", balanceUsd: 700 },
  ]);
  memory.seed("exchangeRates", [
    { currencyCode: "EUR", rate: 0.9 },
    { currencyCode: "USD", rate: 1 },
  ]);
  const balances = await collectBalances(db);
  expect(balances["org:EU:EUR"]).toBe(100);
  expect(balances["org:custom:EUR"]).toBe(200);
  expect(balances["org:UN:USD"]).toBeUndefined();
});

it("reconciles mixed-currency dues using each actual stock's valuation", async () => {
  const { memory, db } = fixture(cases[0]);
  memory.seed("federalBudget", [{ countryId: "UK", currencyCode: "GBP", treasuryBalance: 1000 }]);
  memory.seed("exchangeRates", [
    { currencyCode: "USD", rate: 1 },
    { currencyCode: "GBP", rate: 0.73 },
  ]);
  const opening = await collectBalances(db);
  await chargeOrganizationDues(db, "UN", [{ countryId: "UK", gdpUsd: 48000000 }]);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(2);
  expect(entries[0].legs[0].currencyCode).toBe("GBP");
  expect(entries[1].legs[0].currencyCode).toBe("USD");
  await expectConserved(db, opening, entries);
});

it("separates funded tribute from tribute without a modeled treasury", async () => {
  const { memory, db } = fixture(cases[0]);
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { preset: "1953-default" } });
  memory.seed("organizationFunds", [
    { organizationId: "NATO", currencyCountryId: "US", balanceLocal: 1000 },
  ]);
  memory.seed("organizationMemberships", [
    { organizationId: "NATO", countryId: "US" },
    { organizationId: "NATO", countryId: "CA" },
  ]);
  memory.seed("macroCountries", [
    { entityId: "US", retiredAt: null, sectors: { retail: { capacity: 100 } } },
    { entityId: "CA", retiredAt: null, sectors: { retail: { capacity: 100 } } },
  ]);
  const { chargeOrganizationTribute } = await import("./tribute");
  const opening = await collectBalances(db);
  const result = await chargeOrganizationTribute(db, "NATO", {} as never);
  expect(result.payers).toBe(2);
  expect(result.minted).toBeGreaterThan(0);
  expect(result.collectedLocal).toBe(2 * result.minted);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: TURN }).toArray();
  expect(entries).toHaveLength(3);
  expect(entries.filter((entry) => entry.txType === "org_tribute_mint")).toHaveLength(1);
  expect(entries.find((entry) => entry.txType === "org_tribute_mint")?.legs[1].account).toContain(
    "organization_tribute_unmodeled"
  );
  await expectConserved(db, opening, entries);
});
