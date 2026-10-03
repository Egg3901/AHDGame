# NPC fund subscription debit ownership (#992)

## Reproduction

The fund investment writer recorded an aggregate NPC subscription debit directly in the shadow ledger, then recorded the same debit again through each financial transaction's ledger shim. Investment income was already recorded correctly. The cash account moved once; its accounting debit moved twice.

The regression runs the actual investment writer, transaction emission, balance snapshots and reconciliation. Its original implementation produces a stock-flow mismatch equal to the subscription amount in both USD and GBP fixtures. Removing the aggregate debit leaves the transaction shim as the single owner of the NPC debit and fund receipt.

## Verification

- 39 focused investment and dividend tests pass, including the writer regression, cash and holdings state, reconciliation, and same-turn retry convergence.
- Native Mongo fixtures: US subscription 1,800 anchor and UK subscription 1,000 anchor each produce zero divergent accounts, green trial balance and attribution, three ledger entries, and zero investment or extra ledger entries on retry.
- The in-memory adapter now returns the actual inserted identities from `insertMany`, matching the driver's result contract. This allows the writer's existing acknowledged-insert checks to run without substituting those checks.
- Cash writers, investment budgets, portfolio allocation, holdings and eligibility are unchanged. No tolerance or skip was added.

## Retained accounting replay

The retained control ran at `89b20b09716801d3d952d9a3698ffe08b2d23b0a`. The accounting-only replay removes the exact redundant aggregate witnesses from NPC primary entries and reruns reconciliation with the original opening and closing cash snapshots.

| Investment-cycle turn | Redundant debit witnesses | NPC divergences before | NPC divergences after |
| --------------------- | ------------------------: | ---------------------: | --------------------: |
| 16                    |                     2,517 |                  2,517 |                     0 |
| 20                    |                     2,521 |                  2,521 |                     0 |
| 24                    |                     2,526 |                  2,526 |                    40 |

The retained turn-24 residual is 1,146.32 anchor across 40 NPC accounts. It remains visible and needs its own writer evidence; this repair does not claim it resolved. Trial balance remains green and the unattributed bucket is empty in all three replayed turns. Original cash snapshots are unchanged.

This is a scoped accounting replay, not a replacement full-world simulation. The preregistered issue exit gate remains at least 20% fewer raw divergent accounts in every one of 12 consecutive matched full-engine turns, with green trial balance and attribution throughout. The separately running prior treatment does not contain this repair. Broader accounting and release gates remain open.

## Development delivery qualification

The original repair merged into a rehearsal candidate. Development delivery at clean runtime `372aa39cc0cf7c625a9ec1fc1b13ab45cb624be5` retains the production writer exactly and includes later merged cash repairs. All 51 focused investment and dividend cases pass. Fresh isolated native USD and GBP writer fixtures repeat the 1,800 and 1,000 subscriptions above, with three entries each, green trial balance and attribution, zero stock-flow divergence and no additional investment or entries on retry. The fixtures preserve their evidence and do not advance a world.

Issue #992 is already closed on its separately verified full-engine comparison. This delivery does not count a second closure or a new #2159 check. The historical retained replay above remains scoped to its recorded source; broader global conservation and final-release qualification remain open. Full hosted CI must pass on the final delivery head.
