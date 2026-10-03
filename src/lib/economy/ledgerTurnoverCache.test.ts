import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  LEDGER_TURNOVER_BY_TURN_COLLECTION,
  LEDGER_TURNOVER_LIVE_TURNS,
  loadLedgerTurnover,
} from "./economicVitalSigns";

const ACCOUNTS = ["corp:a:cash", "corp:b:cash", "treasury:US", "household:US"];

function entry(turn: number, i: number) {
  const account = ACCOUNTS[(turn + i) % ACCOUNTS.length]!;
  const amount = ((turn * 7 + i * 13) % 50) + 1;
  return {
    _id: new ObjectId(),
    turn,
    legs: [
      { role: "primary", account, anchorAmount: -amount },
      { role: "counter", account: "system", anchorAmount: amount },
      { role: "primary", account: ACCOUNTS[i % ACCOUNTS.length], anchorAmount: amount / 2 },
    ],
  };
}

function seed(turns: number[]): InMemoryDb {
  const memory = createInMemoryDb();
  memory.seed(
    "ledgerEntries",
    turns.flatMap((turn) => Array.from({ length: 5 }, (_, i) => entry(turn, i)))
  );
  return memory;
}

/** The pre-cache definition: one aggregation over the whole window. */
function direct(memory: InMemoryDb, windowStart: number, turn: number) {
  const totals = new Map<string, number>();
  for (const doc of memory.collection("ledgerEntries").docs) {
    const t = doc.turn as number;
    if (t < windowStart || t > turn) continue;
    for (const leg of doc.legs as { role: string; account: string; anchorAmount: number }[]) {
      if (leg.role !== "primary") continue;
      totals.set(leg.account, (totals.get(leg.account) ?? 0) + Math.abs(leg.anchorAmount));
    }
  }
  return totals;
}

const asMap = (rows: { account: string; turnover: number }[]) =>
  new Map(rows.map((r) => [r.account, r.turnover]));

describe("loadLedgerTurnover", () => {
  it("matches a full-window aggregation on a cold cache, a warm cache and a later turn", async () => {
    const memory = seed([5, 6, 7, 8, 9, 10, 11, 12]);
    const db = memory as unknown as Db;

    const cold = asMap(await loadLedgerTurnover(db, 6, 11));
    expect(cold).toEqual(direct(memory, 6, 11));
    // Completed turns are now cached; the newest turns are not.
    const cached = memory.collection(LEDGER_TURNOVER_BY_TURN_COLLECTION).docs.map((d) => d._id);
    const liveFrom = 11 - LEDGER_TURNOVER_LIVE_TURNS + 1;
    expect(cached.sort()).toEqual([6, 7, 8, 9, 10, 11].filter((t) => t < liveFrom));

    expect(asMap(await loadLedgerTurnover(db, 6, 11))).toEqual(direct(memory, 6, 11));

    // A late write into a live turn is counted.
    memory.collection("ledgerEntries").docs.push(entry(11, 99));
    expect(asMap(await loadLedgerTurnover(db, 6, 11))).toEqual(direct(memory, 6, 11));

    // The window slides: the turn that left it is pruned from the cache.
    expect(asMap(await loadLedgerTurnover(db, 7, 12))).toEqual(direct(memory, 7, 12));
    expect(
      memory.collection(LEDGER_TURNOVER_BY_TURN_COLLECTION).docs.some((d) => d._id === 6)
    ).toBe(false);
  });

  it("counts turns with no ledger entries without re-reading them", async () => {
    const memory = seed([3, 6]);
    const db = memory as unknown as Db;
    expect(asMap(await loadLedgerTurnover(db, 2, 8))).toEqual(direct(memory, 2, 8));
    const empty = memory
      .collection(LEDGER_TURNOVER_BY_TURN_COLLECTION)
      .docs.find((d) => d._id === 4);
    expect(empty?.accounts).toEqual([]);
  });
});
