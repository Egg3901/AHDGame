# Sector investment viability

Issue: #1592. Baseline: `7b4f190761ad4316c1f490573ac0c382e3cb19d2`.

**Validation in progress. This report is not yet a balance merge gate.**

## Candidate

Ordinary expansion costs 20% less. New ordinary builds with original durations
of 72, 84 or 96 turns complete over 36, 42 or 48 turns. Founding discounts and
founding schedules retain their previous values. Existing paid orders retain
their original delivery schedule and cost basis.

Players can keep 1% to 100% of capacity active, with full mothballing available
separately. Cold capacity pays 5% of anchored maintenance instead of 20%.
Active but voluntarily unused capacity retains its existing upkeep. Resizing
moves no cash and preserves owned capacity, paid basis and construction orders.
Normal depreciation continues. Production and staffing follow the active share;
existing supply-contract shortfall liability remains based on full capacity.
New contract capacity reflects the active share. Transfers preserve partial
settings and physical active capacity.

Bond pricing, trading, coupons and financial liquidity rules are unchanged.

## Controlled investment arithmetic

Run `npx tsx scripts/sim/sectorInvestmentCalibration.ts`. This exercises the
shared pricing, delivery and cash-forecast rules without database access.

The example invests a fixed 100,000 anchor budget in energy capacity. It holds
prices and adequate demand constant, assumes 35% operating margin before 5%
allocated overhead, 20% tax on positive income, a 5% prime rate and 0.05%
physical depreciation per turn. A game year contains 48 turns. Replacement
cash is reserved and excluded from cash available to spend.

| Configuration | Units bought | Build turns | Cash returned by 48 turns | By 96 turns | By 192 turns |
| ------------- | -----------: | ----------: | ------------------------: | ----------: | -----------: |
| Baseline      |          240 |          96 |                     2.09% |       8.22% |       23.97% |
| Cost only     |          300 |          96 |                     2.77% |      10.87% |       31.70% |
| Delivery only |          240 |          48 |                     4.18% |      12.25% |       27.82% |
| Combined      |          300 |          48 |                     5.53% |      16.20% |       36.79% |

These are cumulative cash returns under stated assumptions, not measured
player returns or annualized bond-arbitrage profits. Remaining depreciated
paid basis and unfinished construction are reported separately. They are not
cash exit proceeds and are not added to cash-return percentages.

## Calibration against observed operating conditions

A frozen 1966 world supplied current operating figures and exact build-quote
contexts. Healthy sectors require at least 80% observed sales fill, at least
80% throughput and positive operating income after allocated overhead.
Calculations use actual CEO acumen, technology, local cost of living, prime
rates, competitor count, market share, tax and currency conversion fees.
Inventory sell-down receipts are removed before extrapolating recurring cash.

| Sector        | Median retained annual cash yield before | With cost reduction |
| ------------- | ---------------------------------------: | ------------------: |
| Energy        |                                    7.42% |               9.88% |
| Retail        |                                    7.40% |               9.86% |
| Real estate   |                                    4.20% |               5.85% |
| Manufacturing |                                   16.70% |              21.48% |

This is a steady operating extrapolation against current replacement quotes,
including overhead, taxes and replacement. It excludes the construction ramp
and is not a causal estimate of marginal expansion. Current buyers' room does
not prove sufficient deposits, inputs, staff or future demand. Retail orders
were temporarily unavailable at the capture point during the final two turns
of the existing demand transition.

Real estate remains less attractive in the captured conditions. Its median
quote includes a 1.545 dominance multiplier, and only a minority of otherwise
healthy locations have room for even a 1% production expansion. This supports
retaining competition costs and improving recovery choices rather than
calibrating every sector to a guaranteed positive investment return.

No observed realized bond-arbitrage return series was available. Coupon income
alone is not that benchmark. This report makes no claim that sectors universally
outperform financial trading.

## Full-engine experiment

Four independent sandbox copies start from the same frozen world and indexes.
All use the same seed and captured gameplay configuration. Human corporation
controllers and decisions are preserved; autonomous corporations continue to
act. Shadow-ledger instrumentation and sandbox clock guards are enabled in
all arms. A seed aligns initial randomness but generated identifiers and
subsequent decisions can cause paths to diverge.

- Baseline and combined: 192 consecutive turns, measured at 48, 96 and 192.
- Cost-only and delivery-only: 48 consecutive turns for first-year component
  comparisons.
- Independent four-configuration investment arithmetic supplies the longer
  component cashflow horizons. It does not supply macroeconomic outcomes.

The replay measures market stability and autonomous behavior. It cannot measure
human willingness to reinvest when human decisions remain fixed. In particular,
incumbent operating income is not the return on a newly purchased plant.

`runWorld.ts --clone-mode --preserve-live-config --mode=full` keeps the captured
controller and gameplay posture. `--sector-investment-snapshots=<directory>`
records projected observations and rejects failed or unreached turn phases
before admitting a snapshot. Interrupted run windows are excluded, not resumed
as complete economic observations. Private world records are not distributed.

Full-engine results and final validation will be added before this change is
eligible to merge.

### Turn read profile

One completed turn from separate copies of the same frozen state, with byte
accounting enabled and no warnings in either arm:

| Measurement                                   |    Baseline |    Combined |
| --------------------------------------------- | ----------: | ----------: |
| World Mongo round trips                       |      22,181 |      22,157 |
| World documents returned                      |     453,088 |     452,993 |
| World BSON bytes returned                     | 310,064,688 | 309,309,352 |
| Corporation phase round trips                 |       1,728 |       1,733 |
| Corporation phase BSON bytes                  |  79,631,656 |  79,649,667 |
| Corporate-sector documents read in that phase |      26,082 |      26,082 |
| Corporate-sector BSON bytes in that phase     |  34,408,948 |  34,408,948 |
| Corporate-sector round trips in that phase    |          56 |          56 |

Both corporation-phase counts remain below the existing 2,000-trip budget.
There is no new query per sector. Generated identifiers, decisions and
asynchronous telemetry attribution can differ; this single paired turn does
not establish a general performance improvement. Local wall-clock times are
not a useful comparison under shared-host load.

## Forecast and recovery checks

The UI uses current-turn operating figures. Missing or stale figures suppress
the estimate. It includes construction delivery, physical depreciation, all
produced units' costs, measured unmet demand, observed sales fill exactly once,
allocated corporation overhead including R&D, tax, freight, upkeep and a
replacement reserve. Selling existing inventory is not recurring expansion
income. A glut can therefore produce a negative cash estimate.

Tests cover preservation of founder terms and old orders, partial production
and staffing, cold versus active upkeep, contract liability, ownership/listing
races, transfer/carve/rollback behavior, and refunding only undelivered paid
construction. Desktop and mobile component previews use synthetic figures.

## Data compatibility

`activeCapacityPercent` is optional and defaults to 100%. No backfill is
required. Legacy full mothballing remains authoritative. Setting active capacity
is free and updates only operating settings; it does not change cash or assets.

Rollback requires preserving partial operating intent: an older engine ignores
this new field and would reactivate partially parked capacity. A rollback must
first retain the new capacity reader or deliberately convert affected partial
plants to full mothballing. Merely reverting the reader is not a safe rollback.
