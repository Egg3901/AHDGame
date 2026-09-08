# Sector investment viability

Issue: #1592. Baseline: `3e2e10f62a331b9c8c33fcaa12a5f7607d18817d`.
Corrected candidate: `1c08797572be4db39c1bca81717eecbf9242f0f8`.

**Balance validation accepted.**

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

Bond pricing, trading, coupon payments and bond-market liquidity rules are unchanged.

## Controlled investment arithmetic

Run `npx tsx scripts/sim/sectorInvestmentCalibration.ts`. This exercises the
shared pricing, delivery and cash-forecast rules without database access.

The example invests a fixed 100,000 anchor budget in energy capacity. It holds
prices and adequate demand constant, assumes 35% operating margin before 5%
allocated overhead, 20% tax on positive income, a 5% prime rate and 0.05%
physical depreciation per turn. A game year contains 48 turns. Replacement
cash is reserved and excluded from cash available to spend. The build is
funded from existing cash; borrowing costs and returns forgone elsewhere are
excluded.

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
80% throughput and positive operating income after allocated overhead. The steady sample excludes 19 active retools, leaving 829 sectors with settled recipes.
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
| Extraction    |                                    4.01% |               5.61% |

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
buyer room yields 4.98% median after the proposed discount, with a negative lower
quartile. A separate half-prime-markup sensitivity raises this median to 6.07%,
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

## Retool correction

The earlier long replay exposed an existing unit-basis defect. Owned stock and paid orders convert to destination units when a strategy changes, but production recipes blend over 12 turns. Applying the blended price to destination stock could create a large temporary input bill. The correction computes operating capacity in blended recipe units while keeping stock and paid basis on destination units. Lagged sales, contract capacity and downstream utilization use the corresponding physical basis. Gradual recipes and the existing transition penalty remain. Legacy operating capacity is initialized on the first retool turn even when old sales already use the correct source units.

A rejected earlier candidate completed 192 turns. Its final 12-turn mean all-corporation operating income fell from 50.038M to 31.186M anchor, driven mostly by a new NPC extraction firm's final operating-cost spike and liquidation. Original-player income also fell from 32.205M to 31.013M, and the mean corporate median fell from 186.993 to 173.424. These adverse observations are retained. They are not release clearance for the correction, and the original-player decline is not explained away by the NPC defect.

## Corrected full-engine experiment

The corrected candidate starts from the same frozen world and compares with the completed 192-turn baseline at the revision above. Common initial projected values match exactly. The corrected exporter additionally captures retool metadata, so raw snapshot hashes differ. All time-varying outcomes come from per-turn records, not current database endpoints.

Human actions and logins are not synthesized. Normal inactivity and CEO-vacancy rules remain enabled, and autonomous firms continue to act. A common seed aligns initial randomness; generated identifiers and subsequent decisions can diverge. Ambient wall-clock time is not pinned. Participation, account cleanup and other deadline-based rules can differ between runs started at different real times. These are descriptive stress tests, not isolated estimates of the package effects. Original player cohort labels follow the 93 player-led non-state firms and 1,175 sectors at capture. Later NPC takeover does not count as human reinvestment. The earlier candidate's orders in that cohort all followed one NPC takeover.

`runWorld.ts --clone-mode --preserve-live-config --mode=full` uses the captured gameplay posture. `--sector-investment-snapshots=<directory>` records observations only after durable turn validation. Interrupted runs are excluded. Private world records are not distributed.

Means below exclude the initial state. The corporate median includes inventory receipts; aggregate operating income excludes them. Government revenue and spending are annual flows, debt is a stock. Regional statistics are unweighted medians. This replay measures market feedback and existing-site behavior, not marginal player investment returns or willingness to reinvest.

### 48 turns

