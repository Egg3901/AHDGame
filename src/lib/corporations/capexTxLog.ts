/**
 * Capacity-build capex ledger legs (P3a, marketSystemMode >= "plants").
 *
 * A build is a RECLASS, not a loss. Cash leaves `corporation.liquidCapital` and
 * becomes the sector's `constructionInProgressAnchor`; on completion the CIP
 * becomes capacity. Only the cash side is a money movement, so only the cash
 * side is logged:
 *
 *   - `corp_capacity_build`        debit  (negative amount) — cash → CIP
 *   - `corp_capacity_build_refund` credit (positive amount) — cancelled build
 *                                  returns unspent CIP → cash
 *   - completion                   NOTHING — no money moves.
 *
 * Both directions derive to the shared `capacity_capex` mint/sink reason (see
 * `src/lib/ledger/deriveFromTx.ts`) so the money-supply reconciler nets a build
 * against its own refund, and the outstanding CIP shows up as a named,
 * auditable bucket instead of `unattributed` backlog.
 *
 * The build command owns the balance mutations; this module owns the log rows.
 * Callers building many rows in one turn phase should use
 * {@link buildCapexTxEntry} + `emitTxBulk`; one-shot player commands can use
 * {@link emitBuildCapexTx}.
 */
import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";

/** Which direction of the capex flow this row records. */
export type BuildCapexDirection =
  /** Cash → construction in progress. Logged as a debit. */
  | "build"
  /** Construction in progress → cash (build cancelled). Logged as a credit. */
  | "refund";

export interface BuildCapexTxInput {
  corporationId: ObjectId;
  /** Captured at emit time — tx rows outlive the corp doc. */
  corporationName: string;
  /** Short id for post-deletion forensics; omit when the corp has none. */
  corporationSequentialId?: number;
  direction: BuildCapexDirection;
  /**
   * Magnitude of the cash movement in the corp's OWN currency. Must be
   * positive; the sign is applied from `direction` so a caller can never
   * accidentally book a build as income.
   */
  amountLocal: number;
  currencyCode: CurrencyCode;
  /**
   * Same magnitude in ₳. Positive. Required — the shadow ledger skips rows with
   * no anchor value rather than guessing a rate, so omitting it would silently
   * drop capex out of the conservation check.
   */
  anchorAmount: number;
  turn: number;
  createdAt?: Date;
  /** Sector the capacity is being built in. */
  sectorId: ObjectId;
  sectorType: string;
  /** Capacity units this row pays for (build) or unwinds (refund). */
  units?: number;
  /** Extra grep-able context (build order id, turn the order completes, …). */
  meta?: Record<string, unknown>;
}

function assertMagnitude(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`emitBuildCapexTx: ${name} must be a finite non-negative magnitude`);
  }
  return value;
}

/**
 * Build the tx-log row for one capex movement. Pure — no DB access — so the
 * build command can assemble rows inside its own transaction/bulk and flush
 * them with `emitTxBulk`.
 */
export function buildCapexTxEntry(
  input: BuildCapexTxInput
): Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged"> {
  const magnitudeLocal = assertMagnitude("amountLocal", input.amountLocal);
  const magnitudeAnchor = assertMagnitude("anchorAmount", input.anchorAmount);
  const sign = input.direction === "build" ? -1 : 1;
  return {
    type: input.direction === "build" ? "corp_capacity_build" : "corp_capacity_build_refund",
    turn: input.turn,
    createdAt: input.createdAt ?? new Date(),
    subjectType: "corporation",
    subjectId: input.corporationId,
    subjectName: input.corporationName,
    subjectSequentialId: input.corporationSequentialId,
    amount: sign * magnitudeLocal,
    currencyCode: input.currencyCode,
    anchorAmount: sign * magnitudeAnchor,
    // Deliberately no counterparty: the other leg is the sector's CIP asset
    // account, which the (money-only) shadow ledger does not carry. The derive
    // shim books it against the named `capacity_capex` mint/sink bucket.
    meta: {
      sectorId: input.sectorId.toString(),
      sectorType: input.sectorType,
      ...(input.units !== undefined ? { units: input.units } : {}),
      ...input.meta,
    },
  };
}

/**
 * Emit one capex row. Convenience wrapper over {@link buildCapexTxEntry} for
 * single-shot callers (a player build/cancel command).
 */
export async function emitBuildCapexTx(db: Db, input: BuildCapexTxInput): Promise<void> {
  await emitTx(db, buildCapexTxEntry(input));
}

/**
 * Emit many capex rows in one insert. For turn-phase callers (build queue
 * settlement) — loads thresholds once, as `emitTxBulk` requires.
 */
export async function emitBuildCapexTxBulk(db: Db, inputs: BuildCapexTxInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(db, inputs.map(buildCapexTxEntry), thresholds);
}
