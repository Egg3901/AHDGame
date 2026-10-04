# Queued fund payout recovery qualification

Refs #2223 and #2159. This is a partial component qualification; #2223 remains open.

## Executed source

- Runtime: `2e3f5961d11921e6a3f3a5dab9b17fc45c4a977b`.
- Baseline: `283fa48a53e0efa856510e44acb9714ec43875c2`.
- No balance constants, NAV formulas or FX conversion formulas change.

## Verified scope

Queued payouts preserve their original cash and unit quote, then resume through the
existing settlement journal before ordinary fund pricing or trading. Durable cash,
receipt and final queue outcomes make replay safe after interrupted acknowledgements.
Claim ownership fences delayed workers. Proven refusal can return the original debit;
ambiguous historical processing rows remain unchanged for explicit reconciliation.

The change adds optional queue claim and frozen plan fields. Existing rows need no
rewrite. Marker-less historical processing rows do not acquire an invented payout
history. New claims clear an old plan only after protected finalization is complete.

- 72 focused cases across five suites pass, including ordinary cron recovery,
  frozen FX amounts, legacy unit supply, claim ownership and compensated refusal.
- 22 native Mongo cases pass: eleven controls on standalone Mongo and the same
  eleven on an isolated replica set. These exercise acknowledgement boundaries,
  concurrent settlement and legacy unit supply against the actual database driver.
- Every native case preserves synthetic aggregate cash of 1,050, publishes one
  payout receipt, one cash witness, two ledger rows and one audit row, and remains
  stable across three additional recovery calls.
- Scoped lint, formatting and the architecture audit pass with zero blocking findings.

All database fixtures use empty sandbox namespaces. Production is untouched.
Native FX and compensation variants are not claimed here; their focused cases use
the shared stateful test adapter.

## Database cost

The matched native profile uses identical synthetic inputs and equal-length namespace
names. Opening and closing balances, payout counts, ledger rows and retry outcomes
match at every size. Reconciliation reports zero stock divergence, trial imbalance
and unattributed movement.

| Payouts | Before commands | After commands | Before returned BSON bytes | After returned BSON bytes |
| ------- | --------------: | -------------: | -------------------------: | ------------------------: |
| 0       |               1 |              2 |                        119 |                       238 |
| 1       |              16 |             39 |                       1807 |                     22486 |
| 8       |              79 |            270 |                       8856 |                    177186 |

Durable recovery increases database work. Holder reads remain batched; the extra
commands persist and acknowledge settlement outcomes. The existing index-fund phase
budget of 18,000 commands is unchanged. This measures the payout component only,
not a whole turn or load profile. No wall-clock improvement or full phase acceptance
is claimed.

## Remaining acceptance

Holding sales and public float purchases still require recovery qualification.
The full hosted merge gate and review must pass before delivery. Broad financial
conservation, selected world validation and performance acceptance remain with
#2159 and their owning issues. This report closes no tracker checkbox.
