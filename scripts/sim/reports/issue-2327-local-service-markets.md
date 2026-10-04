# Local service markets: issue #2327

The control permits every commodity to clear internationally and uses country
books for sector sales. The treatment uses the production state-market rule,
international clearing, reachable books, convergence, valuation and sector
clearing functions. Both receive the same balances and open trade lanes.

Run `npx tsx scripts/sim/localServiceMarkets2327.ts`.
An optional `--out=<path>` writes all 288 scenario observations as JSON.

The replay covers 48 turns, three countries, four states, four on-site services
and two remote services. A fixed demand step at turn 25 moves local demand
without moving production. This is a controlled market replay with exogenous
inputs; it does not model autonomous investment, migration or a full world.

| Outcome                                       | Control                        | Treatment |
| --------------------------------------------- | ------------------------------ | --------- |
| Local-service international flow, turns 1-24  | 100 units per service per turn | 0         |
| Local-service international flow, turns 25-48 | 75 units per service per turn  | 0         |
| New Jersey local seller fill, turns 1-24      | 75%                            | 0%        |
| New Jersey local seller fill, turns 25-48     | 100%                           | 25%       |
| Arizona local seller fill, turns 1-24         | 75%                            | 50%       |
| Arizona local seller fill, turns 25-48        | 100%                           | 100%      |
| Software and consulting international flow    | 100 then 75 units              | Identical |

All 288 observations pass conservation and scope assertions. Local services
never receive foreign capacity signals or trade convergence relief. Software
and consulting retain identical clearing and seller results because they can
be delivered remotely; neither is made physical freight. Entertainment here
means the existing `events` commodity, healthcare means `visits`, construction
means `crew-days`, and real estate means `leases`. A future royalty or digital
content product requires its own delivery semantics.

The current integration suite passes 160 tests across twelve files, covering state-market
sales, reachable demand, trade valuation, contract cancellation notice and
settlement equivalence. Existing corporation-wide agreements for newly local
services use the existing notice migration; state-specific agreements continue.
Full repository qualification and integrated-world investment calibration are
separate release checks.
