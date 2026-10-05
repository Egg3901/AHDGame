# Issue #3322 household price index annual passthrough

Run from the project root with `npx tsx scripts/sim/householdPriceIndexPassthrough3322.ts`. The harness drives the production `advanceHouseholdPriceIndex` one turn at a time, feeding each output back as the next input, for whole years of constant and varying annual CPI. It uses no database, world, worldsim or randomness. The legacy column reproduces the replaced formula (annual rate times passthrough, divided by 48, compounded every turn) for comparison only; its 8%, 100% and 480% rows match the read-only probe of the deployed function cited in the issue.

## Contract

Annual CPI is an arithmetic year-over-year rate. Households absorb 75% of it, so a year held at `x`% moves the index by exactly `1 + 0.75 * x / 100`. Each turn applies the 48th root of that annual factor. When CPI changes between turns, each turn contributes its own share, so a year lands on the geometric mean of the observed annual factors and the order of observations does not matter. Missing or non-finite CPI is a zero change. CPI below -100% is clamped to -100%, so the turn factor stays strictly positive (a year at the floor gives 0.25). The index never writes a zero, negative or non-finite level; nominal balances are untouched and `householdPriceAdjustedValue` is unchanged.

## Constant annual CPI, one year from index 1

| Annual CPI | Documented annual factor | Legacy after one year | Fixed after one year |
| ---------: | -----------------------: | --------------------: | -------------------: |
|       -10% |                 0.925000 |              0.927689 |             0.925000 |
|        -2% |                 0.985000 |              0.985110 |             0.985000 |
|         0% |                 1.000000 |              1.000000 |             1.000000 |
|         2% |                 1.015000 |              1.015111 |             1.015000 |
|         8% |                 1.060000 |              1.061797 |             1.060000 |
|        25% |                 1.187500 |              1.205790 |             1.187500 |
|       100% |                 1.750000 |              2.104759 |             1.750000 |
|       480% |                 4.600000 |             32.181500 |             4.600000 |

## Varying annual CPI

| Varying path                          | Geometric-mean target |   Legacy |    Fixed |
| ------------------------------------- | --------------------: | -------: | -------: |
| 24 turns at 8%, then 24 at 100%       |              1.361984 | 1.494934 | 1.361984 |
| 24 turns at 100%, then 24 at 8%       |              1.361984 | 1.494934 | 1.361984 |
| linear glide 480% to 8% over one year |              2.616548 | 5.962263 | 2.616548 |
| two years at 8%                       |              1.123600 | 1.127412 | 1.123600 |

## Effect

At ordinary CPI the change is small: at 8% the legacy index overshot the documented 1.06 by 0.0018 per year, and at -2% it slightly under-deflated. At elevated but supported CPI the overshoot was large: 100% CPI produced 2.10 instead of 1.75, and an opening-seed level like 480% produced 32.2 instead of 4.6. The fix lowers the displayed price level growth and therefore raises the launch-price purchasing power shown through `householdPriceAdjustedValue`, most visibly in high-inflation countries. The index feeds only the real-economy outlook display and the sim `inflationIndex` metric: nothing in CPI, fiscal or wage calculation reads it, so no nominal balance or turn mechanic moves.

Existing live index values already accumulated under the legacy formula. This change does not repair them; any one-off restatement is a separate operator decision tracked on the issue, not part of the source change.
