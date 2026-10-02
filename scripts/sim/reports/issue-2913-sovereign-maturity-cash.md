# Sovereign maturity treasury settlement (#2913)

## Original defect

The actual bond processor matures a valid sovereign USD bond with three holder units and 3,000 face outstanding. Its issuer budget starts at 100,000 cash and 3,000 principal debt. Holders receive principal, debt retires, and financial history records a 3,000 government payment, but cash remains 100,000. The native reconciler reports government cash delta zero versus ledger delta -3,000. Scheduled primary rollover now funds treasury, so redemption must pay its matching principal from treasury.

## Repair

The existing budget update now atomically debits the principal payment and retires debt. The payment amount comes from the existing outstanding-holder/float/central-bank unit total. Full-face holder payouts and the independently haircut-adjusted debt retirement stay unchanged. The treasury keeps its existing signed-balance semantics; repayment does not create extra debt principal from a negative cash balance.

Successful settlement returns its native amount and currency. Missing or concurrently removed budgets return no payment result and produce no government repayment history. A malformed cash field makes the real Mongo update reject both cash and debt changes; no payment history is published. A mismatched bond/treasury currency fails before settlement. Holder coupon/principal algorithms are unchanged.

The government's witness uses the same `treasuryAnchorValuation` contract as authoritative balance snapshots, including the selected era's budget-only valuations. Enabled shadow valuation is checked before paying, without an added per-bond read. The original budget read and update remain the two settlement round trips.

## Verification

Run `npx tsx scripts/sim/verify-sovereign-maturity-cash.ts --out result.json` with `SIM_MONGODB_URI` restricted to an isolated local sandbox on port 27018. Every case asserts an empty newly generated database; cleanup drops only those owned fixture databases.

Eleven actual processor/Mongo/history/balance/reconciler cases pass:

- USD, GBP and JPY repay exactly 3,000 native units and retire debt to zero.
- Historical Poland uses PLZ and its authored 1991 budget-only valuation without adding a synthetic tradable rate.
- Haircut-adjusted debt retires 1,800 while the existing holder model redeems the full 3,000 face.
- A treasury with 100 cash becomes -2,900 while debt retires independently.
- Zero outstanding units and missing budgets produce no government repayment history.
- Real rejected `$inc` and currency mismatch leave issuer cash/debt unchanged with no government payment history.
- Shadow disabled still pays the same cash and records native payment history, with no shadow entries. Its four expected unobserved differences are not conservation qualification.
- Reprocessing the already completed maturity pays no second principal and adds no duplicate repayment record or ledger entry.

Every enabled case has zero stock differences, a green trial balance and zero unattributed entries. The original coupon-plus-principal reproduction also passes with the unchanged holder cash increase of 3,003.21 and a genuine issuer debit of 3,000. Five persisted-state regression tests pass alongside 103 existing bond/sovereign tests.

Measured full valid fixture calls use 30 to 31 Mongo commands, within the 1,000-command bond budget. USD uses 9,345 request BSON bytes; JPY 9,395; the historical PLZ case 9,599. Budget settlement adds no query or separate cash operation. These bounded fixtures do not qualify full-world performance.

## Limits

The missing-budget fixture verifies the absence of phantom issuer history, not the acceptability of missing world content. It preserves existing holder payout behavior; missing budgets remain a world-conformance defect. Haircut payout semantics and central-bank redemption mechanics are unchanged. This repair does not make the whole bond phase atomic or its interrupted replay globally idempotent. The new issuer debit changes subsequent fiscal paths and needs the final selected-source world qualification. Earlier immutable queued worlds are unchanged and do not certify this later repair. #968, #1328 and #2159 remain open.
