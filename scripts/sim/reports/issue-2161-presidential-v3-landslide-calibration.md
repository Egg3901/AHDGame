# Issue #2161: presidential v3 landslide calibration

Date: 2026-09-27
Issue: <https://github.com/Egg3901/AHDGame/issues/2161>

## Question

Measure the approved presidential-general corrections without resetting National Influence,
favorability, state organization, or ballots already cast:

- cap the campaign-strength vote bonus at +25% instead of +100%;
- remove the explicit post-distribution partisan-lean multiplier because the distribution
  substrate already prices state partisanship;
- move 5% of newly cast closing-period ballots from locally nonviable candidates to the
  ideologically nearest member of that unit's prior top two; and
- blend national and state approval 50/50 for the presidential incumbency signal.

The active election is ruleset v3, so the corrections are v3 behavior and apply prospectively.

## Method

`scripts/sim/presidential-v3-landslide-calibration.ts` ran the real production presidential
accumulator in read-only dry-run mode against the live turn-1192 inputs. Each arm held every
existing ballot fixed and changed only the next turn. The baseline restored the four legacy
post-processing values; four individual arms changed one value; the combined arm used the
current v3 package. Output contains aggregate party shares and electoral votes only.

The replay was run with `MONGODB_URI_LIVE`. It issued no writes. Party labels are resolved from
reference party rows; no player or character data is included in this report.

## Active-election replay

| Scenario                  | National cumulative after turn                 | Next-turn vote                                 | Electoral votes                | Unit flips vs legacy | Units within 5 points |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------------------ | -------------------: | --------------------: |
| Legacy v3 behavior        | GOP 39.71%, DEM 27.48%, FLP 15.54%, CUP 17.27% | GOP 38.54%, DEM 21.96%, FLP 16.65%, CUP 22.85% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |
| Campaign cap only         | GOP 39.71%, DEM 27.50%, FLP 15.55%, CUP 17.24% | GOP 37.20%, DEM 21.20%, FLP 19.02%, CUP 22.57% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |
| Lean deduplication only   | GOP 39.71%, DEM 27.49%, FLP 15.54%, CUP 17.26% | GOP 38.51%, DEM 22.18%, FLP 16.92%, CUP 22.39% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |
| 5% tactical movement only | GOP 39.72%, DEM 27.48%, FLP 15.53%, CUP 17.27% | GOP 39.26%, DEM 21.71%, FLP 16.01%, CUP 23.02% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |
| 50/50 approval blend only | GOP 39.71%, DEM 27.48%, FLP 15.54%, CUP 17.27% | GOP 38.59%, DEM 21.85%, FLP 16.68%, CUP 22.88% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |
| Combined current v3       | GOP 39.71%, DEM 27.50%, FLP 15.55%, CUP 17.24% | GOP 37.89%, DEM 21.11%, FLP 18.63%, CUP 22.37% | GOP 481, DEM 20, FLP 3, CUP 34 |                    0 |                    12 |

## Interpretation

- The current electoral map is already too settled for one prospective turn to change an EV
  winner. That is expected and confirms that the implementation does not confiscate or rewrite
  prior votes.
- The campaign cap is the largest individual correction in this snapshot. It cuts the GOP's
  next-turn share by 1.34 points and raises the under-strength FLP by 2.37 points relative to the
  legacy arm.
- Removing the duplicate lean multiplier is modest nationally, as intended. Its value is
  geographic: it stops a second partisan adjustment after the state-aware distribution has
  already run.
- Tactical voting moves only 5% of new ballots from candidates outside the local prior top two.
  It can help any locally viable candidate, including a third party, and therefore is not a
  hard-coded major-party subsidy. In this snapshot it moves less than one national point.
- The approval blend is deliberately small nationally. It differentiates state results while
  retaining half of the president's national name and governing signal.
- The combined arm changes only future vote flow. National Influence, favorability, state
  organization, campaign strength balances, and accumulated vote documents remain intact.

## Invariants and edge cases

Automated coverage verifies that tactical movement:

- is disabled before the closing ramp and in two-candidate races;
- uses prior state or district results, never national polling, to determine viability;
- can recognize a third party as locally top-two;
- never changes ballots already cast;
- conserves the turn's ballot total exactly; and
- resolves ideological ties deterministically.

The approval blend clamps its configured state weight and falls back to the available source if
either national or state approval is missing. Legacy v1/v2 rules retain their old values.

## Migration assessment

No migration is required. The active election is already stamped `rulesetVersion: 3`; code reads
the updated v3 values on subsequent turns. Existing tallies and player-built stats are not
modified.
