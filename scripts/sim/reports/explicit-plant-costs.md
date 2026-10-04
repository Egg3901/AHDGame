# Explicit plant cost scenarios

Run `npx tsx scripts/sim/plantCostModel.ts` to reproduce. This uses the production input-price, labour-intensity, overhead and P&L rules. The normalized nominal basket is 24,000 per day, full production, 1991 labour intensity, no tech, no policy credit, no compliance/growth bill and no idle capacity. Only strategies available in 1991 without a tech unlock are included. This is a deterministic cost model, not a seeded world qualification.

Overhead is 4% of the era-priced nominal basket for output actually produced. Payroll is the existing 1991 labour share on active capacity, paid even when output cannot sell. Recipe efficiency scales purchased input units once. The named costs do not solve from target profit.

| Sector              | Strategy                  | Base margin | Input inflation | 12% input efficiency | Recession |
| ------------------- | ------------------------- | ----------: | --------------: | -------------------: | --------: |
| manufacturing       | standard                  |        9.2% |          -24.3% |               17.24% |   -44.13% |
| manufacturing       | heavy_metals              |        6.2% |          -28.8% |                14.6% |   -48.89% |
| manufacturing       | electronics_manufacturing |       11.2% |          -21.3% |                  19% |   -40.95% |
| automobiles         | standard                  |        8.4% |          -26.6% |                16.8% |    -45.4% |
| automobiles         | heavy_machinery           |        4.4% |          -32.6% |               13.28% |   -51.75% |
| chemical_industries | standard                  |       26.5% |              0% |               32.86% |   -16.67% |
| chemical_industries | fertilizers               |       28.5% |              3% |               34.62% |   -13.49% |
| chemical_industries | pharmaceuticals           |       14.5% |            -18% |                22.3% |   -35.71% |
| chemical_industries | plastics                  |       18.5% |            -12% |               25.82% |   -29.37% |
| defense             | standard                  |       -3.4% |          -39.9% |                5.36% |   -64.13% |
| defense             | heavy_armor               |        1.6% |          -32.4% |                9.76% |   -56.19% |
| defense             | munitions                 |       -3.4% |          -39.9% |                5.36% |   -64.13% |
| defense             | naval_systems             |        0.6% |          -33.9% |                8.88% |   -57.78% |
| defense             | missile_systems           |        1.6% |          -32.4% |                9.76% |   -56.19% |
| defense             | aerospace                 |       19.6% |           -5.4% |                25.6% |   -27.62% |

Median manufacturing base margin: 9.20%. Input inflation sets all input ratios to 2.25, which the existing realization rule bills at 1.5 times base. Recession sells 70% of output at 90% of base price; unsold production still incurs input and payroll bills. These scenarios deliberately do not guarantee profit or a sale.

The base manufacturing result fits the 8 to 15% target in this normalized setting. Other manufacturing-family strategies differ, and the table exposes loss-making recipes rather than hiding them with a negative residual. This report does not establish the median seeded plant result: host-state wages, tech, utilization, inventory, policies, freight, taxes and financing need integrated reset qualification. The setting remains off by default pending production rollout validation and cost-plus pricing qualification.
