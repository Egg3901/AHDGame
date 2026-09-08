# Sector investment viability

Issue: #1592. Baseline: `3e2e10f62a331b9c8c33fcaa12a5f7607d18817d`.
Integrated candidate: `9fd0d2586933420f7a624b503692162f1ad62e50`.

**Validation in progress. This report is not yet a balance merge gate.**

## Candidate

Ordinary expansion gets a 20% discount on strategy-priced construction. New ordinary builds with original durations
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
Calculations use each sector's actual strategy, CEO acumen, technology, local
cost of living, prime rates, competitor count, market share, tax and currency
conversion fees. Both comparisons include development's strategy-price correction.
Inventory sell-down receipts are removed before extrapolating recurring cash.

| Sector        | Median retained annual cash yield before | With cost reduction |
| ------------- | ---------------------------------------: | ------------------: |
| Energy        |                                    7.96% |              10.55% |
| Retail        |                                    7.87% |              10.44% |
| Real estate   |                                    4.93% |               6.77% |
| Manufacturing |                                   13.13% |              17.01% |
| Extraction    |                                    4.70% |               6.48% |

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

Extraction's earlier calibration used the type's default build price. Pricing
the actual strategy changes that comparison materially. The current sample with
buyer room yields 5.61% median after the proposed discount, with a negative lower
quartile. A separate half-prime-markup sensitivity raises this median to 6.79%,
while also substantially increasing already strong sectors' returns. The sample
does not support stacking a broad prime discount onto the candidate.

A separate historical ledger reconciliation yields only a small, concentrated
closed-position sample. Recent complete positions are maturity exits; the sample
does not identify a repeatable current resale-arbitrage return. Missing coupon
records, unknown opening holdings and still-open positions are excluded from
its strict benchmark. A separate purchase-to-sale cash comparison uses
quantity-matched closed resale positions despite a missing coupon turn; it
excludes all coupons rather than inventing the absent payment. Neither small
sample establishes repeatability. Coupon income alone is not realized
arbitrage. This report makes no claim that sectors universally outperform
financial trading.

## Full-engine experiment

Four independent sandbox copies start from the same frozen world and indexes.
All use the same seed and captured gameplay configuration. Human corporation
controllers and decisions are preserved; autonomous corporations continue to
act. No human actions or logins are synthesized, and normal inactivity and
vacant-CEO rules remain enabled. Shadow-ledger instrumentation and sandbox
clock guards are enabled in all arms. A seed aligns initial randomness but generated identifiers and
subsequent decisions can cause paths to diverge.

The release experiment includes current strategy-priced construction and equity
pool accounting in every arm. Earlier runs against the preceding development
revision are historical exploratory evidence and are excluded from release gates.

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

## Full-engine results

Original cohort: 93 player-led non-state corporations and 1,175 sectors. The initial state is excluded from outcomes. Figures below are means across each complete window. The median corporation measure includes inventory receipts; aggregate operating income removes those receipts. Debt and treasury are stocks. Fiscal revenue and spending are annual flows. Regional statistics are unweighted medians, not population-weighted national outcomes.

### 48 turns

| Measure, mean over outcome turns                               |      Baseline |          Cost |      Delivery |      Combined |
| -------------------------------------------------------------- | ------------: | ------------: | ------------: | ------------: |
| Operating income excluding inventory receipts / turn, M anchor |        61.511 |        61.419 |        61.463 |        61.565 |
| Mean of per-turn median corporate operating income, anchor     |       295.692 |       290.113 |       290.130 |       296.285 |
| Player-sector jobs                                             | 1,607,798.208 | 1,608,571.729 | 1,608,591.354 | 1,597,216.333 |
| Loss-making player sectors                                     |       174.208 |       174.812 |       173.458 |       172.104 |
| Cold upkeep / turn, anchor                                     |    85,783.243 |    85,851.379 |    85,837.851 |    21,442.918 |
| Top-five share of net operating income, %                      |        76.271 |        76.289 |        76.306 |        76.202 |
| Goods pooled fill, %                                           |        84.817 |        84.856 |        84.822 |        84.807 |
| Median commodity price / base                                  |         2.259 |         2.259 |         2.259 |         2.259 |
| Ownership-adjusted seller HHI                                  |     2,122.122 |     2,113.824 |     2,113.859 |     2,113.527 |
| Regional median unemployment, %                                |        10.101 |        10.101 |        10.110 |         9.991 |
| Government annual revenue, B anchor                            |       463.621 |       462.679 |       464.639 |       463.624 |
| Government annual spending, B anchor                           |       476.922 |       475.998 |       477.828 |       476.913 |
| Government debt stock, B anchor                                |     1,119.049 |     1,115.454 |     1,123.280 |     1,119.246 |

New paid smooth construction orders at original player firms: baseline 0, cost 0, delivery 0, combined 0. Other firms: baseline 45,003 orders / 231.602M anchor construction spend, cost 45,152 orders / 190.919M anchor construction spend, delivery 45,327 orders / 232.291M anchor construction spend, combined 45,224 orders / 191.684M anchor construction spend. Spend excludes conversion fees; old, free and unit-rescaling entries are excluded.

### 96 turns