| Measure, mean over outcome turns                                      |      Baseline | Corrected candidate |
| --------------------------------------------------------------------- | ------------: | ------------------: |
| All-corporation operating income excluding inventory / turn, M anchor |        78.198 |              83.732 |
| Original-player operating income excluding inventory / turn, M anchor |        61.511 |              61.347 |
| Mean per-turn median corporation operating income, anchor             |       295.692 |             290.571 |
| Original-player sector jobs                                           | 1,607,798.208 |       1,596,898.062 |
| Loss-making original-player sectors                                   |       174.208 |             166.750 |
| Cold upkeep / turn, anchor                                            |    85,783.243 |          21,464.372 |
| Top-five share of net operating income, %                             |        76.271 |              75.945 |
| Goods pooled fill, %                                                  |        84.817 |              84.672 |
| Median commodity price / base                                         |         2.259 |               2.261 |
| Ownership-adjusted seller HHI                                         |     2,122.122 |           2,030.315 |
| Regional median unemployment, %                                       |        10.101 |               9.729 |
| Government annual revenue, B anchor                                   |       463.621 |             462.771 |
| Government annual spending, B anchor                                  |       476.922 |             476.002 |
| Government debt stock, B anchor                                       |     1,119.049 |           1,113.496 |

New paid construction orders at original-player-cohort firms: baseline 0, combined 151. This cohort can include later NPC controllers; these are not automatically human reinvestment. Other firms: baseline 45,003 orders / 231.602M anchor, combined 45,767 orders / 193.462M anchor. Spend excludes conversion fees, old/free orders and unit rescalings.

### 96 turns

| Measure, mean over outcome turns                                      |      Baseline | Corrected candidate |
| --------------------------------------------------------------------- | ------------: | ------------------: |
| All-corporation operating income excluding inventory / turn, M anchor |        74.005 |              83.849 |
| Original-player operating income excluding inventory / turn, M anchor |        62.838 |              62.867 |
| Mean per-turn median corporation operating income, anchor             |       300.067 |             303.396 |
| Original-player sector jobs                                           | 1,747,671.135 |       1,735,756.281 |
| Loss-making original-player sectors                                   |       179.729 |             173.875 |
| Cold upkeep / turn, anchor                                            |    84,816.116 |          21,284.093 |
| Top-five share of net operating income, %                             |        76.123 |              75.914 |
| Goods pooled fill, %                                                  |        85.406 |              85.338 |
| Median commodity price / base                                         |         2.504 |               2.498 |
| Ownership-adjusted seller HHI                                         |     2,186.816 |           2,072.749 |
| Regional median unemployment, %                                       |        10.998 |              10.657 |
| Government annual revenue, B anchor                                   |       464.212 |             463.994 |
| Government annual spending, B anchor                                  |       478.432 |             478.593 |
| Government debt stock, B anchor                                       |     1,098.990 |           1,100.699 |

New paid construction orders at original-player-cohort firms: baseline 0, combined 349. This cohort can include later NPC controllers; these are not automatically human reinvestment. Other firms: baseline 91,031 orders / 459.087M anchor, combined 94,334 orders / 470.019M anchor. Spend excludes conversion fees, old/free orders and unit rescalings.

Final 12 turns:

| Measure, mean over outcome turns                                      |      Baseline | Corrected candidate |
| --------------------------------------------------------------------- | ------------: | ------------------: |
| All-corporation operating income excluding inventory / turn, M anchor |        62.180 |              80.207 |
| Original-player operating income excluding inventory / turn, M anchor |        61.064 |              61.149 |
| Mean per-turn median corporation operating income, anchor             |       316.603 |             314.842 |
| Original-player sector jobs                                           | 1,907,549.833 |       1,895,565.417 |
| Loss-making original-player sectors                                   |       197.667 |             193.917 |
| Cold upkeep / turn, anchor                                            |    83,106.206 |          20,951.115 |
| Top-five share of net operating income, %                             |        76.782 |              76.842 |
| Goods pooled fill, %                                                  |        86.353 |              86.583 |
| Median commodity price / base                                         |         2.932 |               2.899 |
| Ownership-adjusted seller HHI                                         |     2,244.947 |           2,138.941 |
| Regional median unemployment, %                                       |        12.312 |              12.404 |
| Government annual revenue, B anchor                                   |       463.043 |             464.597 |
| Government annual spending, B anchor                                  |       471.248 |             475.965 |
| Government debt stock, B anchor                                       |     1,025.491 |           1,054.815 |

