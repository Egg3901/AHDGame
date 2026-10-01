# Issue2868: exact corporate escrow cash receipts

## Confirmed failure

On engine source`654fbb578f8243040208a1e1f1d3d1c7e9f6924d`, the actual corporation turn transfers USD300.25 from liquid cash to share-buyback escrow but records a rounded300receipt. Cash goes from1000to699.75; the ledger reports only300, leaving0.25stock-flow divergence. EUR has the same native discrepancy. JPY's anchor discrepancy can fall below the existing tolerance, but the native receipt still loses precision. Manual withdrawals also round the amount and use an unattributed contra.

The repair preserves exact native amounts and resulting escrow balances in both receipt builders. `corp_escrow_withdrawal` uses the existing `escrow_transfer` reason, matching funding. No cash rule, rounding rule in the authoritative writer, exchange rate, balance snapshot, schema, enablement flag or settlement ordering changes. Escrow remains an explicitly named unmodeled contra rather than a newly invented money account.

## Verified scope

54focused cases pass across receipt, escrow rules, attribution and reconciliation files. The new cases include fractional USD/EUR/GBP/JPY receipts, sub-unit transfers and actual derived ledger reconciliation. Existing integer and non-positive controls remain green.

Five matched native Mongo fixtures exercise the actual lookup loader, sector processor, corporation cash writer and financial-history emitter for funding, then the exact atomic withdrawal writer shape and actual emitter. The withdrawal replay is not an authenticated HTTP or player browser qualification.

| Case                | Cash after funding | Cash after withdrawal | Funding divergence | Withdrawal divergence | Unattributed |
| ------------------- | -----------------: | --------------------: | -----------------: | --------------------: | -----------: |
| USD fractional      |             699.75 |                   800 |                  0 |                     0 |            0 |
| EUR fractional      |             699.75 |                   800 |                  0 |                     0 |            0 |
| JPY fractional      |             699.75 |                   800 |                  0 |                     0 |            0 |
| USD integer funding |                700 |                800.25 |                  0 |                     0 |            0 |
| EUR shadow disabled |             699.75 |                   800 |       not observed |          not observed | not observed |

Every matched native cash/escrow outcome is identical before and after the repair. All four shadow-enabled fixtures have zero imbalance and zero divergence or unattributed movement in both directions. Shadow-disabled cash and exact financial history persist with zero shadow entries; an intentionally disabled observer does not qualify conservation. All temporary databases are removed. Production is untouched.

## Bounded performance measurement

The matched USD funding fixture retains45Mongo commands and9returned documents. Request BSON is9384→9457bytes; response BSON is5276→5317bytes. Exact fractional receipt fields account for the representation change. Every other matched case also retains its query and document counts. Audit logging is disabled in both arms. This is a bounded writer/emitter measurement, not full-world phase-budget acceptance.

The final executed repair source, source receipt, complete hosted gate and delivered revision are recorded in [issue2868](https://github.com/Egg3901/AHDGame/issues/2868).

## Reproduction and remaining gates

Run focused coverage with:

```text
npx vitest run src/lib/corporations/escrowTxLog.test.ts src/lib/corporations/escrowCashLedger.test.ts src/lib/corporations/escrowFunding.test.ts src/lib/ledger/__tests__/deriveFromTx.test.ts --maxWorkers=1
```

For the native fixture, seed a synthetic corporation with1000local cash,20.5escrow, no sectors or salary/dividend/budget spending, escrow mode and300.25per-turn funding. Seed the selected currency/rate and enabled ledger shadow. Capture actual balance snapshots around the real corporation cash and history calls. Then atomically move100.25back from escrow, emit its actual withdrawal receipt and reconcile that separate movement. Repeat for the currencies above and with shadow disabled. Do not run against a live game database.

This closes the receipt precision/attribution defect only. Whole-world monetary conservation remains under#968; selected-source launch acceptance stays under#2159. The pre-existing queued world diagnostic retains its original immutable source and does not certify this later repair.
