# Loan origination fee cash and equity reconciliation

Reproduce with `npx tsx scripts/sim/loanOriginationFeeModel.ts`. This report calls the production quote rule. A 1% fee is withheld from proceeds while principal stays unchanged. It models immediate funding only; it does not claim a bank ROE or loss-rate target.

| Currency |  Principal |      Fee | Funded proceeds | Bank equity gain |
| -------- | ---------: | -------: | --------------: | ---------------: |
| USD      |      12.34 |     0.12 |           12.22 |             0.12 |
| USD      |  100000.00 |  1000.00 |        99000.00 |          1000.00 |
| USD      | 1000000.00 | 10000.00 |       990000.00 |         10000.00 |
| JPY      |      12.34 |     0.00 |           12.34 |             0.00 |
| JPY      |  100000.00 |  1000.00 |        99000.00 |          1000.00 |
| JPY      | 1000000.00 | 10000.00 |       990000.00 |         10000.00 |

In every row bank cash outflow equals borrower cash inflow. Bank assets rise only by the quoted fee because the full receivable replaces the net cash advance. Household funding uses the same rule; repayments and existing balances carry no new fee. A stored zero fee preserves legacy pending requests. Integration tests pin a second approval to no additional cash movement or lifetime fee.
