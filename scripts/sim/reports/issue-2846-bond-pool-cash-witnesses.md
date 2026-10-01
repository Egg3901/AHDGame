# Bond-pool cash witnesses (#2846)

## Defect and repair

The retained corrected #992 accounting treatment has 17 bond-pool accounts whose cash moves without a primary ledger witness. This repair instruments the actual upkeep, coupon and maturity cash writers. It does not rewrite retained evidence or qualify the remaining full-world conservation gate.

Credits and successful gated debits use the same rounded native amount as the authoritative cash write. FX conversion matches the existing bond-pool balance snapshot. Turn processing loads one accounting context for upkeep and the accumulated issuer receipts; direct receipt callers use the current game clock. Session-backed witnesses use the cash writer's session.

The additive `bond_pool_inflow` and `bond_pool_sweep` transaction labels describe modeled liquidity outside observed M2, under the explicit `bond_pool_excluded_liquidity` reason. Coupon and maturity receipts retain `bond_coupon_settlement` and `bond_settlement`, matching existing issuer witnesses. Primary placement and secondary trade legs are not inferred by these helpers, so existing journals are not duplicated.

No economic constant, cash amount, guarded-debit rule, snapshot boundary or reconciliation tolerance changes. Shadow accounting remains disabled unless the database configuration explicitly enables it.

The turn shells publish witnesses in a phase batch, including when a later operation fails after cash has landed. Direct and session-backed calls retain immediate publication.

## Verification

- Before repair, four actual writer regression cases fail: USD and GBP upkeep and coupon receipts change pool cash but have zero ledger movement.
- Existing bond-pool, upkeep, bond-turn and sovereign primary-settlement suites pass: 109 tests.
- Expanded accounting integration and derivation suites pass: 36 tests. Guard coverage includes native rounding, non-USD FX, excluded-inventory sweeps, issuer pairing, failed and repeated stamped debits, no-op credits, a stale game clock, missing FX observations, context reuse, disabled shadow accounting and shadow insertion failure.
- The final cash-writer suite passes all 17 cases, including failed authoritative credits and matching cash/witness session arguments.
- Disposable native Mongo writer fixtures pass for USD and GBP. Upkeep, coupon, maturity and stamped sweep produce four balanced entries per currency with zero stock-vs-flow divergence and zero unattributed movements. Paired issuer settlements produce four balanced entries per currency, zero divergence and zero settlement net drift. Disabled-shadow fixtures produce no entries. Each owned fixture is removed after verification.
- The final batch, upkeep and bond-turn suites pass 79 tests. Native profiling of the same two-currency upkeep fixture reduces Mongo round trips from 17 to 16, inserts from two to one, request BSON from 4,666 to 4,501 bytes and response BSON from 1,855 to 1,824 bytes. Returned documents remain seven; cash results and both ledger documents remain identical, with zero divergence. These are logical command payloads for a bounded writer fixture, not full-world phase telemetry.
- Hosted delivery checks are recorded on the linked pull request before issue closure.

These are cash-writer and delivery qualifications. They do not assert a new full-world result, zero remaining government/corporation divergence, economic stability, or release readiness under #968/#2159.
