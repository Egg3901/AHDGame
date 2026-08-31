# Issue #952 GDP revenue-signal simulation

Run on 2026-08-27 with:

```text
npx tsx scripts/sim/gdpRevenueSignalNoise.ts
```

The harness is deterministic and calls the production revenue-signal and
output-gap functions. It does not read or write a database. The scenario grows
underlying realized revenue by 4% per year for three years while applying a
repeating settlement-noise sequence from -8% to +17% of the revenue level,
matching the ordinary churn range that exposed the bug.

Statistics below cover the two mature years after the trailing signal has a
full-year baseline.

| Signal       | Mean | Mean absolute error | Clamp hits | Minimum | Maximum |
| ------------ | ---: | ------------------: | ---------: | ------: | ------: |
| One-turn     | 2.50 |               12.50 |      96/96 |  -10.00 |   15.00 |
| Trailing EMA | 4.64 |                0.86 |       0/96 |    2.89 |    6.81 |

The existing estimator loses all magnitude information in this scenario: every
mature sample hits one of the asymmetric signal bounds. The trailing estimator
has no clamp hits and tracks the true 4% trend within 0.86 points mean absolute
error. Its output-gap stock remains bounded near zero, at 0.79 after year two
and 0.43 after year three. The one-turn path ends at -0.81 and -0.86,
respectively, because the clamped alternating samples do not represent the
underlying trend.

An isolated one-turn +10% revenue-level wobble produces a +15% clamped print on
the old path and +1.50% on the trailing EMA path. This meets the acceptance
target that ordinary one-turn noise move the mature signal by less than two
points.

Decision: retain `REVENUE_EMA_ALPHA = 0.15`, the eight-turn snapshot cadence,
seven-snapshot retention, and the eight-turn minimum baseline. They eliminate
the noise amplifier without changing `GAP_CLOSURE`, the output-gap bounds, or
the below-plants signal path.
