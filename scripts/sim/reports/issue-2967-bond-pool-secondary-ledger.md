# Issue 2967: bond pool secondary trade cash qualification

Runtime source: `7410494e38d9709d1c59b17cf05e9d406e95622e`.

The current-source twelve-turn cash diagnostic in #968 reported repeated bond pool
stock divergences. A minimized native Mongo fixture isolated one cause. With an EUR
rate of 2, an actual secondary purchase credit of 100 EUR moved pool cash by 100
native and 50 anchor but recorded no pool ledger movement. The reconciler reported
one uninstrumented divergence of -50. An otherwise identical upkeep inflow
reconciled cleanly. The pool witness map covered upkeep, coupons and maturities but
omitted secondary purchase and sale cash.

## Change

- Secondary purchase credits and sale debits publish the exact rounded native and
  anchor movement that landed, with the shared bond principal settlement reason.
  Primary placement stays owned by its financing journal.
- A refund publishes the exact reverse movement only when its guarded write changed
  the pool. A stamped refund requires the debit's stamp and clears it in the same
  write, so duplicate and missing-target refunds move no cash and publish nothing.
  The sale route uses this primitive instead of its inline copy.
- Fund and NPP phases load accounting metadata lazily, once per phase and database,
  then publish one batch, including when later work in the phase fails.
  Transactional fund purchase batches publish their pool witnesses inside the same
  transaction.
- No balance constant, cash outcome, gated debit rule or reconciliation tolerance
  changed. Disabled shadow accounting behaves as before.

## Verified outcomes

The secondary integration file has 28 cases. All 17 native Mongo cases, run on an
isolated local replica-set fixture, and 10 memory cases pass. One memory case is
skipped because the memory store does not model stamped array filters; its native
twin passes.

- USD and GBP purchases and sales record rounded amounts. Stock reconciliation is
  unskipped with zero divergences, a green trial balance and no unattributed entries.
- A stamped debit and refund net to zero once. Duplicate and missing-target refunds
  are refused without a witness.
- Partial fills witness only the cash that moved. Refused and zero writes record
  nothing.
- The actual NPP buyer and fund buyer reconcile against the pool in USD and GBP.
- Transactional fund batches commit cash, holdings and pool witnesses together. An
  outer abort rolls all of them back, in USD and GBP.
- Simultaneous worlds and currencies stay isolated, and a finished phase is never
  reused.
- Landed cash is still published when later work in the phase fails.

The focused bond, fund, NPP and route suites (33 files) pass: 372 passed and 19
native opt-in cases skipped. The previously interrupted native run, plus the NPP
action phase suite, passes: 12 files, 152 passed, 1 skipped. Scoped lint, formatting and
semantic diagnostics pass for all 13 changed TypeScript files. The full merge gate
runs on the final pull request head.

The interrupted run's two sale route failures were a test timing defect, not a pool
defect. The first case imported the route inside its 15 second budget. On a loaded
host the import outlasted the budget, and the still-running request consumed the
next case's one-shot bond fixture. The base runtime reproduces the same timeout. The
sale and buy route tests now import the route at collection time and pass with a 1
second per-case budget.

## Performance

Identical native fixtures with 0, 1 and 8 secondary credits inside one phase:

| Credits | Commands before / after | Returned BSON bytes before / after | Divergences before / after |
| ------: | ----------------------: | ---------------------------------: | -------------------------: |
|       0 |                   0 / 0 |                              0 / 0 |                      0 / 0 |
|       1 |                   1 / 4 |                           35 / 419 |                      1 / 0 |
|       8 |                  8 / 11 |                          280 / 664 |                      1 / 0 |

Cash outcomes are identical: 10000, 10100 and 10800. The added cost is constant per
active phase: two metadata reads and one batched ledger insert. A phase with no pool
cash movement issues no extra commands. The profile ran at
`9340a70111167b6a721fdb91f96644e9948e1353`, which differs from the runtime source
only by formatting and by the rebase onto #2968 and #2974. Neither changes the
profiled path.

## Scope and limits

These native fixtures qualify the secondary trade boundary, not the whole world.
Whole-world residuals remain visible until a fresh run qualifies them, so this does
not clear #968 or the global cash gate in #2159. No production database was reset or
repaired.
