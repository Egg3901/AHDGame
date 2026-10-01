# NPP reinvestment cash publication (#2865)

## Defect and repair

The actual NPP decision processor used to publish its capacity-build financial history while only returning the corporation cash operations for a later write. A native USD fixture with an invalid first Mongo operation leaves cash unchanged but records a 22,308,000 reinvestment debit. The balanced ledger therefore reports one stock-versus-flow divergence of -22,308,000.

The repair prepares the existing capex transaction documents without publishing them. Each corporation's accepted decision cash operation atomically carries an additive `nppReinvestmentCashWitnessKey`. After the real cash batch succeeds or fails, one projected cohort read admits only matching landed stamps. Idempotent financial-history and shadow-ledger upserts reuse the prepared transaction ids. Repeated publication can recover a missed history write without debiting cash again or adding duplicate transactions. Existing thresholds, expiration, names, metadata, native/anchor costs and ledger derivation remain unchanged. Audit events accompany newly inserted financial history rows.

The observer preserves accepted economic decisions, borrowing, cash amounts, capacity/build behavior and constants. It neither refunds nor invents a failed debit. Financial history is still recorded when shadow accounting is disabled, and observer errors cannot fail an otherwise successful cash operation. The optional corporation stamp needs no migration, backfill or new index.

## Verification

- Actual native Mongo first-operation rejection is red before repair: cash delta 0, one phantom capex entry, divergence -22,308,000.
- After repair, the same native rejection leaves cash unchanged and produces zero financial-history or ledger entries, divergence, imbalance and unattributed movement.
- Native USD/EUR/JPY plants, EUR legacy and actual ordered failure after the landed debit all preserve previous cash outcomes with zero stock divergence, trial imbalance and unattributed movement. Repeated publication adds no duplicate financial-history or ledger entries. All six native cases pass.
- Initial focused writer/currency/command-economy/cash-rail/capex suites pass 34 cases. The extended writer suite adds mismatched-stamp rejection and failed-history recovery. The adapter suite passes 22 cases including Mongo bulk upsert index semantics.
- Matched successful USD native processor/writer telemetry: commands 39 to 39; request BSON 13,645 to 13,361 bytes; response BSON 5,382 to 5,145 bytes; returned documents remain 18. Cash remains -61,408,000 and ledger entries remain two. Audit logging is disabled in both measured fixtures to isolate its asynchronous buffer. A single projected read replaces the pre-write shadow flag read; bookkeeping remains batched, with no per-corporation queries.
- Owned disposable native fixtures are removed after verification. Final source and exact-head hosted delivery results are recorded on the implementation PR before closure.

This qualifies reinvestment publication, not every corporation cash movement or the full-world conservation/release gates under #968 and #2159. The independent founding cash observer is covered by #2859.
