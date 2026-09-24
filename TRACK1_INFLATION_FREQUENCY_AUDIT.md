# Inflation time-unit audit for #2337

Source: `origin/development` at `028cb9265e76555efa5d73b611cea0f409c3446b`
plus the `src/lib/budget/inflation.ts` comment and
`src/lib/budget/inflation.test.ts` calibration test in this PR. No production
formula or parameter changed.

`TURNS_PER_YEAR` is 48. The ordinary per-turn inflation change limit is 1.5
percentage points (pp) of the **annualized inflation rate**. Its arithmetic
same-direction envelope is 1.5 pp after one turn, 18 pp after 12 turns, 72 pp
after 48 turns, and 360 pp after 240 turns. These are cap-permitted sums, not
forecasts. The model's smoothing, mean reversion, and absolute rate bounds
usually stop movement sooner. The special deep-deflation recovery path can
allow a larger upward correction in one turn, so this envelope describes the
ordinary path only.

The deterministic test repeats fixed inputs through `calculateInflation`,
feeding each turn's resulting rate back as `previousInflation`. All cells below
are **annualized inflation rates in percent**, not cumulative price-level
changes. The rate cut is 3% to 1%, output growth is 2% to 5%, depreciation
pressure is 0 to 0.1, and the carryover scenario starts at 8% with neutral
drivers. The combined scenario applies the rate, output, and FX changes at
once. No monetary-rate history is supplied, so the rule uses its spot-rate
fallback consistently at every turn.

| Fixed scenario                          | Turn 1 | Turn 12 | Turn 48 (1 year) | Turn 240 (5 years) |
| --------------------------------------- | -----: | ------: | ---------------: | -----------------: |
| Neutral drivers, 8% inflation carryover |  6.50% |   2.00% |            2.00% |              2.00% |
| 1% prime rate                           |  2.48% |   2.70% |            2.70% |              2.70% |
| 5% GDP growth                           |  2.36% |   2.53% |            2.53% |              2.53% |
| 0.1 FX depreciation pressure            |  2.48% |   2.70% |            2.70% |              2.70% |
| Combined rate, output, FX               |  3.32% |   3.94% |            3.94% |              3.94% |

The focused test also applies an extreme fixed policy pressure for 48 turns
from a 2% rate. It reaches 74%, exactly 72 pp higher, demonstrating the cap
envelope when the ordinary limit binds throughout. This extreme case is not a
plausible macroeconomic scenario.

Adjacent time-unit comments checked: `src/lib/turn/inflationRecalc.ts` uses
`TURNS_PER_YEAR / 2` for its stated half-year commodity lookback, and
`src/lib/currency/rateCalculation.ts` says 5% gap closure per turn is about a
year to 90% closure; `1 - 0.95^48` is approximately 91.5%. No other verified
time-unit mismatch was found in those adjacent comments. This narrow audit
does not certify every coefficient in the wider macro system.

Evidence: `./node_modules/.bin/vitest run src/lib/budget/inflation.test.ts`
passed 77 tests on 2026-09-25. The final validation pass must re-run it on the
release SHA; this report does not waive any balance/worldsim gate.
