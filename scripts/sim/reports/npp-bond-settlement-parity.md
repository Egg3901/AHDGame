# NPP bond settlement parity

Date: 2026-09-06  
Scope: issue 1470 economic agency parity

## Synthetic fixture

The real Mongo integration fixture seeds two independent, otherwise identical
sovereign USD bonds so the player and NPP cannot consume each other's float.
Both actors buy 3 whole units at the same turn and market price:

- face value: 1,000 USD per unit;
- market price: 0.90;
- sovereign dealer ask: 0.909 USD per unit;
- player home wallet: 10,000 USD;
- NPP investment wallet: 5,000 anchor units;
- USD FX rate: 2 local USD per anchor unit;
- each bond public float: 10 units.

The player request invokes the actual bond-buy route. The NPP invocation uses
the actual `nppBuyBond` command core. Both use the shared live ask quote.

## Observed settlement

Both paths settle the same native cost and anchor value:

| Measure             |    Player |       NPP |
| ------------------- | --------: | --------: |
| Units acquired      |         3 |         3 |
| Native cost         | 2,727 USD | 2,727 USD |
| Anchor cost at FX 2 |   1,363.5 |   1,363.5 |
| Public float after  |         7 |         7 |
| Holder units after  |         3 |         3 |

The player wallet ends at 7,273 USD. The NPP investment wallet ends at 3,636.5
anchor units. The market pool receives 5,454 USD, exactly two native costs.
Each successful path persists one `bond_purchase` financial transaction. The
two derived shadow-ledger entries each have zero anchor residual.

The NPP account uses the first-class `npp` subject and its canonical
`npp:<id>:<home-currency>` account. Its authoritative balance is stored in
anchor units, and the reconciler compares NPP opening and closing balances
directly in anchor units across FX repricing.

## Failure coverage

The NPP zero-float path exercises debit, failed reservation, and refund. It
leaves investment cash unchanged and emits no transaction. Existing player
route coverage retains guarded insufficient-funds and reservation-failure
refund checks. The focused RU/SUR test also verifies a non-unit FX rate of 9:
native cost remains local SUR while `anchorAmount` is the rounded cost divided
by 9.

## Interpretation and limits

This closes the player/NPP sovereign-bond settlement parity gap: NPPs no longer
waive the player's dealer ask spread. It covers persisted cash, float, holder,
pool, transaction, and ledger behavior. It does not certify the full NPP
decision cadence, coupon or maturity settlement, cross-currency NPP purchases,
commodity settlement, or every NPP investment writer.

NPP shares and corporation founding still require transaction instrumentation;
until those writers are covered, NPP stock-flow reconciliation findings remain
amber. This report records the evidence for the issue 1470 parity fixture and
does not claim those remaining paths are complete.
