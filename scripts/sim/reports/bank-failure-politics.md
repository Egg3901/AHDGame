# Funded bank failure political consequences

Production rules; USD amounts and GDP share one currency. GDP is a representative 1991 US baseline. Payouts are assumed already settled; this report does not fund or predict failures.

| Case     | Paid deposits | Paid taxpayer backstop | Approval pp at payout | Confidence target pp at payout | Approval pp at turn 24 |
| -------- | ------------: | ---------------------: | --------------------: | -----------------------------: | ---------------------: |
| small    |       1000000 |                 100000 |             -0.000002 |                      -0.000016 |              -0.000001 |
| large    |   10000000000 |             1000000000 |             -0.016129 |                      -0.161290 |              -0.008065 |
| systemic | 1000000000000 |          1000000000000 |             -3.000000 |                     -10.000000 |              -1.500000 |

Approval is capped at -3 pp and confidence target at -10 pp across all active bank failures per country. Costs fade linearly to zero over 48 turns. Small approval effects may round to zero in the existing national approval display. Confidence uses the existing metric engine inertia, rather than a new direct cash or metric increment. Repeated epoch events are deduplicated. Flag off causes zero event reads. One bounded event read serves every country per consuming phase; no per-country event query is added.
