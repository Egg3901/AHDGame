# Issue #2280 SCOTUS tenure calibration

Date: 2026-09-21

Command:

```bash
npx tsx scripts/sim/scotusTenureCalibration2026-09-21.ts
```

The deterministic simulation sampled 100,000 post-grace justice tenures for
the old 1.5% per-turn hazard and the proposed hazard derived from a 720-turn
(15 game-year) median. The simulation horizon was 4,800 turns.

| Calibration                    | Annual departure | Five-year survival | Simulated median |
| ------------------------------ | ---------------: | -----------------: | ---------------: |
| Old, 0.015 per turn            |          51.645% |             2.643% |         46 turns |
| Proposed, 0.000962241 per turn |           4.520% |            79.494% |        724 turns |

The proposed theoretical annual departure probability is 4.5158%. The
simulated median is within four turns of the 720-turn target, and approximately
79.5% of justices survive at least five active years after the grace period.
This removes the near-annual churn while retaining meaningful turnover in a
long-running game.
