# Issue #2365 current-registration baseline simulation report

Date: 2026-09-24
Harness: `scripts/sim/issue2365CurrentRegistrationBaseline.ts`
Issue: `Egg3901/AHDGame#2365`
Scope: UK Commons general elections

## Why this report exists

UK election vote weights currently use a permanent seed-time
`registrationShare` baseline. A party created after world bootstrap has no such
value and receives the neutral `1.0` multiplier, while seeded parties usually
receive a multiplier below `1.0`. This report estimates the effect of replacing
that seed-time input with every party's current regional `registration`.

The live query was read-only and retained only aggregate party-level figures.
No player, character, account, or campaign data is present in the harness or
this report.

## Snapshot and method

The snapshot is UK Commons cycle 5 after its first general-election vote slice:
2,669,254 votes across 12 regions and 625 projected seats. The remaining vote
slices had not yet been counted.

For each party in each region, the harness holds every non-baseline factor
constant and applies the ratio between the corrected and old baseline:

`projected weight = observed vote share * sqrt(current Reg) / sqrt(seed Reg)`

Shares use the production floor of 0.5%. Under the old rule, a missing seeded
share is neutral `1.0`; under the corrected rule, every party uses its current
Reg. The harness then normalizes regional shares and runs the production 20%
party threshold plus largest-remainder seat allocator.

This is a deterministic counterfactual, not a forecast. Swing-flow transfers,
future campaigning, favorability, influence, turnout, support, and voter-group
movement can change later slices. The ratio method isolates the registration
baseline defect but cannot replay candidate-level swing flows exactly. Existing
votes are not rewritten by the code change.

## National result

| Party | Current share | Corrected counterfactual | Change | Current seats | Corrected seats | Change |
| ----- | ------------: | -----------------------: | -----: | ------------: | --------------: | -----: |
| LAB   |        28.85% |                   41.67% | +12.82 |           225 |             337 |   +112 |
| CON   |        16.39% |                   19.50% |  +3.11 |            41 |             116 |    +75 |
| LD    |        23.19% |                   19.88% |  -3.31 |           124 |             113 |    -11 |
| TRP   |        25.49% |                   14.87% | -10.62 |           186 |              51 |   -135 |
| WPGB  |         6.08% |                    4.08% |  -2.00 |            49 |               8 |    -41 |

Labour's national lead over The Revival Party changes from 3.36 points and 39
seats to 26.80 points and 286 seats in this frozen-factor counterfactual. The
large seat movement is amplified by the Commons 20% regional threshold.

## Labour and Revival by region

| Region | LAB share | Corrected | LAB seats | Corrected |   TRP share |   Corrected | TRP seats | Corrected |
| ------ | --------: | --------: | --------: | --------: | ----------: | ----------: | --------: | --------: |
| EAE    |    33.64% |    46.08% |        19 |        28 |      21.97% |       7.65% |        13 |         0 |
| EMI    |    23.07% |    39.35% |        10 |        16 |      38.93% |      30.28% |        18 |        13 |
| LON    |    27.44% |    39.61% |        51 |        53 |      15.17% |       5.77% |         0 |         0 |
| NEE    |    13.49% |    12.79% |         0 |         0 |      20.29% |      14.72% |         8 |         0 |
| NIR    |     1.93% |    24.31% |         0 |         4 | not fielded | not fielded |         0 |         0 |
| NWE    |    30.62% |    44.14% |        26 |        43 |      22.67% |      15.29% |        19 |         0 |
| SCO    |    46.23% |    58.56% |        34 |        50 |      26.68% |      12.42% |        19 |         0 |
| SEE    |    32.00% |    52.69% |        32 |        51 |      27.04% |       9.08% |        26 |         0 |
| SWE    |    47.80% |    73.09% |        29 |        43 |      22.50% |      11.27% |        14 |         0 |
| WAL    |    25.61% |    35.10% |        11 |        14 |      60.28% |      54.02% |        25 |        22 |
| WMI    |    17.66% |    26.33% |         0 |        16 |      39.20% |      24.89% |        30 |        16 |
| YHU    |    22.47% |    26.51% |        13 |        19 |      23.93% |      17.37% |        14 |         0 |

The corrected rule does not erase legitimate Revival strength. Revival remains
first in Wales at 54.02%, first in the West Midlands at 24.89%, and strongly
competitive in the East Midlands at 30.28%. It removes the hidden multiplier
advantage and lets current registration determine how much of that strength is
structurally durable.

## Threshold sensitivity

Sixteen party-region combinations cross the 20% eligibility threshold in the
counterfactual. The most important Labour and Revival flips are:

- Labour enters the pool in Northern Ireland, from 1.93% to 24.31%, and the
  West Midlands, from 17.66% to 26.33%.
- Revival leaves the pool in East Anglia, North East England, North West
  England, Scotland, South East England, South West England, and Yorkshire and
  the Humber.
- Revival stays above threshold in the East Midlands, Wales, and West Midlands.

This discontinuity explains why the projected seat change is much larger than
the popular-vote change.

## Compatibility result

- UK regions with current Reg data use that data for all parties.
- A party missing a row in an otherwise populated UK region receives the same
  minimum-share floor as a party at zero Reg, so later creation cannot produce
  a neutral `1.0` advantage.
- An old UK region with no current Reg data at all keeps the lane neutral.
- Non-UK regions never enable this extra baseline, so US and other countries'
  existing Reg resistance and persuasion behavior are unchanged.

## Conclusion

The corrected baseline materially changes the live Commons balance in the
expected direction. Labour's current registration becomes an asset it can see
and influence, while Revival's lower current registration becomes the cost of
building a newer party. The result is mechanically explainable from live state
rather than from frozen 1951-era registration plus a missing-value advantage.
