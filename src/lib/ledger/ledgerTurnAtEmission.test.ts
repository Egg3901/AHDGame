/**
 * Ledger entries are stamped at emission with the turn whose closing snapshot
 * holds their cash (#3022). A request between turns passes the clock (or 0 for
 * a wire) as its row's turn; the row keeps it for display, but the ledger entry
 * lands in the next turn, where the stock check sees the cash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import { emitTx } from "@/lib/financialTxLog/emit";
import { emitLedgerEntries } from "./emit";
import { runWithLedgerTurn } from "./ledgerTurn";
import type { LedgerEntry } from "./types";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const NOW = new Date("2026-10-03T00:00:00Z");
let db: Db;

async function world(clock: number | null) {
  db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: true });
  if (clock !== null) {
    await db
      .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
      .insertOne({ _id: "current", currentTurn: clock, preset: "2019-default" });
  }
  await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });
  vi.mocked(getDb).mockResolvedValue(db);
}

beforeEach(() => {
  resetLedgerShadowFlagCache();
});

const wire = (from: ObjectId, to: ObjectId, amount: number) => [
  {
    type: "wire_transfer_out" as const,
    turn: 0,
    createdAt: NOW,
    subjectType: "character" as const,
    subjectId: from,
    subjectName: "Sender",
    amount: -amount,
    currencyCode: "USD" as const,
    counterpartyType: "character" as const,
    counterpartyId: to,
    counterpartyName: "Recipient",
  },
  {
    type: "wire_transfer_in" as const,
    turn: 0,
    createdAt: NOW,
    subjectType: "character" as const,
    subjectId: to,
    subjectName: "Recipient",
    amount,
    currencyCode: "USD" as const,
    counterpartyType: "character" as const,
    counterpartyId: from,
    counterpartyName: "Sender",
  },
];

describe("ledger turn at emission", () => {
  it("reconciles a wire made between turns in the turn whose snapshot holds it", async () => {
    // Turn 4 is processed and reconciled; the next snapshot closes turn 5.
    await world(4);
    const sender = new ObjectId();
    const recipient = new ObjectId();
    await db.collection("characters").insertMany([
      { _id: sender, currencyBalances: { personal: { USD: 1_000 } } },
      { _id: recipient, currencyBalances: { personal: { USD: 0 } } },
    ]);
    await writeBalanceSnapshot(db, 4);
    // The request moves the cash and writes its rows with the route's turn, 0.
    await db
      .collection("characters")
      .updateOne({ _id: sender }, { $inc: { "currencyBalances.personal.USD": -250 } });
    await db
      .collection("characters")
      .updateOne({ _id: recipient }, { $inc: { "currencyBalances.personal.USD": 250 } });
    for (const row of wire(sender, recipient, 250)) await emitTx(db, row);

    const rows = await db.collection("financialTxLog").find({}).toArray();
    expect(rows.map((row) => row.turn)).toEqual([0, 0]);
    const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
    expect(entries.map((entry) => entry.turn)).toEqual([5, 5]);

    await writePreForexBalanceCheckpoint(db, 5);
    await writeBalanceSnapshot(db, 5);
    const report = await reconcileTurn(db, 5);
    expect(report?.stockVsFlow.skipped).toBe(false);
    expect(report?.stockVsFlow.findings ?? []).toEqual([]);
    expect(report?.trialBalance.status).toBe("green");
    expect(report?.entriesChecked).toBe(2);
  });

  it("stamps a phase's entries with the processing turn without reading the clock", async () => {
    await world(4);
    const stateRead = vi.spyOn(db.collection("gameState"), "findOne");
    await runWithLedgerTurn(5, () =>
      emitLedgerEntries(db, [
        {
          turn: 5,
          createdAt: NOW,
          txType: "corp_revenue",
          emitSite: "test",
          legs: [
            {
              account: "corporation:fixture:USD",
              amount: 10,
              currencyCode: "USD",
              anchorAmount: 10,
              role: "primary",
            },
            {
              account: "mint:sector_revenue:USD",
              amount: -10,
              currencyCode: "USD",
              anchorAmount: -10,
              role: "contra",
            },
          ],
        },
      ])
    );
    expect(stateRead).not.toHaveBeenCalled();
    const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
    expect(entry.turn).toBe(5);
  });

  it("keeps an entry's own turn when the world has no clock yet", async () => {
    await world(null);
    for (const row of wire(new ObjectId(), new ObjectId(), 10)) await emitTx(db, row);
    const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
    expect(entries.map((entry) => entry.turn)).toEqual([0, 0]);
  });
});
