# Fund float settlement recovery qualification

Issue: #2223. Clean executed runtime: `0b02d33be561485db154332ea4d7fdc5bf6ac001`.

The queued payout component was delivered by #2956 at
`0538f4264354eeb837dc1b0b47639e74591fca17`. This change completes the actual
public-float purchase and holding-sale handlers using the existing protected
cash settlement journal, a restricted equity custody leg and frozen receipts.
Recovery runs before ordinary fund pricing and trading. It retains the original
quote and cash routing. A recorded refusal can reverse its proven effects;
an unknown acknowledgement resumes the original operation.

## Verification

- 157 focused cases pass across the fund handlers, ordinary cron, subscription
  and redemption flows, queued payouts, money-move durability and journal rules.
- Native Mongo qualifies 42 float controls on standalone and 44 on a replica set.
  The latter includes two actual outer transaction aborts with all effects rolled back.
- The previously delivered queued payout matrix was rerun on this runtime:
  11 native controls per configuration. Total native controls: 108.
- Controls cover accepted claims, cash, custody, receipt publication, concurrent
  callers, proven refusals, interrupted refunds, repeated recovery, original IPO
  allocation, finite pools, escrow, legacy custody and frozen currency conversion.
- Explicit completed reversals publish matching inverse witnesses. Multiple
  holding sales restore the opening balances and holding book; repeated undo is stable.
- Complete authoritative cash fixtures reconcile with zero stock divergence,
  trial imbalance and unattributed movement. Pool and escrow routes separately
  prove their original cash totals and conservation counters; their system cash
  is not added to the ledger's existing balance snapshot coverage.
- Old helper-stub purchase and sale tests were replaced with stateful tests of
  the actual handlers. Planner, rebalance and bid policy assertions remain.
- Scoped semantic diagnostics pass for all 14 changed TypeScript files.
- Archived float plans are classified as runtime state and selected for reset
  with their funds and corporations. The manifest and bootstrap contract tests
  verify that recovery records cannot survive into a new world.
- System cash witnesses use the documented financial subject type with their
  original cash path in metadata. Existing records require no rewrite and ledger
  snapshot coverage is unchanged.
- Scoped lint and the architecture blocking checks pass. Hosted delivery gates
  are still required before merge and issue closure.

## Matched native component measurements

The original and repaired handlers execute identical synthetic purchases on a
local standalone Mongo server. Fixtures use 0, 1 and 8 corporations, equal-length
isolated namespaces and the same opening cash, prices and custody. The measurement
includes recovery admission and all completed receipt writes, excluding fixture
setup and subsequent inspection. Monetary and custody outcomes are identical.

| Purchases | Original commands | Repaired commands | Original returned BSON bytes | Repaired returned BSON bytes |
| --------- | ----------------: | ----------------: | ---------------------------: | ---------------------------: |
| 0         |                 0 |                 1 |                            0 |                          128 |
| 1         |                17 |                55 |                         1546 |                        58984 |
| 8         |                66 |               419 |                         7895 |                       625242 |

Original source: `0538f4264354eeb837dc1b0b47639e74591fca17`.
Repaired source: `0b02d33be561485db154332ea4d7fdc5bf6ac001`.
Original stock-witness divergence is 1 and 8 respectively; repaired divergence
is zero, with a balanced trial and no unattributed movement. Repeated repaired
recovery preserves the closing cash and original receipts.

The additional database work provides durable recovery and complete cash
witnesses. These are component measurements, with no claimed performance gain.
The existing 18000-command fund phase budget is unchanged. Full-load turn
performance (#2088), selected-release world accounting (#968), broader financial
product acceptance and the final world matrix remain open on #2159.

All native controls used new, isolated synthetic fixture namespaces. No database
was dropped and production was untouched. See the accompanying JSON report for
source revisions, measured values and the exact scope of acceptance.
