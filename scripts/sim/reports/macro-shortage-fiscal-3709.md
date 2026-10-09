# Goods shortages and fiscal restraint (#3709)

Status: component qualification passed; full-world qualification pending. This
report does not authorize production deployment.

## Question

Can affordable existing-plant growth and a damped producer input-cost signal
reduce persistent goods shortages while deficit-aware autonomous policy makes
fiscal expansion less effortless, without a sudden recession or insolvency wave?

## Changes

Existing plants may order integer capacity additions smaller than a founding
facility. The cash floor, construction lead time, utilization and input-fill
gates, pending-unit ceiling and finite extraction headroom remain in force.
Founding sizes remain unchanged. Producer input pressure now uses the same
realization exponent and clamp as physical input costing, on the price formation
pipeline's lagged real ratios. Nominal billing and real price formation still
have different inflation bases; this is not a claim that their entire indices
are numerically identical.

Autonomous fiscal stance adds a continuous deficit bias above 3% of GDP, capped
at two score points. It uses coherent annual budget revenue, spending and GDP,
including interest. Missing accounting adds no bias. Agenda, inflation, debt,
political incentives and ordinary sponsorship cadence still determine policy.
There is no direct spending rewrite or bond coupon cancellation.

## Component evidence

Ten relevant test files pass, 93 tests total. The three new regressions failed
against the original implementation and pass with the candidate:

- A 9x input ratio formerly produced a 9x cost-pressure index while the physical
  realization factor was capped at 2x. The candidate applies the damped 2x factor.
- A sold-out existing retail plant with cash for a smaller addition formerly
  placed only a maintenance slice. It now places a sub-facility growth order
  while preserving the protected cash reserve.
- A calm government with low debt and a 10% annual deficit formerly remained
  neutral. It now favors restraint before debt exhausts fiscal headroom. Small
  deficits, unknown accounting, invalid GDP and currency rescaling are covered.

Existing reinvestment, shortage-convergence, fiscal-ratchet, bill selection and
government persistence tests pass. Targeted lint passes. Full repository gates
are recorded separately when complete.

## Full-world comparison required before merge

Compare two fresh isolated `1991-default` worlds, identical RNG seed
`macro3709_1991_ab`, 240 turns each. Control source is
`57b7e520563e37428c8b0d9e5079cee1c1f56f57`.
Treatment source must be an immutable commit of this branch; record the exact
pin in the run receipt. Use plants, full labour and v5 autonomy in both worlds,
with identical explicit coverage, fragile-supply, sourcing and liquidity flags.
Keep separate sandbox databases despite the shared RNG seed. No production clone
or production mutation is needed. Jobs use the overnight admission window.

Estimate: two full-world runs can take many hours; allow 12 hours after first
admission. Stop and diagnose any terminal error, phase invariant failure,
nonfinite balances or prices, or sustained failure to advance. Do not rerun a
failed world without a stated cause and changed input.

Compare demand met, real commodity prices and outliers, completed capacity,
utilization, corporate margins/losses/cash, country primary and total balances,
interest, debt, inflation, GDP growth and unemployment at turns 48, 96, 144, 192
and 240. Treatment must improve the persistent shortage trajectory, preserve
accounting and cash invariants, and avoid a broad abrupt loss/insolvency wave or
recession attributable to indiscriminate restraint. These are relative outcome
checks, not a mandate to make every country's historically dated opening budget
balance. Mixed national currencies must be normalized before aggregation.

Review the resulting data and failures before signing an accepted report. A
completed job alone is not a pass. If results are mixed, narrow or retune the
candidate and rerun matching sources rather than deploying all three changes.

## Production observation after qualification and deployment

Use deployment plus 12, 24 and 48 turns as review points. Supply should increase
and shortage premiums should ease gradually. Narrower effortless margins should
come from better supplier competition, not a blanket profit cut. Monitor player
loss frequency and entry, and distinguish primary deficits from interest bills.
