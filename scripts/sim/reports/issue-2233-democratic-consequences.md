# Issue 2233 democratic-consequences calibration

Command: `npx tsx scripts/sim/democraticHealthConsequences.ts`

The harness evaluates the portable production rule at representative Democratic
Health scores. The GDP comparison starts both economies at 100, holds healthy
potential growth at 2.5% annually, applies the institutional drag for ten years,
and reports the impaired economy's level relative to the healthy control.

| Health | Ruling party drag | Sitting President drag | Annual GDP growth drag | GDP vs healthy after 10y |
| -----: | ----------------: | ---------------------: | ---------------------: | -----------------------: |
|    100 |             0.00% |                  0.00% |              0.000 pts |                    0.00% |
|     80 |             0.00% |                  0.00% |              0.000 pts |                    0.00% |
|     60 |             0.00% |                  0.00% |              0.000 pts |                    0.00% |
|     50 |             2.33% |                  3.49% |              0.466 pts |                   -4.45% |
|     40 |             5.35% |                  8.03% |              1.070 pts |                   -9.96% |
|     30 |             8.71% |                 13.06% |              1.741 pts |                  -15.75% |
|     20 |            12.29% |                 18.44% |              2.459 pts |                  -21.56% |
|     10 |            16.07% |                 24.10% |              3.214 pts |                  -27.28% |
|      0 |            20.00% |                 30.00% |              4.000 pts |                  -32.84% |

Interpretation: fragile democracy creates a warning-sized cost, while the
failing-democracy band below 40 creates a material electoral and compounding
economic penalty. The curve is continuous, monotonic, capped, and exactly
neutral at 60 or above.
