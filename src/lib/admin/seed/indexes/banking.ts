import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";

/**
 * Indexes for the banking money-movement claim records.
 *
 * `bankMoneyMoves` is both the idempotency ledger and the repair queue. Two
 * access patterns, and both are on the hot path in a way that is easy to miss:
 *
 *  - **By `_id`**, on every single money movement. That one is free, because
 *    the claim IS an `insertOne` on the key and `_id` is indexed by the server.
 *  - **By `status`**, to find moves that started and did not finish. That is
 *    the operator's only view of a hole in the books, and without an index it
 *    is a full scan of a collection that grows by several rows per bank per
 *    turn forever. A repair tool that gets slower the longer the world runs is
 *    a repair tool nobody opens.
 *
 * `kind` is in the compound index because the queue is filtered by flow type
 * (deposit flows, loan servicing, the resolution waterfall), and `createdAt`
 * because the queue is read oldest-first: the oldest unfinished move is the one
 * that has been wrong for longest.
 */
export async function seedBankingIndexes(db: Db, log: (msg: string) => void) {
  log("Banking money-move indexes:");

  await ensureIndex(
    db,
    MONEY_MOVE_COLLECTION,
    { status: 1, kind: 1, createdAt: 1 },
    { name: "bankMoneyMoves_status_kind_createdAt", background: true },
    log
  );

  // Turn-scoped lookups: "what did this turn move", which is the first question
  // asked after a turn that produced a conservation warning.
  await ensureIndex(
    db,
    MONEY_MOVE_COLLECTION,
    { turn: -1 },
    { name: "bankMoneyMoves_turn_desc", background: true },
    log
  );

  log("Banking money-move indexes ensured");
}
