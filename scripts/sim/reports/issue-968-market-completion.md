# Issue #968 market completion simulation report

Run on 2026-08-27 against six identical sandbox copies of the live world at
turn 437. The experiment advanced each arm for 48 turns, through turn 485,
with seed `issue-968-live-435`, preset `1953-default`, market mode `plants`, and
labour mode `full`. Production was read only. Every write went to the isolated
MongoDB sandbox on port 27018.

The external assessment that motivated the program is published at
<https://ops.lakesidegames.net/reports/state-of-economy-external-assessment-t435>.
This file records the implementation evidence and activation decisions.

## Identification design

The control and treatment databases began from the same turn-437 snapshot and
used the same seed. A terminal statistic is the median of turns 474 through
485, not a selected endpoint. A percentage-point delta is treatment minus
control. A negative delta is beneficial only for failure measures such as the
tolerance-bound share.

| Arm                   | Freight settlement | Freight billing | Adaptive sourcing | Bond-liquidity target |
| --------------------- | ------------------ | --------------- | ----------------- | --------------------- |
| Shadow counterfactual | shadow             | off             | off               | production baseline   |
| Adaptive sourcing     | shadow             | off             | on                | production baseline   |
| Live-policy control   | active             | off             | off               | off                   |
| Freight billing       | active             | on              | off               | off                   |
| Combined              | active             | on              | on                | off                   |
| Bond liquidity        | active             | off             | off               | on                    |

The turn-437 live snapshot already carried active freight settlement while
canonical freight billing remained off. The live-policy control therefore
preserves that configuration. This allows four distinct comparisons:

- adaptive sourcing versus the shadow counterfactual isolates adaptive price
  tolerance without billed freight;
- live-policy control versus the shadow counterfactual estimates the active
  freight-settlement effect;
- freight billing versus live-policy control isolates the transfer of shipping
  money while both keep active physical settlement;
- bond liquidity versus live-policy control isolates only the bond target.

The adaptive-sourcing activation rule required at least a 5-point improvement
in intent fulfillment and pooled fill, a meaningful rise in nonlocal delivery,
and no country-level fill decline larger than 5 points. Sell-through and labour
staffing could not deteriorate by more than 5 points. Bond activation requires
unowned sovereign issues below 35% without a fund-backing, trial-balance, or
broader market regression.

## Shadow counterfactual economy

The shadow-counterfactual terminal window shows that the production and labour
repairs which preceded #968 are working. The remaining scarcity is an
allocation and market-access problem, not a general collapse in productive
utilization. The later live-policy control is the activation baseline because
it retains the live snapshot's active freight settlement.

| Measure                            | Turn 474 to 485 median | Program target | Result      |
| ---------------------------------- | ---------------------: | -------------: | ----------- |
| Pooled goods fill                  |                 80.65% |      above 80% | pass        |
| Buyer-intent fulfillment           |                 62.90% |      above 70% | fail        |
| Nonlocal share of fulfilled intent |                 23.38% |      above 25% | near target |
| Sectors at throughput floor        |                  0.00% |      below 50% | pass        |
| Physical sell-through              |                 90.25% |      guardrail | healthy     |
| Labour staffing                    |                 93.25% |      above 65% | pass        |
| Chronic low-fill sectors           |                  1.81% |     diagnostic | low         |
| Stockpiling sectors                |                  6.74% |     diagnostic | low         |
| Listings traded in 48 turns        |                 26.28% |      above 60% | fail        |
| Two-sided equity books             |                  0.00% |     diagnostic | fail        |
| Open depth / market capitalization |                  0.41% |     diagnostic | shallow     |
| Bonds with no holder               |                 66.15% |      below 35% | fail        |
| Active modeled balances            |                 38.45% |     diagnostic | low         |
| Dormant modeled balances           |                 61.55% |     diagnostic | high        |

At the endpoint, 465 of 600 sovereign issues had no holder, or 77.50%. The
corporate market was materially healthier: 53 of 186 issues had no holder, or
28.49%. The liquidity defect is therefore specifically sovereign, not a
blanket bond-market failure.

## Adaptive sourcing result

| Measure                      | Shadow control | Treatment |        Delta | Gate        |
| ---------------------------- | -------------: | --------: | -----------: | ----------- |
| Pooled goods fill            |         80.65% |    80.84% | +0.19 points | fail        |
| Country-scoped fill          |         73.06% |    73.11% | +0.04 points | neutral     |
| Buyer-intent fulfillment     |         62.90% |    63.42% | +0.52 points | fail        |
| Nonlocal fulfillment share   |         23.38% |    24.09% | +0.71 points | improvement |
| Tolerance-bound unmet intent |         18.12% |    12.41% | -5.71 points | improvement |
| Capacity-bound unmet intent  |         13.01% |    14.38% | +1.36 points | worse       |
| Physical sell-through        |         90.25% |    90.19% | -0.06 points | pass        |
| Labour staffing              |         93.25% |    93.12% | -0.13 points | pass        |

