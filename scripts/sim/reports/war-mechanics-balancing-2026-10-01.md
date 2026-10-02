# War mechanics balance report, 2026-10-01

## Scope

This report qualifies the combat-severity and reserve-role changes on branch
`fix/war-mechanics-balancing`, based on development commit `163fec66518d`.
The replay used the active `war_ru_dd_1256` conflict and its current formations.
No player or character data was read or retained.

Command:

```powershell
$env:SIM_THEATER='war_ru_dd_1256'
$env:SIM_TRIALS='2000'
npx tsx scripts/sim/combatOddsCalibration2026-08-29.ts
```

## Result

The active front contained 31 Russian formations against 24 East German and
British formations. The revised forecast gave Russia 51.1% offensive odds.

| Measure                    | Audit baseline | Revised |
| -------------------------- | -------------: | ------: |
| Attacker win rate          |          53.6% |   53.1% |
| Decisive victory           |          20.8% |    2.7% |
| Victory                    |          23.5% |   36.0% |
| Pyrrhic victory            |           9.3% |   14.3% |
| Costly defeat              |          19.8% |   32.7% |
| Rout                       |          26.7% |   14.2% |
| Decisive victory plus rout |          47.5% |   16.9% |

The revised arm averaged 3,985 Russian and 4,445 defending casualties per
battle. Retreats occurred in 55.0% of trials.

## Calibration sweep

The outcome spread remained 0.50. The ratio used by the attrition exchange is
now capped at 0.18 from parity, separating outcome probability from severity.
Across projected odds between 20.2% and 87.7%, the largest observed error was
2.5 percentage points at 2,000 trials. Representative cells were:

| Projected | Realized |
| --------: | -------: |
|     20.2% |    22.0% |
|     35.2% |    37.6% |
|     46.1% |    48.1% |
|     51.1% |    53.1% |
|     70.6% |    71.3% |
|     78.6% |    78.8% |
|     84.4% |    83.7% |
|     87.7% |    86.1% |

The standard error at 2,000 trials is approximately 1.1 percentage points per
cell. Tail compression remained visible outside the central range.

## Decision

Keep the 0.50 outcome spread and introduce the 0.18 severity cap. This retains
the displayed-odds calibration while reducing extreme verdicts in a near-parity
live battle. Apply reserve leverage to both sides, so identical reserve shares
cancel and only a relative reserve advantage changes the forecast.
