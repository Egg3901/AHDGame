# Legacy deposit-interest settlement qualification

Refs #1328 and #2159.

## Scope and source

Baseline `4f4a853e827f22b65b9224bb034cb2011464483c` and treatment `0ebff93537559a0f7736a26c3749938990b08206` executed from clean source against separate isolated Mongo fixtures. The fixture uses ten synthetic retail banks, twenty legacy savings holders, observed USD FX, the shadow ledger enabled, and the normal banking phase at turn 300. This is subsystem evidence, not a full world or live activation report.

The integrated runtime `7dd5f20e9300d913367a3d057d09b7b24e7465bf` includes the proprietary-book and central-bank facility settlements. It was exercised again from clean source against a fresh isolated Mongo fixture: all normal balances still exactly match the baseline, all four interruption cases converge after two retries, and no unfinished journal remains. The combined phase uses 486 commands and 67798 returned BSON bytes. The twenty-nine legacy and banking-phase integration tests also pass after the merge. Later changes only record this evidence.

## Results

- Both versions pay 400 aggregate native interest, retain exactly twenty transaction receipts and twenty ledger receipts, and produce identical saver balances, bank cash, bank income and insurance fund totals.
- Retrying a completed phase leaves every compared balance and receipt count unchanged.
- Four actual-Mongo interruptions recover to the same normal result after two retries: after the bank debit, partway through the recipient bulk, after transaction records, and after ledger records. No unfinished journal remains.
- Fourteen focused batch tests cover original-quote replay, interruptions before and after writes, partially delivered recipients, concurrent delivery, missing recipients, old claims that require manual recovery, and a constant number of writes for two versus two hundred savers. Fifteen existing banking-phase tests pass.

## Cost and compatibility

| Ten-bank normal phase      | Baseline | Treatment |
| -------------------------- | -------: | --------: |
| Mongo commands             |      422 |       485 |
| Returned cursor BSON bytes |    18577 |     67798 |

The phase remains below its existing 1,000-command budget. Recipient writes and receipt writes remain batched. Original allocations and quote data increase retained journal and read size. The count includes asynchronous audit work that may cross measurement windows, so this bounds the stated synthetic cohort rather than the largest production world.

No interest rates, rounding rules, insurance formula, balance policy or account activation setting changes. Original NPC-interest and shortfall quotes are retained with a paid player batch. Missing FX retains native receipts without an invented anchor value. An old interrupted aggregate claim without recipient allocations requires explicit recovery rather than a guessed payment.

Full CI remains the merge gate. Production rollout, observation and compatibility retirement are still open under #1328.