The rule works mechanically: 1.30% of fulfillment used the added willingness
to pay, and price-tolerance rejection fell 5.71 points. Economically, however,
it mostly moved the binding constraint from willingness to pay into freight
capacity. It did not produce the required quantity response. The worst
country-level effect was France at -2.69 points, inside the 5-point guardrail.

Decision: keep `shortageResponsiveSourcingEnabled` off. The code remains a
dark, governed research control. It must not be activated on this evidence.

## Freight and combined result

The billing-only arm retained the production and labour repair: pooled fill
was 83.26%, physical sell-through was 90.87%, labour staffing was 93.25%, and
no measured sector sat at the throughput floor. Buyer-intent fulfillment was
63.02% and the nonlocal share was 26.08%. These levels are not evidence of a
billing effect because the arm must first be compared with the active-settlement,
billing-off live-policy control.

The transfer itself conserved money to rounding precision. Across the terminal
12 turns, the billing-only arm recorded A191,214,450.51 of buyer charges and
A191,214,450.66 of hauler revenue, a 15-cent aggregate difference. The largest
single-turn difference was 13 cents. The combined arm recorded A239,340,853.04
of charges and A239,340,853.27 of revenue, a 23-cent aggregate difference.

Adaptive sourcing still failed when layered on billing:

| Measure                      | Billing only | Combined |        Delta | Gate        |
| ---------------------------- | -----------: | -------: | -----------: | ----------- |
| Pooled goods fill            |       83.26% |   83.37% | +0.10 points | fail        |
| Country-scoped fill          |       73.54% |   73.57% | +0.03 points | neutral     |
| Buyer-intent fulfillment     |       63.02% |   64.13% | +1.11 points | fail        |
| Nonlocal fulfillment share   |       26.08% |   27.64% | +1.56 points | improvement |
| Tolerance-bound unmet intent |       19.91% |   15.37% | -4.54 points | improvement |
| Capacity-bound unmet intent  |        7.70% |   12.87% | +5.17 points | worse       |
| Physical sell-through        |       90.87% |   91.03% | +0.16 points | pass        |
| Labour staffing              |       93.25% |   93.26% | +0.01 points | pass        |

The worst country effect was Spain at -3.73 points, inside the 5-point
guardrail. The treatment again reduced price-tolerance rejection while moving
the binding constraint into capacity, without the required quantity response.
This confirms the earlier decision to keep adaptive sourcing off.

Against that live-policy control, billing changed pooled fill by -0.15 points,
country-scoped fill by +0.04 points, buyer-intent fulfillment by +0.27 points,
and nonlocal fulfillment by +0.30 points. Sell-through rose 0.06 points and
staffing fell 0.10 points. Romania had the worst country fill effect at -0.75
points. The transfer is correctly conserved, but it does not produce a
material allocation or production improvement.

Decision: keep `canonicalFreightBillingEnabled` off. Conservation is necessary
for a transfer rule, but it is not an economic activation benefit.

## Securities result

The observer separates the sovereign and corporate bond markets, measures
trading participation, order-book depth, quoted spread, execution latency, and
price impact. The candidate bond facility keeps 5% of index-fund backing in
cash and targets 20% in sovereign paper. Its auction allocates equal notional
amounts across eligible issues and redistributes unused slices as issues fill.

The gate-off path was regression-tested against the production allocator. It
continues to call the original reserve process and uses the original sequential
auction budget. Only the enabled treatment selects the 20% target and
diversified auction. This preserves the counterfactual and prevents a dark gate
from changing live behavior.

| Measure                             | Live control | Bond target |         Delta |
| ----------------------------------- | -----------: | ----------: | ------------: |
| Sovereign issues with no holder     |       76.92% |      56.17% | -20.75 points |
| Fund-held sovereign units, endpoint |        1.58m |       4.68m |        +3.10m |
| Fund cash, endpoint                 |       A1.61b |      A0.92b |       -A0.69b |
| Listings traded in 48 turns         |       25.39% |      34.85% |  +9.46 points |
| Two-sided equity books              |        0.00% |       0.00% |          0.00 |
| Open depth / market capitalization  |        0.42% |       0.42% |  -0.00 points |
| Pooled goods fill                   |       83.41% |      83.61% |  +0.20 points |
| Country-scoped fill                 |       73.50% |      73.88% |  +0.38 points |
| Buyer-intent fulfillment            |       62.74% |      62.99% |  +0.25 points |
| Labour staffing                     |       93.35% |      93.17% |  -0.18 points |

The facility is mechanically effective but incomplete. It cut unheld
sovereign issues by 20.75 points and kept all 34 active funds fully backed.
At the endpoint, however, 340 of 600 sovereign issues still had no holder,
well above the below-35% program target. Countries with active domestic funds
reached zero unheld issues; countries without them commonly retained 20 to 31
unheld issues out of 32. Finland had the worst country fill effect at -4.23
points, inside the 5-point guardrail.

