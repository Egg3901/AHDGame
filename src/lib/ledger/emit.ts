import * as Sentry from "@sentry/nextjs";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry, LedgerEntryInput } from "@/lib/ledger/types";
import { resolveLedgerTurn } from "@/lib/ledger/ledgerTurn";

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
 *
 * Every entry is stamped with the turn whose closing snapshot will hold its
 * cash, resolved once per batch (#3022). Request paths pass the clock as their
 * turn, which is the turn already reconciled; derived rows keep that turn for
 * display, but their ledger entries must land in the next one.
 */
export async function emitLedgerEntries(
  db: Db,
  inputs: LedgerEntryInput[],
  options?: { session?: ClientSession }
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    const turn = await resolveLedgerTurn(db);
    const docs = inputs.map((input) =>
      finalizeLedgerEntry(turn === null ? input : { ...input, turn })
    );
    await db.collection<LedgerEntry>(LEDGER_ENTRIES_COLLECTION).insertMany(docs, {
      ordered: false,
      ...(options?.session ? { session: options.session } : {}),
    });
  } catch (err) {
    Sentry.captureException(err, {
      extra: { phase: "emitLedgerEntries", count: inputs.length },
    });
  }
}
