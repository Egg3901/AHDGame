# Treasury reserve transfer recovery qualification

Continues #1328. This report qualifies the treasury/reserve command, not the entire banking migration or production rollout.

Runtime source: `4ebec5b1566cd4de6a04ff6200bd7967fa403d05`, clean checkout. Companion JSON contains the exact synthetic states. Native Mongo ran with real command, route authority lookup, journal, ledger, audit, and treasury-turn code. Fixtures replace authentication, database binding, and the current-turn lookup. No production data or production mutations are included.

## Results

- Seventeen cases passed: two normal API paths (including signed cash positions), ten interruptions before/after cash, financial receipt, ledger, and audit writes, two evicted receipt cases, same-command concurrency, different-command turn eligibility, and two actual treasury turns.
- Each accepted command exchanged 1,000 native units exactly once. A treasury position of 10,000 and reserve position of 5,000 became 9,000 and 6,000. Annual spending and surplus did not change. Signed treasury and reserve positions are supported intentionally.
- Concurrent recoveries converged to one cash movement, one financial receipt, one balanced ledger witness, one transfer-history row, and one original actor/turn audit. Changed command inputs were rejected.
- Two distinct player commands submitted in the same turn admitted exactly one. Shared receipt-array eviction did not repeat either cash write.
- After two actual treasury turns, control and treatment combined cash both equaled 19,166. The treatment retained the original 1,000 treasury/reserve difference without changing subsequent accrual.
- An idle recovery scan made no financial changes. Two scans made three database commands total, including the first-use index check, and returned 325 BSON bytes. The full audited API command made 37 commands and returned 20,409 BSON bytes. These are small synthetic command measurements, not full-world phase-budget qualification.

## Scope

The bounded recovery query uses a partial index and processes at most 100 outstanding command IDs per turn. Treasury cash is signed; annual budget eligibility and the per-turn revenue cap remain enforced. Missing treasury cash requires reconciliation. The original receipt freezes financial, ledger, and audit identities before delivery.

The balanced ledger witness includes a central-bank reserve contra account. This does not add that reserve pool to the global stock snapshot registry and does not establish #992 stock-flow closure. Production migration, observation, and retirement gates in #1328 remain separate.