| Measure, mean over outcome turns                               |      Baseline |      Combined |
| -------------------------------------------------------------- | ------------: | ------------: |
| Operating income excluding inventory receipts / turn, M anchor |        62.838 |        62.560 |
| Mean of per-turn median corporate operating income, anchor     |       300.067 |       295.125 |
| Player-sector jobs                                             | 1,747,671.135 | 1,735,895.719 |
| Loss-making player sectors                                     |       179.729 |       175.010 |
| Cold upkeep / turn, anchor                                     |    84,816.116 |    21,211.707 |
| Top-five share of net operating income, %                      |        76.123 |        76.195 |
| Goods pooled fill, %                                           |        85.406 |        85.354 |
| Median commodity price / base                                  |         2.504 |         2.501 |
| Ownership-adjusted seller HHI                                  |     2,186.816 |     2,181.553 |
| Regional median unemployment, %                                |        10.998 |        10.891 |
| Government annual revenue, B anchor                            |       464.212 |       465.520 |
| Government annual spending, B anchor                           |       478.432 |       479.783 |
| Government debt stock, B anchor                                |     1,098.990 |     1,105.302 |

New paid smooth construction orders at original player firms: baseline 0, combined 0. Other firms: baseline 91,031 orders / 459.087M anchor construction spend, combined 92,914 orders / 467.181M anchor construction spend. Spend excludes conversion fees; old, free and unit-rescaling entries are excluded.

Final 12 turns at this horizon:

| Measure, mean over outcome turns                               |      Baseline |      Combined |
| -------------------------------------------------------------- | ------------: | ------------: |
| Operating income excluding inventory receipts / turn, M anchor |        61.064 |        59.511 |
| Mean of per-turn median corporate operating income, anchor     |       316.603 |       308.946 |
| Player-sector jobs                                             | 1,907,549.833 | 1,895,612.000 |
| Loss-making player sectors                                     |       197.667 |       190.417 |
| Cold upkeep / turn, anchor                                     |    83,106.206 |    20,784.533 |
| Top-five share of net operating income, %                      |        76.782 |        77.173 |
| Goods pooled fill, %                                           |        86.353 |        86.221 |
| Median commodity price / base                                  |         2.932 |         2.918 |
| Ownership-adjusted seller HHI                                  |     2,244.947 |     2,279.566 |
| Regional median unemployment, %                                |        12.312 |        12.396 |
| Government annual revenue, B anchor                            |       463.043 |       468.077 |
| Government annual spending, B anchor                           |       471.248 |       477.188 |
| Government debt stock, B anchor                                |     1,025.491 |     1,053.144 |

### 192 turns: pending

At 96 turns, the final 12-turn mean government debt difference is 2.70% at current FX and 0.82% at frozen starting FX. This alternate conversion separates translation from local-currency budget changes without identifying causality. The corresponding median country debt/GDP is 39.27% in baseline and 39.43% in combined.

Complete windows require all snapshots, all original-player financial rows, required money fields, valid recorded FX and durable phase validation. A completed turn clears the live processing fields, so validity comes from its durable turn log. Every accepted outcome contains all 237 core phase statuses, completed or skipped. Scheduled leadership turnover adds an extra completed phase on certain turns. Initial projected snapshot hashes agree across all four arms.

The package targets new investment and recovery choices. A fixed-human replay does not establish a cash-return premium, willingness to reinvest or a general income uplift for incumbent firms. Path divergence and the extra cold-upkeep change in the combined package prevent a clean factorial causal interpretation. Newborn autonomous sectors can lack current P&L; coverage counts remain explicit in the private analysis.

### Deliberate retail recovery

A separate 12-turn paired replay uses the current candidate in both arms. Thirty initially loss-making retail sites with positive output below 25% of physical capacity are set to 25% active in the intervention. All other initial records match. This is a hypothetical fixed action, not observed adoption or an optimized policy.

| Selected sites, mean over 12 turns         | Original operation |   25% active |
| ------------------------------------------ | -----------------: | -----------: |
| Sector profit / turn, anchor               |       -969,070.868 | -357,842.720 |
| Cold and active-idle upkeep / turn, anchor |        968,585.905 |  379,542.755 |
| Revenue / turn, anchor                     |        317,253.477 |  117,662.185 |
| Jobs                                       |         76,674.583 |   19,168.583 |
| Loss-making sites                          |             30.000 |       29.000 |

Financial figures precede corporate overhead and tax. Reducing operating capacity can reduce losses and employment without making every site profitable. The setting change moves no cash or paid assets; normal depreciation and construction continue. All 24 outcome turns pass the durable phase gate.

### Candidate provenance

Full-world runs are pinned at the integrated economic candidate above. Later fixes scale transition revenue with partial operation and preserve the geological allowance when spare mining capacity is parked. Those conditional paths have focused engine regressions and the separate current-candidate recovery replay. The long-run snapshots are checked for partial settings before treating those refinements as neutral for their observations. A separate coupon-record correction changes the logged net amount to the cash already credited after the existing foreign conversion fee; it changes no bond payment or trading rule.

### Turn read profile

One clean turn from separate fresh copies of the same frozen state. Baseline uses current development; candidate uses `dd2113696`. Byte accounting is enabled. Both turns completed all 237 phases with zero warnings.

| Measurement                                |    Baseline |    Combined |
| ------------------------------------------ | ----------: | ----------: |
| World Mongo round trips                    |      22,131 |      22,126 |
| World documents returned                   |     452,943 |     452,946 |
| World BSON bytes returned                  | 309,057,962 | 309,040,743 |
| Corporation phase round trips              |       1,709 |       1,711 |
| Corporation phase BSON bytes               |  79,637,913 |  79,647,299 |
| Corporate-sector documents in that phase   |      26,082 |      26,082 |
| Corporate-sector BSON bytes in that phase  |  34,408,944 |  34,408,944 |
| Corporate-sector round trips in that phase |          56 |          56 |

Both corporation-phase counts remain below the existing 2,000-trip budget. There is no new query per sector. Generated identifiers, decisions and asynchronous telemetry attribution can differ; one paired turn does not establish a general performance improvement. Shared-host wall-clock times are not a useful comparison.

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
