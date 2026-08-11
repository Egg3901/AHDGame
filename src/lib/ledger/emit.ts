import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry, LedgerEntryInput } from "@/lib/ledger/types";

export const LEDGER_ENTRIES_COLLECTION = "ledgerEntries";

/** Denormalize `balanced` and mint an _id for an input entry. */
export function finalizeLedgerEntry(input: LedgerEntryInput): LedgerEntry {
  return {
    ...input,
    _id: new ObjectId(),
    balanced: isAnchorBalanced(input.legs),
  };
}

/**
 * Fire-and-forget batch insert of shadow ledger entries. NEVER throws — the
 * shadow ledger must never fail a game write (see plan §4). Failures go to
 * Sentry and are counted by the caller's own try/catch envelope.
 */
export async function emitLedgerEntries(db: Db, inputs: LedgerEntryInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    const docs = inputs.map(finalizeLedgerEntry);
    await db
      .collection<LedgerEntry>(LEDGER_ENTRIES_COLLECTION)
      .insertMany(docs, { ordered: false });
  } catch (err) {
    Sentry.captureException(err, {
      extra: { phase: "emitLedgerEntries", count: inputs.length },
    });
  }
}