### 192 turns

| Measure, mean over outcome turns                                      |      Baseline | Corrected candidate |
| --------------------------------------------------------------------- | ------------: | ------------------: |
| All-corporation operating income excluding inventory / turn, M anchor |        66.646 |              76.342 |
| Original-player operating income excluding inventory / turn, M anchor |        55.627 |              55.750 |
| Mean per-turn median corporation operating income, anchor             |       282.522 |             286.564 |
| Original-player sector jobs                                           | 1,807,231.276 |       1,795,051.583 |
| Loss-making original-player sectors                                   |       191.802 |             188.286 |
| Cold upkeep / turn, anchor                                            |    82,913.415 |          20,842.925 |
| Top-five share of net operating income, %                             |        77.117 |              76.901 |
| Goods pooled fill, %                                                  |        86.337 |              86.266 |
| Median commodity price / base                                         |         2.552 |               2.551 |
| Ownership-adjusted seller HHI                                         |     2,223.057 |           2,116.244 |
| Regional median unemployment, %                                       |        11.947 |              12.042 |
| Government annual revenue, B anchor                                   |       470.423 |             471.862 |
| Government annual spending, B anchor                                  |       481.206 |             482.674 |
| Government debt stock, B anchor                                       |     1,070.265 |           1,079.338 |

New paid construction orders at original-player-cohort firms: baseline 181, combined 733. This cohort can include later NPC controllers; these are not automatically human reinvestment. Other firms: baseline 185,762 orders / 817.685M anchor, combined 193,769 orders / 1001.894M anchor. Spend excludes conversion fees, old/free orders and unit rescalings.

Final 12 turns:

| Measure, mean over outcome turns                                      |      Baseline | Corrected candidate |
| --------------------------------------------------------------------- | ------------: | ------------------: |
| All-corporation operating income excluding inventory / turn, M anchor |        50.038 |              51.200 |
| Original-player operating income excluding inventory / turn, M anchor |        32.205 |              32.213 |
| Mean per-turn median corporation operating income, anchor             |       186.993 |             202.188 |
| Original-player sector jobs                                           | 1,838,683.333 |       1,825,124.083 |
| Loss-making original-player sectors                                   |       222.917 |             219.417 |
| Cold upkeep / turn, anchor                                            |    79,323.785 |          19,997.372 |
| Top-five share of net operating income, %                             |        82.982 |              81.926 |
| Goods pooled fill, %                                                  |        88.757 |              89.082 |
| Median commodity price / base                                         |         2.365 |               2.376 |
| Ownership-adjusted seller HHI                                         |     2,263.293 |           2,235.257 |
| Regional median unemployment, %                                       |        13.421 |              13.402 |
| Government annual revenue, B anchor                                   |       486.374 |             492.781 |
| Government annual spending, B anchor                                  |       489.206 |             495.244 |
| Government debt stock, B anchor                                       |     1,064.422 |           1,090.918 |

Early new construction orders in the original player cohort were generated after an automated caretaker took over. An existing wall-clock-based account-cleanup deadline caused different takeover timing between the arms. These autonomous orders do not measure human adoption.

Final 192-turn results: original-player mean operating income excluding inventory is 55.627M baseline versus 55.750M candidate anchor per turn (+0.22%). The mean per-turn corporate median rises 1.43%, losing sectors fall 1.83%, and jobs fall 0.67%. All-corporation income is 66.646M versus 76.342M, but earlier large losses among newly created baseline firms materially affect that aggregate comparison. No original player firm disappears or is automatically liquidated; total automated liquidations are 96 versus 50.

