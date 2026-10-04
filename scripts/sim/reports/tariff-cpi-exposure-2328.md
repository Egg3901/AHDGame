# Issue #2328 delivered tariff CPI sensitivity

Run from the project root with `npx tsx scripts/sim/tariffCpiExposure2328.ts`. This deterministic harness calls the existing `runSourcingPass`, attributes its accepted/delivered household exposure, then feeds the pure result to `calculateInflationWithBreakdown`. It uses no database, worldsim, macro feedback, or fitted elasticity.

All cells use identical non-tariff inflation inputs, total household demand of 100 units, domestic and foreign seller asks of 100, zero freight, and no embargo or FTA. The first column is the available foreign supply share; reported import share is what the actual sourcing allocator delivered. The tariff input preserves the existing 3% no-change baseline on exposed imports:

`3 + 100 * (delivered household duty - 0.03 * delivered household import pre-duty value) / household matched pre-duty absorption value`

The 3% offset is applied to imported value only, so no-import economies remain neutral. A duty equal to 3% of exposed import value preserves the baseline. FTA-zero duty on imports moves below baseline in proportion to exposed imports. Production input duty is reported by the source data contract but is not added to this direct household CPI channel.

| Available foreign supply | Tariff | Delivered import share | Delivered duty | Tariff input | Raw CPI tariff component | Final CPI | Change vs 2.000 baseline |
| ------------------------ | -----: | ---------------------: | -------------: | -----------: | -----------------------: | --------: | -----------------------: |
| 0%                       |     0% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 0%                       |     3% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 0%                       |    20% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 0%                       |    40% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 25%                      |     0% |                  25.0% |              0 |        2.250 |                   -0.019 |     1.990 |                   -0.010 |
| 25%                      |     3% |                  25.0% |             75 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 25%                      |    20% |                  25.0% |            500 |        7.250 |                    0.213 |     2.130 |                    0.130 |
| 25%                      |    40% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 80%                      |     0% |                  80.0% |              0 |        0.600 |                   -0.060 |     1.960 |                   -0.040 |
| 80%                      |     3% |                  80.0% |            240 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 80%                      |    20% |                  80.0% |          1,600 |       16.600 |                    0.680 |     2.410 |                    0.410 |
| 80%                      |    40% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 100%                     |     0% |                 100.0% |              0 |        0.000 |                   -0.075 |     1.960 |                   -0.040 |
| 100%                     |     3% |                 100.0% |            300 |        3.000 |                    0.000 |     2.000 |                    0.000 |
| 100%                     |    20% |                 100.0% |          2,000 |       20.000 |                    0.850 |     2.510 |                    0.510 |
| 100%                     |    40% |                   0.0% |              0 |        3.000 |                    0.000 |     2.000 |                    0.000 |

At 40%, the actual source allocator rejects these otherwise equal-priced imports because the landed price exceeds its willingness-to-pay bound. The neutral exposure result follows delivered purchases, not statutory rate or offered capacity. At 20% and 80% delivered import share, the resulting rate is 16.6 and the raw tariff component is 0.68 points, matching the formula's 13.6 percentage-point excess duty burden over total household absorption and the existing 0.05 CPI coefficient. The final CPI changes by 0.41 after the existing inertia and stabilization logic. This measure is current-turn duty incidence mapped into an inflation-rate signal, not a tariff change or observed price-index transition; a persistent tariff can therefore remain a repeated cost-push signal in this existing model.

This is a bounded accounting and call-path sensitivity, not macro-balance evidence. The current commodity coverage is limited to shipped commodities, household-versus-input attribution is proportional modeled demand allocation, and the coefficient is the existing authored CPI rule rather than a causal estimate. A paired worldsim remains necessary for whole-economy response, substitution, shortages, and resulting CPI.
