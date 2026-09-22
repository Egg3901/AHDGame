# Cabinet residual soft saturation (issue #703)

Run from the repository with:

```sh
npx tsx scripts/sim/cabinetResidualSaturation2026-09-17.ts
```

Deterministic: pure rules functions only (`foldCabinetResiduals`,
`foldCabinetResidualsBySource`, `seedBySourceFromLegacy`,
`sumCabinetResiduals`). No database, no randomness, no wall clock, no
worldsim, no live data. Every invariant below is asserted by the script; a
violation throws instead of printing.

## A. Steady state by contribution rate

| contribution/turn | old hard clamp | soft saturation |
| ----------------- | -------------- | --------------- |
| 0.2               | 2.0            | 1.9751          |
| 0.4               | 4.0            | 3.7474          |
| 0.8               | 8.0            | 6.0624          |
| 0.9               | 8.0            | 6.4025          |
| 1.8               | 8.0            | 7.6133          |
| 3.6               | 8.0            | 7.9263          |
| 8                 | 8.0            | 7.9895          |

The old shape gives 4.0 once and then 8.0 six times over: any channel at or
above 0.8/turn saturates and further investment buys exactly zero. The new
shape is strictly increasing across the full range and stays below the
asymptote of 8 even at 8/turn. Small pushes are near-identity (0.2/turn holds
1.98 vs the old 2.0), so unsaturated channels behave as before.

## B. One-step marginal gain of a +0.5 push, by starting level

| level | marginal gain |
| ----- | ------------- |
| 0     | 0.4998        |
| 1     | 0.4944        |
| 3     | 0.4433        |
| 5     | 0.3166        |
| 7     | 0.1047        |

The marginal effect is strictly positive at every level (more investment
always buys more residual) and diminishing (a push high on the curve buys
less than the same push low down). Even at level 7 of a cap-8 channel, +0.5
still buys +0.10.

## C. Eight Tier-2 field-office regions (condition spread)

A Tier-2 `field_office` at enhanced funding contributes 0.9/turn at condition
90; eight regions spread over conditions 80-95:

| condition | contribution/turn | old | soft   |
| --------- | ----------------- | --- | ------ |
| 80        | 0.8000            | 8.0 | 6.0624 |
| 82        | 0.8200            | 8.0 | 6.1366 |
| 85        | 0.8500            | 8.0 | 6.2418 |
| 87        | 0.8700            | 8.0 | 6.3082 |
| 90        | 0.9000            | 8.0 | 6.4025 |
| 92        | 0.9200            | 8.0 | 6.4619 |
| 94        | 0.9400            | 8.0 | 6.5187 |
| 95        | 0.9500            | 8.0 | 6.5462 |

Old: all eight pin at exactly 8.0 and render identical metrics (the "all
states are extremely similar" half of the player report). New: eight distinct
values spanning 0.48 points, every adjacent pair more than 0.01 apart, so
regional differences survive saturation.

## D. Multi-source stacking

Orders driven at 5/turn settle at 7.967 alone; adding an estate at 1.5/turn
lifts the applied total to 9.458, with the fresh estate landing at just under
face value in its own channel. Source separation is preserved: a saturated
channel cannot silence another.

## E. Decay stability

A legacy hard pin of 8 with no contribution drains monotonically and washes
out below 0.1 within 100 turns (stored values quantize to 4dp and drop below
0.01, so strict decrease holds while above the storage floor). A small
residual of 1 fades monotonically below 0.1 within 40 turns, on the old
~20-turn schedule. No oscillation, no increase while draining.

## F. Migration of already hard-pinned values

A doc pinned at 8 with a standing 0.9/turn estate contribution reads 7.9874
on the first turn after the change (a move of 0.013, no player-visible
lurch), then converges over 500 turns to 6.4034, within 0.001 of the soft
steady state for 0.9/turn (6.4025). Hard-pinned values ease onto the curve
from above rather than collapsing.

## Balance reading

The cap value is unchanged (8 per source, 48 total ceiling vs ~62 for a fully
stacked law book), so the channel stays under laws. What changes is shape,
not strength: unsaturated channels read within a few percent of before
(0.4/turn: 3.75 vs 4.0), while saturated channels trade the pin for a curve
that keeps every further investment meaningful. Observed prod maximum after
the per-source split is about 16 total, far from the ceiling, so the
practical effect is differentiation between regions, not inflation of totals.
