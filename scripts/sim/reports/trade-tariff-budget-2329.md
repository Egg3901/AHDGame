# Tariff import-budget sensitivity, issue #2329

This deterministic rules harness exercises the existing tariff lookup, affinity policy, and commodity clearing functions with a fixed pre-duty import budget. It is a scoped balance sensitivity report, not a world simulation.

Each importer has a raw commodity deficit budget. The proposal caps `sum(flow units × (1 + effective route tariff))` at that amount. The model treats the deficit as an authored import-spending budget in untaxed commodity-unit equivalents. It does not model settled cash, freight tolerance, household elasticity, or cross-good substitution. The tariff-inclusive multiplier is an authored route-cost factor. The route multiplier adds the effective tariff rate to the untariffed route cost. USITC Publication 5405 studies tariff price effects in covered U.S. industries ([official report](https://www.usitc.gov/sites/default/files/publications/332/pub5405.pdf)). That evidence motivates including a tariff term in route cost; it does not calibrate this game quantity budget or generalize price pass-through beyond those sectors.

Baseline is the same clearing inputs with 0% tariff. Treatment uses importer tariff rates of 0%, 5%, 20%, 50%, and 100%. Raw importer deficit is 100 units. Seller availability is varied independently. Actual outputs:

Run `npx tsx scripts/sim/tradeTariffBudget2329.ts` to reproduce these rows and assert physical conservation and both supply and spending ceilings. Imported quantities are physical units; weighted import spending is in untaxed commodity-unit equivalents.

| Tariff | Available surplus | Imported units | Weighted import spending |
| -----: | ----------------: | -------------: | -----------------------: |
|     0% |                25 |      25.000000 |                25.000000 |
|     0% |                50 |      50.000000 |                50.000000 |
|     0% |               100 |     100.000000 |               100.000000 |
|     0% |               150 |     100.000000 |               100.000000 |
|     5% |                25 |      25.000000 |                26.250000 |
|     5% |                50 |      50.000000 |                52.500000 |
|     5% |               100 |      95.238095 |               100.000000 |
|     5% |               150 |      95.238095 |               100.000000 |
|    20% |                25 |      25.000000 |                30.000000 |
|    20% |                50 |      50.000000 |                60.000000 |
|    20% |               100 |      83.333333 |               100.000000 |
|    20% |               150 |      83.333333 |               100.000000 |
|    50% |                25 |      25.000000 |                37.500000 |
|    50% |                50 |      50.000000 |                75.000000 |
|    50% |               100 |      66.666667 |               100.000000 |
|    50% |               150 |      66.666667 |               100.000000 |
|   100% |                25 |      25.000000 |                50.000000 |
|   100% |                50 |      50.000000 |               100.000000 |
|   100% |               100 |      50.000000 |               100.000000 |
|   100% |               150 |      50.000000 |               100.000000 |

When seller availability is at least the budget ceiling, imports are 100, 95.238, 83.333, 66.667, and 50 units at those rates; weighted import spending stays at 100. At lower availability, physical seller supply binds before the spending budget. Existing route affinity still differentiates competing suppliers; an untaxed alternate is not assumed to fully restore the missing volume. Existing FTA neutrality returns multiplier 1; embargo blocks and caps remain binding. State-scoped service flows stay local, and their zero-affinity routes do not evaluate the cost callback.

The clearing solver computes each positive-affinity route cost once before its 40 IPF iterations, and the affinity policy shares its tariff lookup with that cost callback. Commodity snapshots and era-world corporate reachable books forward the same route costs from their already loaded policy context. The change adds no database read.

Actual-source validation covers 128 tests across 12 suites, including tariff and FTA policy, alternative suppliers, multiple importers, embargo caps, raw residuals, local-only services, snapshot forwarding, convergence, corporate books, lookup fixtures, the commodity turn and conflict sanctions. The deterministic harness reproduces all 20 rows. Scoped lint and formatting pass; the architecture audit has zero blocking findings and no new warnings from this change. The original sole-supplier reproduction cleared 100 units at a 20% tariff; the corporate-book regression independently exposed an unforwarded route constraint before correction. Full repository/build gates and controlled world qualification remain pending. These results do not establish calibrated import elasticity or whole-world price, shortage and profit outcomes.
