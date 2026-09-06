# Output gap bounded integration diagnostic

Run from the repository with:

```sh
npx tsx scripts/sim/check-output-gap-boundaries.ts
```

The diagnostic covers 100 combinations of valid prior gaps (`-15`, `-10`, `0`, `10`, `15`), sector signals from both extrema through neutral, and potential growth from both published extrema through the ordinary `2%` case. Every case checks finite values, both bounds, and the identity `gdpGrowth = boundedPotential + (gap - previousGap) * 48`.

Observed output:

```json
{
  "cases": 100,
  "cappedHigh": 32,
  "cappedLow": 32,
  "maxIdentityError": 0,
  "neutralRecovery": { "turns": 48, "gap": 2.1785239795760494, "gdpGrowth": -1.373198419988725 },
  "invalidInputRebase": { "gap": 0, "gdpGrowth": 0, "impulse": 0 },
  "registryRoundedBoundary": 15,
  "registryRoundingTolerance": 0
}
```

The neutral case starts at a valid `10%` gap with potential and sector both `2%`; the harness asserts monotonic convergence and at least 50% gap closure within 48 turns. Observed closure is about 78%. The registry stores GDP growth at three decimals, so persisted values can differ from the mathematical transition by at most `0.0005` percentage points. Invalid inputs intentionally rebase to finite neutral inputs and use one turn as the safe period.
