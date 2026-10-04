# Cost-plus price scenarios

Reproduce with `npx tsx scripts/sim/costPlusPriceModel.ts`. This normalized manufacturing scenario uses the production recipe, 1991 payroll intensity, explicit overhead and clearing quote rule. The live adapter records actual operating costs per produced nominal output value on a producing turn, then updates the material share by the current input basket index. Taxes, finance, investment, policy credits and inventory carry do not set the product quote.

Zero markup quotes estimated operating break-even at full fill. Unsold output still costs money. Input ratios use the same physical P&L price curve, capped at 1.5. Output scarcity does not multiply the cost-based offer again. The report is a deterministic rules model, not a seeded world simulation.

| Input ratio | Markup | Fill | Offered price factor | Profit per nominal unit | Net margin |
| ----------: | -----: | ---: | -------------------: | ----------------------: | ---------: |
|           1 |     0% | 100% |               0.9080 |                  0.0000 |      0.00% |
|           1 |     0% |  50% |               0.9080 |                 -0.4540 |   -100.00% |
|           1 |    10% | 100% |               0.9988 |                  0.0908 |      9.09% |
|           1 |    10% |  50% |               0.9988 |                 -0.4086 |    -81.82% |
|        2.25 |     0% | 100% |               1.2430 |                  0.0000 |      0.00% |
|        2.25 |     0% |  50% |               1.2430 |                 -0.6215 |   -100.00% |
|        2.25 |    10% | 100% |               1.3673 |                  0.1243 |      9.09% |
|        2.25 |    10% |  50% |               1.3673 |                 -0.5594 |    -81.82% |
|          10 |     0% | 100% |               1.2430 |                  0.0000 |      0.00% |
|          10 |     0% |  50% |               1.2430 |                 -0.6215 |   -100.00% |
|          10 |    10% | 100% |               1.3673 |                  0.1243 |      9.09% |
|          10 |    10% |  50% |               1.3673 |                 -0.5594 |    -81.82% |

A 10% markup on costs gives a 9.09% margin at full fill. At half fill every modeled plant loses money. Quotes use the previous producing turn's cost basis, so changing wages, technology or utilization can change the eventual margin; it is an estimate, not a profit guarantee. Fresh plants require a producing turn before choosing cost-plus. Legacy/flag-off worlds do not read the stored pricing mode or cost basis.