In the final 12 turns, original-player income is 32.205M versus 32.213M (+0.02%), the mean corporate median is 186.993 versus 202.188 (+8.13%), and jobs fall 0.74%. All-corporation income is 50.038M versus 51.200M; at the final turn it is 49.087M versus 49.224M. The severe terminal cost collapse from the rejected candidate is absent in this replay. New firms contribute 0.988M versus 0.827M over that final window. The controlled retool regressions provide separate evidence for the unit correction; autonomous paths are not identical.

Retail remains loss-making in the unattended world replay: mean sector profit over 192 turns is -1.129M baseline versus -1.116M candidate per turn. Final-window extraction sector profit is 3.026M versus 2.954M. These sector figures include inventory receipts and precede corporate overhead and tax. The package improves investment terms and gives players a recovery choice; it does not create buyers or make every existing operation profitable.

At 96 turns, original-player mean operating income excluding inventory is nearly flat: 62.838M baseline versus 62.867M candidate anchor per turn (+0.05%). The mean per-turn corporate median rises 1.11%, losing sectors fall 3.26%, and original-player sector jobs fall 0.68%. In the final 12 turns, original-player income is 0.14% higher, while the corporate median is 0.56% lower and jobs are 0.63% lower. This mixed midpoint result is retained alongside the final judgment.

All-corporation income averages 74.005M baseline versus 83.849M candidate across the first 96 turns. Its final 12-turn gap is 62.180M versus 80.207M. Newly created firms contribute -17.118M versus +0.410M in that final window, accounting for about 97% of the aggregate gap. The baseline includes a large terminal loss at a new autonomous firm; its deleted final sector record is unavailable. This does not establish a broad operating-income gain for players or isolate an effect of the sector buffs.

Confirmed automated liquidations through 96 turns are 55 in baseline versus 32 in the candidate, with none at the original player cohort in either arm. No original player firm is absent. Mean government debt is 0.16% higher over all 96 turns; the final-window gap is larger and must be read alongside default timing and exchange rates.

At 96 turns, the final 12-turn mean government debt gap is 2.86% at current exchange rates and 2.29% at the frozen starting rates. Median country debt/GDP is 39.27% in baseline and 63.56% in the candidate. The fixed-rate calculation separates currency translation from local-currency budget changes; it does not identify their cause.

New default flags through 96 turns, excluding instruments already defaulted at capture, are baseline: 1 corporate and 128 sovereign; candidate: 0 corporate and 96 sovereign. Counts refer to instruments, not crisis episodes or losses. Equal counts can involve different issuers. Existing sovereign repudiation writes off 95% of principal, so lower debt is not automatically a fiscal improvement. Restructuring without a default flag is not counted.

At 192 turns, the final 12-turn mean government debt gap is 2.49% at current exchange rates and -0.08% at the frozen starting rates. Median country debt/GDP is 38.15% in baseline and 38.56% in the candidate. The fixed-rate calculation separates currency translation from local-currency budget changes; it does not identify their cause.

New default flags through 192 turns, excluding instruments already defaulted at capture, are baseline: 1 corporate and 160 sovereign; candidate: 0 corporate and 160 sovereign. Counts refer to instruments, not crisis episodes or losses. Equal counts can involve different issuers. Existing sovereign repudiation writes off 95% of principal, so lower debt is not automatically a fiscal improvement. Restructuring without a default flag is not counted.

Controller audit through 192 turns at original-player-cohort firms: baseline: 181 paid orders, 181 under NPC control; candidate: 733 paid orders, 733 under NPC control. These orders do not establish human reinvestment. The cohort retains its original membership after a change of controller.

