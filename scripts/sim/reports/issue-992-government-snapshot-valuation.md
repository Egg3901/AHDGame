# Government snapshot valuation for #992 and #968

## Result

Actual retained treasury accrual plus balance snapshots and reconciliation: **six control divergences become zero** across all 23 budgets. Trial balance stays green and the unattributed bucket is empty. Opening and closing native treasury hashes match the control exactly; no exchange-rate documents change.

## Source and scope

- Treatment executable `e8a400a8899af0a646c78ce2a14956087e7be844`. Later report/comment changes do not alter runtime.
- Control executable `9ecb98e3000c32e5c1bba375d48e9956a2c8e508`: runtime `da966e9fe3` with the identical runner as its only added file.
- Completed retained run `559d9701-e07f-48c8-ade1-294bc926820a`, generator `b4eb48872d6b17d64cd91a85202619f181797713`, saved turn 13. Actual treasury phase advances the isolated copied budgets at turn 14.
- Before/after copied-selection hash in both runs: `97fc6a209db62c4e624f5d10f29ba578e707a3d2db82f41924f138b3a743660f`. The read-only source selections are federalBudget, exchangeRates, gameState and centralBanks. No full-world claim is made.
- Runner: `scripts/sim/budgetSnapshotValuationReplay.ts`. It calls actual `writeBalanceSnapshot`, `processTreasuryTurn`, `writePreForexBalanceCheckpoint`, and `reconcileTurn`. No manual balance or ledger normalization is used for treatment.

## Repair

Government snapshots use the same `treasuryAnchorValuation` contract as treasury receipts: prefer a valid observed rate, allow an authored historical valuation only for an explicitly inactive foreign-exchange budget country with its assigned currency, and reject corrupt observed rates or missing active-currency rates.

The snapshot stores each government account's rate, source and preset separately from the tradable currency-rate map. Reconciliation uses these account-specific denominators to reconstruct native cash around the forex checkpoint. Old snapshots without this metadata retain their recorded old currency denominator, so the migration from an earlier 1:1 snapshot to an authored rate does not look like a cash flow. No exchangeRates document, treasury balance, ledger entry, or tolerance is rewritten by snapshotting.

This corrects a producer/consumer mismatch after treasury receipts gained authored valuations. It does not research new exchange rates or enable trading for budget-only currencies.

## Measured checks

| Measure                      | Control | Treatment |
| ---------------------------- | ------: | --------: |
| Budgets                      |      23 |        23 |
| Divergent accounts           |       6 |         0 |
| Trial balance                |   green |     green |
| Unattributed entries         |       0 |         0 |
| Snapshot Mongo commands      |      11 |        12 |
| Snapshot returned BSON bytes |   2,845 |     2,892 |

The additional command is one projected gameState preset read, independent of budget count. The default 500-command phase budget is unchanged. Measurements cover the real opening snapshot call on this isolated cohort, excluding copy, accrual and report reads; they do not claim whole-world phase performance.

Native opening hash: `ba99ff45fd618b8d2424b973abf7c813985289003b03921cce8ca064d29a3442`. Native closing hash: `9a194523a76ca5513f6fe0a3c1c800523a94d78a25e9f98b2bb7e82f68ae0012`. Both are identical in the two executions.

**16 focused tests passed:** four new stateful valuation cases plus 12 existing reconciler tests. Coverage includes actual receipt and snapshot agreement, transition from legacy opening snapshots, observed-rate preference, explicit corrupt-rate rejection, and rejection of an active currency without a live rate. New snapshots fail explicitly rather than guessing an unsupported government denominator; existing shadow snapshot wrappers retain their error reporting behavior.

The combined full-engine 12-turn material-decline acceptance for #992 remains pending. These observations qualify only this valuation boundary. Machine-readable results: [issue-992-government-snapshot-valuation.json](./issue-992-government-snapshot-valuation.json).
