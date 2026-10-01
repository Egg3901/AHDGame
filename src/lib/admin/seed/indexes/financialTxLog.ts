import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the financial transaction log. Absorbs
 * `scripts/migrations/deprecated/createFinancialTxLogIndexes.ts`.
 *
 * The TTL index expires rows at `expiresAt`. Application writes set
 * `expiresAt = createdAt + TX_TTL_TURNS × turnLengthMinutes × 60_000`
 * (default 168 turns ≈ 7 days). The index itself just honors that stamp.
 */
/** Shared with the live-world migration so the definitions cannot drift (#2693). */
export const FINANCIAL_TX_LOG_COUNTERPARTY_INDEX = {
  keys: { counterpartyId: 1, _id: -1 },
  options: { name: "financialTxLog_counterpartyId_id", sparse: true, background: true },
} as const;

export async function seedFinancialTxLogIndexes(db: Db, log: (msg: string) => void) {
  log("Financial transaction log indexes:");

  await ensureIndex(
    db,
    "financialTxLog",
    { expiresAt: 1 },
    { name: "financialTxLog_expiresAt_ttl", expireAfterSeconds: 0, background: true },
    log
  );

  // NOTE (refs #3240): no explicit index for cursor-based pagination on _id.
  // MongoDB rejects any _id index spec other than {_id: 1} (a previous
  // {_id: -1} "financialTxLog_id_desc" attempt logged "Index creation failed"
  // on every bootstrap). _id is always indexed; descending iteration
  // (sort {_id: -1}) walks the default _id index backwards for free.

  await ensureIndex(
    db,
    "financialTxLog",
    { flagged: 1, _id: -1 },
    { name: "financialTxLog_flagged_id", background: true },
    log
  );

  await ensureIndex(
    db,
    "financialTxLog",
    { subjectId: 1, _id: -1 },
    { name: "financialTxLog_subjectId_id", sparse: true, background: true },
    log
  );
  // Counterparty mirror of the subject index. `stampEntityDeleted` filters on
  // counterpartyId when a corporation or character is deleted; without this
  // it scans the whole log (4.2M rows, 9 s per deletion in an aged sandbox).
  await ensureIndex(
    db,
    "financialTxLog",
    FINANCIAL_TX_LOG_COUNTERPARTY_INDEX.keys,
    FINANCIAL_TX_LOG_COUNTERPARTY_INDEX.options,
    log
  );
  await ensureIndex(
    db,
    "financialTxLog",
    { subjectType: 1, _id: -1 },
    { name: "financialTxLog_subjectType_id", background: true },
    log
  );

  await ensureIndex(
    db,
    "financialTxLog",
    { turn: -1 },
    { name: "financialTxLog_turn_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "financialTxLog",
    { type: 1, _id: -1 },
    { name: "financialTxLog_type_id", background: true },
    log
  );

  await ensureIndex(
    db,
    "financialTxLog",
    { subjectName: "text", counterpartyName: "text" },
    { name: "financialTxLog_text_search", background: true },
    log
  );

  log("Financial tx log indexes ensured");
}