Decision: keep `indexFundBondLiquidityEnabled` off. The next design must
consolidate issuance or widen policy-safe investor access rather than increase
the cash target again. Follow-up implementation is tracked in #1001.

## Relevant-market competition

The aggregate listed-firm concentration measure concealed which markets are
economically exposed. The new commodity cross-section measures sellers,
buyers, common-control ownership groups, fill, and the largest ownership
group's supply share.

At turn 485 the live-policy control's seller-side high-concentration,
low-fill markets were advertising, freight, and rare earths. Advertising
combined 22.42% fill with an 80.40% largest-supplier share. Freight combined
62.28% fill with a 62.53% largest-supplier share. Rare earths combined 66.27%
fill with a 93.56% largest-supplier share. Fertilizers were also fragile on the
buyer side, with 66.87% fill and buyer HHI of 2,828. These markets need
targeted entry and capacity policy. An economy-wide concentration cap would
be poorly identified and is not recommended.

Follow-up implementation is tracked in #991.

## Money and accounting

The candidate changes preserve separate tests for trial balance, stock versus
flow, and money-supply attribution. Intentional, named issuance and retirement
are economic flows, not accounting failures. Bond investment, dividends,
credit principal and interest, fund subscriptions and distributions, escrow,
corporate-group relief, pensions, public salary, fundraising, and internal
party transfers now receive explicit semantic reasons.

The turn-485 live-policy control had 8,640 ledger entries and zero unbalanced
entries. Its money-supply test was green across 24 currency-area readings and
the unattributed bucket was empty. The bond treatment also had a green trial
balance and money-supply test with no unattributed category. The
stock-versus-flow test remained amber with 1,097 divergent modeled accounts in
control and 1,103 in treatment. The semantic repair closes false attribution
alarms without waiving that separate coverage backlog.

The remaining account-lifecycle and snapshot-coverage work is tracked in #992.

## Deterministic stress tests

The stress suite is a transparent comparative-statics exercise. It does not
pretend that a static haircut is a dynamic forecast. Each result names the
first failure, propagation path, exposure basis, and declared recovery review
horizon.

| Scenario                         | Severity | First failure              |                                 Exposure | Review horizon |
| -------------------------------- | -------- | -------------------------- | ---------------------------------------: | -------------: |
| Largest supplier failure         | critical | advertising                | 31.03m unmet units; A421.39m value basis |       24 turns |
| 50% freight-capacity shock       | high     | nonlocal buyer intent      |              fulfillment falls to 53.96% |       24 turns |
| 12-turn exchange closure         | high     | secondary equity liquidity |          A23.71m normal notional trapped |       24 turns |
| 10% synchronized liquidation     | critical | bid depth                  |       4.14% absorbed; A4.06bn unabsorbed |       24 turns |
| 50% dormant-balance reactivation | high     | goods absorption capacity  |        30.18% broad-money demand impulse |       12 turns |

The loss figures are exposure bases, not predictions of realized losses. The
stress results support targeted supplier-entry work, freight resilience, and
an equity-liquidity design. They do not support activating the failed sourcing
lever.

The two-sided equity and execution-quality work is tracked in #990.

## Reproduction

Each world arm was launched in a memory-capped transient systemd unit. The
control command was:

```text
npx tsx scripts/sim/runWorld.ts \
  --seed=issue-968-live-435 --preset=1953-default --turns=48 \
  --db=ahd_sim_i968_control_20260827 --run-id=issue968-control-20260827 \
  --clone-mode --market-mode=plants --labour-mode=full \
  --freight-settlement=shadow --canonical-freight-billing=false \
  --shortage-responsive-sourcing=false
```

The live-policy control used the same command with
`--freight-settlement=active`, `--canonical-freight-billing=false`, and
`--index-fund-bond-liquidity=false`. Its paired treatment changed only the
last value to `true`. The billing and combined arms retained active settlement,
set canonical billing to `true`, and differed from each other only on adaptive
sourcing.

Comparable terminal medians and country guardrails are generated with:

```text
npx tsx scripts/sim/economicExperimentReport.ts \
  --dbs=<control>,<treatment> --refresh
```

Stress findings are generated with:

```text
npx tsx scripts/sim/economicStressTests.ts --db=<sandbox>
```

## Rollout decision

- Ship P0 through P7 observability, concentration diagnostics, experiment
  controls, intervention-plan validation, attribution semantics, and stress
  tests.
- Keep adaptive sourcing off because its fulfillment effects miss the target.
- Keep canonical freight billing off because conservation passes but economic
  benefit is immaterial. Do not alter the live freight-settlement mode.
- Keep the sovereign bond facility off because its 56.17% unheld-issue result
  misses the below-35% target despite a material improvement.
- Preserve every activation behind a plan with target, guardrail, cohort,
  ramp, review turn, rollback owner, trigger, and action.
- Promote only after the aggregate CI, staging smoke check, and production
  smoke check pass.
