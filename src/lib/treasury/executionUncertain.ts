/**
 * Signals that a treasury execution failed with money possibly already
 * moved, and that the caller must NOT unwind as though nothing happened.
 *
 * Production Mongo is standalone, so the executors take a sequential
 * debit-then-credit path with no transaction to roll back (see
 * `runTransactionWithSessionRetry`). They compensate by refunding the
 * debit when the credit fails. When that refund ALSO fails, the treasury
 * is short and the recipient has nothing, and the failure can no longer
 * be reported as an ordinary refusal: the two-person approve route reads
 * an ordinary failure as "the transfer did not happen", hands the
 * approver's signature back and reopens the row, and the next Approve
 * click debits a second time.
 *
 * A row in that state is left `executing` for an operator to reconcile.
 * It is rare by construction — it takes a second write failure
 * immediately after the first — but it is the one case where unwinding
 * automatically is worse than stopping.
 */
export class TreasuryExecutionUncertainError extends Error {
  /** Discriminator, so a structured-clone or cross-realm copy still matches. */
  readonly treasuryStateUncertain = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TreasuryExecutionUncertainError";
  }
}

/**
 * True when the error says the treasury may have been debited without a
 * matching credit. Checked by property rather than `instanceof` so it
 * survives a re-thrown or wrapped copy.
 */
export function isTreasuryExecutionUncertain(error: unknown): boolean {
  return (
    error instanceof TreasuryExecutionUncertainError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { treasuryStateUncertain?: unknown }).treasuryStateUncertain === true)
  );
}
