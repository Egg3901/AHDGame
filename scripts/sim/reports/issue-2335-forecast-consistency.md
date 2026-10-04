# NPP forecast consistency, issue #2335

Reproduce with `npx tsx scripts/sim/nppStrategyForecastConsistency.ts`.
Rules source SHA-256: `144380b899e12c96697d93b9503b4307f68eac38340fd1d4972ed3ec24b2d42d`.

## Controlled output-price comparison

Two production extraction recipes, full deposit room, no costs or clearing.
The sector-price oracle is the production `computePriceRealization` kernel.

| Recipe            | Raw price score | New output forecast | Production output-price term |
| ----------------- | --------------: | ------------------: | ---------------------------: |
| iron_mining       |          2.3400 |              1.1700 |                       1.1700 |
| rare_earth_mining |         14.4000 |              1.0800 |                       1.0800 |

48 independent observations alternate rare-earth raw price ratios 20, 50 and 100,
with iron fixed at 3. Every observation starts with iron; no production or market
state evolves between observations. The legacy chooser requests rare-earth retooling
in 48/48 observations;
the new chooser keeps iron in 48/48.
Both use the unchanged 25% switch threshold. This is a saturation regression sweep,
not a 48-turn game simulation.

## Plants input-bill oracle

Nominal daily revenue 1, utilization 1, policy multiplier 1 and turns-per-day 1.
Output prices are neutral; all input ratios are neutral. These normalized input
costs are compared directly to production `computeInputsCost`.

| Recipe            | Forecast input cost | Production bill |
| ----------------- | ------------------: | --------------: |
| iron_mining       |              0.6500 |          0.6500 |
| rare_earth_mining |              0.7200 |          0.7200 |

## Limits and remaining qualification

The forecast estimates normalized recipe contribution. Deposit room and lagged
aggregate sellability are proxies. It does not reproduce individual clearing
priority, transitional recipes, technology, posture, labor, fixed costs, policy,
landed-price premiums or financing. It establishes neither profit nor survival.

Before closing #2335, run a paired pinned 48-192-turn world simulation and report
chosen strategies, delivered units, actual input bills and cash returns, shortage
duration, and player/NPP competition. Preserve the cooldown and transition guards.
