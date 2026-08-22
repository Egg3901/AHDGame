# Ticket #1168 balance report

Run on 2026-08-22 with:

```text
npx tsx scripts/sim/ticket1168CompositeBalance.ts
```

The harness is deterministic and uses production East Germany's FY1959 fiscal
snapshot plus the real sovereign interest-rate ladder. It also calls the real
NPP bill selector. It does not write to a database.

## Borrowing limit

Production input:

| Input                  |    Value |
| ---------------------- | -------: |
| Smoothed GDP           | M54.109B |
| Debt principal         |  M7.352B |
| Annual primary deficit |  M2.012B |
| Current GDP growth     |  -1.015% |
| Existing stored limit  | M10.000B |
| Existing limit / GDP   |    18.5% |
| Existing debt / limit  |    73.5% |

The old fixed limit is crossed during FY1960, less than one fiscal year from
the snapshot. A 40%-of-GDP floor starts at M21.643B and is crossed during
FY1963 under the deliberately conservative assumption that the current primary
deficit, recession, and sovereign pricing continue unchanged.

|   FY |    Debt | Effective rate | Old limit use | New limit use |
| ---: | ------: | -------------: | ------------: | ------------: |
| 1959 |  M7.35B |         11.43% |         73.5% |         34.0% |
| 1960 | M10.56B |         16.00% |        105.6% |         49.3% |
| 1961 | M14.57B |         16.00% |        145.7% |         68.7% |
| 1962 | M19.27B |         16.00% |        192.7% |         91.8% |
| 1963 | M24.78B |         16.00% |        247.8% |        119.3% |

Decision: use a 40% floor for East Germany, retain any higher stored limit,
and leave every other country's statutory value unchanged. This grants about
three years of runway under today's adverse path. It does not remove fiscal
discipline: the risk ladder reprices East German debt from 11.43% to 16% before
the new limit is reached, and debt-to-GDP penalties continue independently.
The seed moves from M10B to M20B so fresh worlds match the runtime rule.

## Repeated NPP bills

The conservative selector scenario provides six equally scored bill types and
offers sponsorship every 12 turns. Without a type guard, the deterministic
selector chooses type `a` ten times in a row. With a 96-turn per-party type
cooldown, it chooses `a`, `b`, `c`, `d`, `e`, and `f` before pausing rather than
repeating. Type `a` becomes selectable again at turn 108, the first sponsorship
opportunity after its 96-turn exclusion expires.

Decision: retain the 96-turn per-party repeat cooldown. It removes the exact
failure mode observed in production, where each East German party proposed its
same top-scoring failed bill five times. In a deliberately tiny six-type catalog
it can pause sponsorship for three opportunities, which is preferable to spam;
the live country catalog has more candidates.
