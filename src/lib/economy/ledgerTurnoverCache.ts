import type { Db } from "mongodb";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { LedgerTurnoverRow } from "./economicVitalSigns";

/**
 * Per-turn, per-account primary-leg turnover for completed turns, so the
 * 48-turn window is a sum of small cached rows instead of a re-aggregation of
 * every ledger entry in it. On the live world the window holds ~1.4M entries
 * (~560 MB), and re-reading them every turn took ~4.3 s and churned the
 * database cache. Runtime collection, wiped with the world: rows are keyed by
 * turn number, which restarts on reset.
 */
export const LEDGER_TURNOVER_BY_TURN_COLLECTION = "ledgerTurnoverByTurn";

/**
 * Turns this close to the snapshot are always aggregated live. A turn's ledger
 * entries are written during that turn and, rarely, just after it; caching only
 * turns at least this far back keeps every late write in the total.
 */
export const LEDGER_TURNOVER_LIVE_TURNS = 2;

type LedgerTurnoverByTurnDoc = {
  _id: number;
  accounts: { account: string; turnover: number }[];
  computedAt: Date;
};

function primaryLegTurnoverPipeline(match: Record<string, unknown>, byTurn: boolean) {
  return [
    { $match: match },
    { $unwind: "$legs" },
    { $match: { "legs.role": "primary" } },
    {
      $group: {
        _id: byTurn ? { turn: "$turn", account: "$legs.account" } : "$legs.account",
        turnover: { $sum: { $abs: "$legs.anchorAmount" } },
      },
    },
  ];
}

export async function loadLedgerTurnover(
  db: Db,
  windowStart: number,
  turn: number
): Promise<LedgerTurnoverRow[]> {
  const liveFrom = Math.max(windowStart, turn - LEDGER_TURNOVER_LIVE_TURNS + 1);
  const cachedTurns: number[] = [];
  for (let t = windowStart; t < liveFrom; t++) cachedTurns.push(t);

  const cache = db.collection<LedgerTurnoverByTurnDoc>(LEDGER_TURNOVER_BY_TURN_COLLECTION);
  const ledger = db.collection<LedgerEntry>("ledgerEntries");
  const [live, cached] = await Promise.all([
    ledger
      .aggregate<{
        _id: string;
        turnover: number;
      }>(primaryLegTurnoverPipeline({ turn: { $gte: liveFrom, $lte: turn } }, false))
      .toArray(),
    cachedTurns.length > 0
      ? cache.find({ _id: { $in: cachedTurns } }).toArray()
      : Promise.resolve([] as LedgerTurnoverByTurnDoc[]),
  ]);

  // Fill completed turns the cache does not hold yet (first run, or a gap) in
  // one grouped pass, and keep them for the following turns.
  const held = new Set(cached.map((doc) => doc._id));
  const missing = cachedTurns.filter((t) => !held.has(t));
  const filled: LedgerTurnoverByTurnDoc[] = [];
  if (missing.length > 0) {
    const rows = await ledger
      .aggregate<{
        _id: { turn: number; account: string };
        turnover: number;
      }>(primaryLegTurnoverPipeline({ turn: { $in: missing } }, true))
      .toArray();
    const byTurn = new Map<number, LedgerTurnoverByTurnDoc["accounts"]>(
      missing.map((t) => [t, []])
    );
    for (const row of rows) {
      byTurn.get(row._id.turn)?.push({ account: row._id.account, turnover: row.turnover });
    }
    const computedAt = new Date();
    for (const [t, accounts] of byTurn) filled.push({ _id: t, accounts, computedAt });
    try {
      await cache.bulkWrite(
        filled.map((doc) => ({
          replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
        })),
        { ordered: false }
      );
      await cache.deleteMany({ _id: { $lt: windowStart } });
    } catch (err) {
      // The totals below are still exact; the next turn refills what failed.
      console.warn("[economicVitalSigns] ledger turnover cache write failed:", err);
    }
  }

  const totals = new Map<string, number>();
  const add = (account: string, turnover: number) =>
    totals.set(account, (totals.get(account) ?? 0) + turnover);
  for (const doc of [...cached, ...filled]) {
    for (const row of doc.accounts) add(row.account, row.turnover);
  }
  for (const row of live) add(row._id, row.turnover);
  return [...totals].map(([account, turnover]) => ({ account, turnover }));
}
