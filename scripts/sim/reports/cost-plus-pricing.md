# Cost-plus price scenarios

Reproduce with `npx tsx scripts/sim/costPlusPriceModel.ts`. Standard manufacturing uses the production recipe input share, existing 1991 labour intensity, explicit overhead and clearing quote rules. This normalized model assumes full production, no tech, freight, growth, inventory carry or policy credit. It is not a seeded world simulation.

The offer is the nominal output price plus the recipe's material price delta, then the player's bounded adjustment. Input ratios use the physical P&L realization curve and its 1.5 ceiling. Output scarcity never multiplies the indexed offer again.

| Input ratio | Adjustment | Fill | Offered price factor | Profit per nominal unit | Net margin |
| ----------: | ---------: | ---: | -------------------: | ----------------------: | ---------: |
|           1 |         0% | 100% |               1.0000 |                  0.0920 |      9.20% |
|           1 |         0% |  50% |               1.0000 |                 -0.4080 |    -81.60% |
|           1 |        10% | 100% |               1.1000 |                  0.1920 |     17.45% |
|           1 |        10% |  50% |               1.1000 |                 -0.3580 |    -65.09% |
|        2.25 |         0% | 100% |               1.3350 |                  0.0920 |      6.89% |
|        2.25 |         0% |  50% |               1.3350 |                 -0.5755 |    -86.22% |
|        2.25 |        10% | 100% |               1.4685 |                  0.2255 |     15.36% |
|        2.25 |        10% |  50% |               1.4685 |                 -0.5088 |    -69.29% |
|          10 |         0% | 100% |               1.3350 |                  0.0920 |      6.89% |
|          10 |         0% |  50% |               1.3350 |                 -0.5755 |    -86.22% |
|          10 |        10% | 100% |               1.4685 |                  0.2255 |     15.36% |
|          10 |        10% |  50% |               1.4685 |                 -0.5088 |    -69.29% |

At zero adjustment and full fill, the indexed offer preserves the manufacturing plant's 0.092 operating surplus per nominal unit under material inflation. Margins fall as nominal sales rise. The 10% adjustment is a pricing choice, not a guaranteed margin: cheaper sellers fill first, and 50% fill makes the plant lose money in every scenario. Ratios above 2.25 produce no further price compounding.

Focused clearing tests verify quote ranking, received price, bounded input pass-through and actual price feedback to loyalty. Command tests verify feature gating and CEO ownership. Activation uses the owner-selected production rollout validation.
