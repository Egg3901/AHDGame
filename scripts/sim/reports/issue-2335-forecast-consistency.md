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

## Optional sandbox observation capture

Source-qualified investment snapshots at `26a5490b6027e6a74a5e681a089e5f4673f4c14f`
retain sold commodity mix, recipe prices, deposit capacity, reachable books and
selector configuration. They distinguish opening from post-turn state, preserve
the observed book turn, and record a prospective evaluation turn. Qualified
captures require a sandbox database plus run, seed and full source commit.
Unpinned captures remain explicitly ineligible. Files and directories use
permissions 0600 and 0700.

The actual-source capture sweep passes 29 tests in three suites. An isolated
synthetic Mongo fixture compares the prior collector at `eb1c844d0a` with the
qualified capture, without executing world turns:

| NPP sectors | Prior reads | Capture reads | Prior reply BSON bytes | Capture reply BSON bytes |
| ----------: | ----------: | ------------: | ---------------------: | -----------------------: |
|           1 |           9 |            13 |                  1,621 |                    2,731 |
|          20 |           9 |            13 |                  7,265 |                    9,363 |
|          60 |           9 |            13 |                 19,185 |                   23,363 |

The four added reads are projected and shared by the cohort. Off mode skips the
book; an empty cohort skips both capacity and book reads. Command counts above
apply to the measured cohort sizes; larger cursors may require pagination.
Synthetic data was removed and the client closed. These are collector command
and BSON measurements, not production latency or a realized world trajectory.

## Limits and remaining qualification

The forecast estimates normalized recipe contribution. Deposit room and lagged
aggregate sellability are proxies. It does not reproduce individual clearing
priority, transitional recipes, technology, posture, labor, fixed costs, policy,
landed-price premiums or financing. It establishes neither profit nor survival.

Before closing #2335, run a pinned 48-192-turn candidate world and compare legacy
and candidate rankings on identical captured observations. Report actual chosen
strategies, delivered units, input bills, cash returns, shortage duration and
player/NPP competition. Post-turn observations cannot reconstruct an earlier
decision after intervening phases or the first retool pass. Descriptive shadows
do not establish causal outcome differences; those require matched independent
worlds. Preserve cooldown and transition guards. The deployed queue currently
does not expose the optional snapshot argument, so capture transport and the
realized outcome report remain outstanding.
