# Issue #2323: fixed FX depreciation and annual inflation

## Result

This deterministic production-formula replay reproduces the level-versus-rate defect and verifies finite FX pass-through. With neutral non-FX drivers, a one-time 25% depreciation held fixed leaves the legacy annual CPI rate at 3.76% through turn 48. The revised history rule returns it to 2.00% after the depreciation exits the 12-turn window. A gradual depreciation that stops after turn 24 also loses its FX pressure by turn 36; its CPI rate is 2.03% then and 2.00% at turn 48.

## Method

Run `npx tsx scripts/sim/issue2323FxInflation.ts` to reproduce the table and assertions. Each case runs the production `calculateInflationWithBreakdown` formula for 48 turns, using the production `TURNS_PER_YEAR` value of 48. The synthetic economy holds unemployment, output growth, policy, fiscal, tariff, wage, commodity, savings, housing, and money-supply inputs at neutral values. It compares:

- **Baseline:** no FX impulse.
- **Legacy:** current exchange-rate level divided by the initial rate, minus one, clamped to the existing ±0.25 pressure bound.
- **History treatment:** the production FX rule, annualizing the rate change across dated settled observations at least 12 turns apart and applying the same ±0.25 bound.

The opening history is seeded at the initial rate for one complete 12-turn window. The fixed depreciation changes the rate from 1.00 to 1.25 at turn 1 and holds it there. The gradual path compounds a 0.2% per-turn depreciation for 24 turns, then holds the rate flat. The appreciation path changes the rate from 1.00 to 0.80 at turn 1 and holds it there. Reported inflation values are annual CPI rates in percent, sampled on the listed game turns, not cumulative price-level changes.

## Sampled annual CPI rates

| Scenario                                              |                 Turns |                   No-FX baseline |                Legacy fixed-base |                History treatment |
| ----------------------------------------------------- | --------------------: | -------------------------------: | -------------------------------: | -------------------------------: |
| Flat rate                                             | 1 / 12 / 24 / 36 / 48 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 |
| Fixed 25% depreciation                                | 1 / 12 / 24 / 36 / 48 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 | 3.20 / 3.76 / 3.76 / 3.76 / 3.76 | 3.20 / 3.76 / 2.00 / 2.00 / 2.00 |
| 0.2% per-turn depreciation through turn 24, then flat | 1 / 12 / 24 / 36 / 48 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 | 2.01 / 2.16 / 2.34 / 2.34 / 2.34 | 2.04 / 2.68 / 2.71 / 2.03 / 2.00 |
| Fixed 20% appreciation                                | 1 / 12 / 24 / 36 / 48 | 2.00 / 2.00 / 2.00 / 2.00 / 2.00 | 1.52 / 1.39 / 1.39 / 1.39 / 1.39 | 1.40 / 1.26 / 2.00 / 2.00 / 2.00 |

On the gradual path, FX pressure rises from 0.008024 at turn 1 to 0.100654 by turn 12, stays at 0.100654 through turn 24, and is zero at turn 36, twelve turns after the rate stops moving. Fixed appreciation also produces negative pressure during the window and zero after it clears.

## Limits

This harness verifies the production inflation calculation and FX signal in a controlled neutral economy. It is not a database-backed turn replay, integrated-world calibration, multi-country test, or worldsim report. It does not establish that the 12-turn pass-through window is behaviorally optimal across eras or economies; that balance qualification remains open.
