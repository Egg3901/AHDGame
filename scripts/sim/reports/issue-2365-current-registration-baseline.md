# Issues #2365 and #2367 UK election balance simulation report

Date: 2026-09-24
Harness: `scripts/sim/issue2365CurrentRegistrationBaseline.ts`
Issues: `Egg3901/AHDGame#2365`, `Egg3901/AHDGame#2367`
Scope: UK Commons general elections

## Why this report exists

UK election vote weights previously used a permanent seed-time
`registrationShare` baseline. A party created after world bootstrap has no such
value and receives the neutral `1.0` multiplier, while seeded parties usually
receive a multiplier below `1.0`. This report estimates the effect of replacing
that seed-time input with every party's current regional `registration` and
lowering the party-pooled Commons seat threshold from 20% to 10%.

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
Reg. The harness then normalizes regional shares and runs the production 10%
Commons party threshold plus largest-remainder seat allocator. The observed
seat column remains the live result under the old baseline and 20% threshold;
the corrected column applies both changes together.

This is a deterministic counterfactual, not a forecast. Swing-flow transfers,
future campaigning, favorability, influence, turnout, support, and voter-group
movement can change later slices. The ratio method isolates the registration
baseline defect but cannot replay candidate-level swing flows exactly. Existing
votes are not rewritten by the code change.

## National result

| Party | Current share | Corrected counterfactual | Change | Current seats | Corrected seats | Change |
| ----- | ------------: | -----------------------: | -----: | ------------: | --------------: | -----: |
| LAB   |        28.85% |                   41.67% | +12.82 |           225 |             290 |    +65 |
| CON   |        16.39% |                   19.50% |  +3.11 |            41 |             115 |    +74 |
| LD    |        23.19% |                   19.88% |  -3.31 |           124 |             114 |    -10 |
| TRP   |        25.49% |                   14.87% | -10.62 |           186 |              87 |    -99 |
| WPGB  |         6.08% |                    4.08% |  -2.00 |            49 |              19 |    -30 |

Labour's national lead over The Revival Party changes from 3.36 points and 39
seats to 26.80 points and 203 seats in this frozen-factor counterfactual. The
10% gate still excludes very small regional shares while avoiding the old cliff
that erased parties between 10% and 20%.

## Labour and Revival by region

| Region | LAB share | Corrected | LAB seats | Corrected |   TRP share |   Corrected | TRP seats | Corrected |
| ------ | --------: | --------: | --------: | --------: | ----------: | ----------: | --------: | --------: |
| EAE    |    33.64% |    46.08% |        19 |        23 |      21.97% |       7.65% |        13 |         0 |
| EMI    |    23.07% |    39.35% |        10 |        15 |      38.93% |      30.28% |        18 |        11 |
| LON    |    27.44% |    39.61% |        51 |        38 |      15.17% |       5.77% |         0 |         0 |
| NEE    |    13.49% |    12.79% |         0 |         4 |      20.29% |      14.72% |         8 |         5 |
| NIR    |     1.93% |    24.31% |         0 |         3 | not fielded | not fielded |         0 |         0 |
| NWE    |    30.62% |    44.14% |        26 |        36 |      22.67% |      15.29% |        19 |        12 |
| SCO    |    46.23% |    58.56% |        34 |        44 |      26.68% |      12.42% |        19 |         9 |
| SEE    |    32.00% |    52.69% |        32 |        51 |      27.04% |       9.08% |        26 |         0 |
| SWE    |    47.80% |    73.09% |        29 |        33 |      22.50% |      11.27% |        14 |         5 |
| WAL    |    25.61% |    35.10% |        11 |        14 |      60.28% |      54.02% |        25 |        22 |
| WMI    |    17.66% |    26.33% |         0 |        14 |      39.20% |      24.89% |        30 |        13 |
| YHU    |    22.47% |    26.51% |        13 |        15 |      23.93% |      17.37% |        14 |        10 |

The corrected rules do not erase legitimate Revival strength. Revival remains
first in Wales at 54.02%, first in the West Midlands at 24.89%, and strongly
competitive in the East Midlands at 30.28%. The 10% gate also preserves
representation for its 11% to 17% shares in five additional regions. The
registration fix removes the hidden multiplier advantage while the lower gate
prevents that correction from turning every medium-sized party into a zero-seat
party.

## Threshold sensitivity

Comparing the observed old rule to the combined counterfactual, twelve
party-region combinations change eligibility. The most important changes are:

- Labour enters the pool in North East England, Northern Ireland, and the West
  Midlands.
- Conservative enters in East Anglia, East Midlands, London, Northern Ireland,
  South West England, and the West Midlands.
- Liberal Democrats enter in London.
- Revival leaves only East Anglia and South East England; it remains eligible
  from 10% to 20% in North East England, North West England, Scotland, South
  West England, and Yorkshire and the Humber.

The remaining discontinuity is substantially smaller than under 20%, so seat
movement tracks the corrected vote shares more closely.

## Compatibility result

- UK regions with current Reg data use that data for all parties.
- A party missing a row in an otherwise populated UK region receives the same
  minimum-share floor as a party at zero Reg, so later creation cannot produce
  a neutral `1.0` advantage.
- An old UK region with no current Reg data at all keeps the lane neutral.
- Non-UK regions never enable this extra baseline, so US and other countries'
  existing Reg resistance and persuasion behavior are unchanged.
- The 10% threshold is selected only for `commons` and `snap_commons`; the US
  `house` threshold remains 20%.

## Conclusion

The corrected baseline materially changes the live Commons balance in the
expected direction. Labour's current registration becomes an asset it can see
and influence, while Revival's lower current registration becomes the cost of
building a newer party. The 10% gate then keeps medium-sized parties represented
in crowded regions. The result is mechanically explainable from live state
rather than from frozen 1951-era registration, a missing-value advantage, and
an unusually high eligibility cliff.