Balance judgment: Accept the scoped sector package for promotion. Controlled rules improve new-build cash timing and reduce the carrying cost of surplus capacity; the deliberate retail scenario cuts losses without guaranteeing profit. The corrected 192-turn stress replay has complete evidence, original-player operating income +0.22%, mean corporate median +1.43%, losing sites -1.83% and jobs -0.67%. Its final 12-turn original-player income is essentially flat (+0.02%), median +8.13% and jobs -0.74%; the severe final cost collapse in the rejected candidate is absent. Retail remains loss-making without deliberate recovery, and extraction is weaker in the final window. Ambient clock and autonomous paths prevent causal attribution of the world differences. No universal profitability, human-adoption or bond-outperformance claim is warranted. No additional broad rate discount is justified.

Complete observations require a contiguous snapshot sequence, durable completed or skipped phase logs, current original-player financial records and valid recorded FX. The baseline is reused explicitly; source changes, generated identifiers and autonomous decisions prevent a clean randomized causal interpretation. A fall in sovereign debt can reflect existing default write-offs and is not automatically a fiscal improvement.

### Deliberate retail recovery

Both arms run the corrected candidate for 12 turns. The intervention sets 30 initially losing retail sites with positive output below 25% of owned capacity to 25% active. All other initial records match. This is a hypothetical fixed operating choice.

| Selected sites, mean over 12 turns | Original operation |   25% active |
| ---------------------------------- | -----------------: | -----------: |
| Site profit / turn, anchor         |       -970,750.099 | -358,793.218 |
| Upkeep / turn, anchor              |        967,915.328 |  379,664.153 |
| Revenue / turn, anchor             |        317,095.549 |  117,834.947 |
| Jobs                               |         76,674.583 |   19,168.583 |
| Loss-making sites                  |             30.000 |       29.000 |

Financial figures precede corporate overhead and tax. Loss control can also reduce output and jobs without making every site profitable. The setting change moves no cash or paid assets; normal depreciation and construction continue. All 24 outcomes pass durable phase validation.

### Turn read profile

One clean turn from separate fresh copies of the same frozen state. Baseline uses the revision above; candidate uses `1c0879757`. Both complete all 237 phases with zero result warnings. Byte accounting is enabled.

| Measurement                                |    Baseline | Corrected candidate |
| ------------------------------------------ | ----------: | ------------------: |
| World Mongo round trips                    |      22,131 |              22,219 |
| World documents returned                   |     452,943 |             453,693 |
| World BSON bytes returned                  | 309,057,962 |         310,854,230 |
| Corporation phase round trips              |       1,709 |               1,729 |
| Corporation phase BSON bytes               |  79,637,913 |          80,146,930 |
| Corporate-sector documents in that phase   |      26,082 |              26,091 |
| Corporate-sector BSON bytes in that phase  |  34,408,944 |          34,897,608 |
| Corporate-sector round trips in that phase |          56 |                  56 |

Both corporation-phase counts remain below the existing 2,000-trip budget. There is no new query per sector. Added telemetry and path divergence change returned bytes and documents. Shared-host wall-clock times are not a useful comparison.

## Forecast, recovery and compatibility checks

The UI requires current operating figures and a settled recipe for a forecast. The calculation includes delivery ramp, depreciation, costs for all production, measured buyer room, observed fill once, allocated overhead including R&D, tax, freight, upkeep and replacement reserves. Existing inventory sell-down is excluded. A glut can produce a negative cash estimate.

Tests cover founder terms and paid schedules, partial output and staffing, cold versus active upkeep, contract liability, ownership/listing races, transfer/carve/rollback, unfinished-only refunds, mining retools in both directions, lagged sales, older automated retools and construction delivered during a recipe blend. Desktop and mobile component previews use synthetic figures.

`activeCapacityPercent` defaults to 100% when absent. Full mothballing remains authoritative. Retool operating-capacity telemetry is optional and is populated on normal sector turns; owned stock and paid basis require no backfill. Setting active capacity changes operating settings only.

An older engine ignores partial settings and would reactivate parked capacity. Rollback must retain the capacity reader or deliberately preserve operating intent through full mothballing before reverting it. Retool rollback also restores the old unit-basis defect; prefer a forward correction.
