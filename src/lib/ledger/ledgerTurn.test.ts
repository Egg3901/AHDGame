/**
 * Witnesses that take no turn from their caller stamp the turn whose closing
 * snapshot will hold the cash: one past the game clock, which only advances
 * when a turn completes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { ledgerTurnFromClock } from "./ledgerTurn";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { loadBondPoolLedgerContext } from "@/lib/bonds/marketPoolLedger";
import { witnessCorporationStartingGrant } from "@/lib/corporations/startingGrantLedger";
import type { LedgerEntry } from "./types";
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

let db: Db;
beforeEach(async () => {
  db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: true });
  // Turn 4 has been processed; turn 5 is accumulating (or processing).
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 4, preset: "2019-default" });
});

describe("ledger witness turn", () => {
  it("is one past the clock", () => {
    expect(ledgerTurnFromClock(4)).toBe(5);
  });

  it("defaults treasury and bond pool contexts to the accumulating turn", async () => {
    expect((await loadTreasuryCashContext(db))?.turn).toBe(5);
    expect((await loadBondPoolLedgerContext(db))?.turn).toBe(5);
  });

  it("keeps a phase's explicit processing turn", async () => {
    expect((await loadTreasuryCashContext(db, 5))?.turn).toBe(5);
    expect((await loadBondPoolLedgerContext(db, 5))?.turn).toBe(5);
  });

  it("stamps a starting grant without a founding turn into the accumulating turn", async () => {
    await witnessCorporationStartingGrant(db, {
      corporationId: new ObjectId(),
      amountLocal: 1_000,
      currencyCode: "USD",
      now: new Date(),
    });
    const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
    expect(entry.turn).toBe(5);
  });
});
