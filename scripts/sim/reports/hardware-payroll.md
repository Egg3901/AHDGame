# Hardware payroll qualification

Run `npx tsx scripts/sim/hardwarePayroll.ts` to reproduce the synthetic results. The script opens no database and performs no world simulation.

The 324 scenarios cover 1953, 1991 and 2027; hardware, standard and software; wages 1.0, 1.2 and 1.3; two plant sizes; and base, scarcity, input-shock, starved-production, unsold-output and policy-charge conditions. All 1188 accounting assertions pass. Input consumption, overhead and selling prices stay identical between control and treatment. Standard and software P&Ls are byte-identical.

The treatment restores hardware labour intensity to 0.30 from before the service-payroll increase. The control retains 0.40 for every technology method. In 1991 the era multiplier makes these 0.33 and 0.44 of nominal revenue, before the wage multiplier. Payroll is 25% lower for an established hardware plant. Recipe and output quantities are unchanged.

| 1991 method, wage 1.0, base prices | Control margin | Treatment margin |
| ---------------------------------- | -------------: | ---------------: |
| hardware                           |         -3.00% |            8.00% |
| standard                           |         13.00% |           13.00% |
| software                           |         27.00% |           27.00% |

| 1991 hardware, wage 1.2 | Control margin | Treatment margin |
| ----------------------- | -------------: | ---------------: |
| base                    |        -11.80% |            1.40% |
| scarcity                |          8.74% |           17.39% |
| input-shock             |        -66.80% |          -53.60% |
| starved                 |        -15.19% |           -0.78% |
| unsold                  |       -123.60% |          -97.20% |
| policy-charge           |        -31.80% |          -18.60% |

The base scenario sells all production at base prices with no policy credits or charges. Scarcity sets input ratios to 2.25 and output ratios to 2.33, using the production price-realization function on both. Starved production makes 60% of capacity, buys inputs for that production, pays the active workforce and the existing fixed overhead, and sells all produced goods. Unsold output sells half of full production. The policy-charge scenario adds a 20 percentage-point charge. These are sensitivity inputs, not observations or forecasts.

Turn-engine tests additionally exercise fully staffed hardware, standard and software plants through `processSector`. Pure rules tests cover retooling continuity both directions, completed and future-dated transitions, missing metadata and eras. The labour resolver test confirms the wage floor and per-worker reporting retain their scaling, and legacy modes retain their current payroll.

This qualification establishes the narrow cost correction and leaves loss-making stress cases visible. It does not establish global supply/demand feedback, corporate solvency, strike outcomes, returns on new construction or future profitability. It is not a seeded world trajectory or evidence of a live deployment.
