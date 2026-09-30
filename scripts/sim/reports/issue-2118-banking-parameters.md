# Banking parameter review (#2118)

## Decision and scope

Retain the current deposit-capacity constant, reserve bounds, rate corridors/floors and insurance premium. This bounded review found no supported reason to change those values. It exercises real funded banking and reports the costs of the existing default policy; it does not establish long-run economy-wide optimality or guarantee profitable banks.

The issue asks for a separate tuning pass and a conservation/liquidity/default/player report for each change. This pass changes no production parameter. No activation, migration, balance rewrite or player policy change is included.

## Provenance and reproduction

- Clean replay/source commit: `458c60a05cfa11bacf2552d8ab1238422f7f8a83`.
- Banking-enabled retained context: `ahd_sim_financial2154_final_1184c`, accepted #2154 source `1184cdd81dd0da3b7137afac72496a80a681c77d`.
- Retained input digest: `797d474072a54f2bb53259650fead0352288b2f3eda3df77c168a08a5bdd2d27`. Re-read once after all 26 scenarios: unchanged.
- The retained context has nonzero private deposits and loan books. The earlier 480-turn source with banking off is **not** used as a banking baseline.
- 26 scenarios, 12 actual banking plus solvency turns each (312 passes), with 312 same-turn banking retries. These are hypothetical funded cases using retained USD/GBP/IEP FX, prime rates, era and monetary/fiscal context. They are not additional whole-world runs.
- Source bank balances are disclosed in JSON but replaced in each isolated fixture with a fresh, funded bank. In particular, the retained GBP rescue capital is not treated as a healthy baseline.

```bash
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ npx tsx --tsconfig tsconfig.json \
  scripts/sim/bankingParameterReplay.ts \
  --source=ahd_sim_financial2154_final_1184c \
  --target=ahd_sim_bank2118_reproduction \
  --out=/tmp/banking-parameter-review.json
```

The target must be new, named `ahd_sim_*`, and distinct from the source; the runner accepts only local sandbox port 27018. Each case resets only its exclusively created target. Only the last case remains in the database; all 26 timelines are archived in [the JSON report](./issue-2118-banking-parameters.json). `--case=baseline_USD_retail,named_default` selects a bounded subset. Acceptance requires a clean checkout; `--development=true` is explicitly not accepted provenance.

## Setup and actual paths

Each case explicitly constructs a charter, corporate borrower and saver. Bank capital is 10M Anchor equivalent, saver funding 100M equivalent, converted with actual local-per-Anchor FX. Whole-unit capital injection rounding leaves any remainder in the company treasury. Financial-sector capacity is 250 units. Every funding/revenue/loss flow debits the observed household monetary pool or borrower and credits its counterparty through `settleTransition`; setup creates no cash.

The borrower has disclosed hypothetical 12-turn income history of 30M equivalent per turn. A healthy case receives that amount through an actual household-to-business cash transfer each turn. The named loan requests up to 85M equivalent and is restricted by production reserve/headroom and underwriting. The default scenario transfers the disbursed loan back to households as an operating loss and receives no further revenue. These are controlled borrower scenarios, not claims about historical firms or empirically estimated default frequencies.

Production APIs used: `injectBankCapital`, `runSavingsCommand`, `setBankRates`, `setBranchCapacityShare`, `setReserveRequirement`, `originateLoan`, `drawDiscountWindow`, `ensureFund`, `processBankingTurn`, `processBankSolvencyTurn`. Investment charters refuse deposits and lend from own cash. The investment fixture's starting lending offset is explicit configuration; it is not an invented public deposit-rate action.

## Reviewed constants and controls

| Area               | Existing rule                                                                                                                                 | Experiment                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Deposit capacity   | 1,200,000 native face per capacity unit; default branch share 50%, allowed 10%-90%; NPC ceiling 12x book equity                               | 250-unit baseline, 10%/90% branch share; report physical and equity binding ceilings                |
| Reserves           | Defaults 10% modern / 20% historical; bounds 5%-95%                                                                                           | Retained default plus 5%, 20%, 50%, 95%                                                             |
| Rates              | Modern deposit offset -4 to +0.5pp, lending +0.25 to +8pp; historical deposit -4 to -0.5pp, lending +0.5 to +6pp; country overrides respected | Actual retained modern corridors, endpoints, NPC default targeting, and clamped new-charter offsets |
| Annual rate floors | Deposit 0.05%; lending 0.1%                                                                                                                   | Low-rate endpoint/floor outcomes captured                                                           |
| Named credit       | 35% demonstrated-income DTI, 12-turn corporate income window; character spread 1.5pp                                                          | Actual corporate underwriting and full 12-turn repayment or 8-turn arrears default                  |
| Insurance          | Annual premium 0.4% of capped insured exposure, reserve-risk weight bounded 0.5-3; insured reference 5M USD with era scaling                  | Actual premium transfers, reserve sensitivity and default waterfall                                 |
| Discount window    | Prime +3pp, 25% deposit-base cap                                                                                                              | Funded draw plus 60% withdrawal request; explicit mint, debt and interest recipient                 |

Capacity experiments change the permitted branch allocation, not the 1.2M production constant. This probes effective banking capacity but does not claim a separate commodity-output equilibrium. The reserve 20% case probes the historical default ratio in the same retained modern-rate context; it is not a historical-era cohort. No separate origination or withdrawal fee exists in the reviewed paths; insurance and facility costs are reported by their actual names.

## Results

Money columns below are Anchor equivalent; the headings distinguish whole units from millions. Full native-currency stocks, FX, player claims, capital, reserve surplus, cash buckets, actual rates and turn receipts remain in JSON. Net income is the production banking-income receipt including deposit interest, defaults, insurance and facility costs, counted only on the turn it was stamped.

| Case                              | Named loan (M Anchor) | Net banking income (M Anchor) | Insurance premium (Anchor) | Loan writeoffs (M Anchor) | Final bank | Withdrawal |
| --------------------------------- | --------------------: | ----------------------------: | -------------------------: | ------------------------: | ---------- | ---------- |
| baseline_USD_retail               |                85.000 |                        0.7655 |                    4131.78 |                    0.0095 | active     | -          |
| baseline_USD_universal            |                85.000 |                        0.7655 |                    4131.78 |                    0.0095 | active     | -          |
| baseline_USD_investment           |                10.000 |                        0.0859 |                       0.00 |                    0.0000 | active     | -          |
| baseline_GBP_retail               |                85.000 |                        0.7730 |                    4581.30 |                    0.0092 | active     | -          |
| baseline_GBP_universal            |                85.000 |                        0.7730 |                    4581.30 |                    0.0092 | active     | -          |
| baseline_GBP_investment           |                10.000 |                        0.0891 |                       0.00 |                    0.0000 | active     | -          |
| baseline_IEP_retail               |                85.000 |                        0.5067 |                    4549.02 |                    0.0074 | active     | -          |
| baseline_IEP_universal            |                85.000 |                        0.5067 |                    4549.02 |                    0.0074 | active     | -          |
| baseline_IEP_investment           |                10.000 |                        0.1109 |                       0.00 |                    0.0000 | active     | -          |
| capacity_0.1                      |                23.433 |                        0.2079 |                    2169.70 |                    0.0022 | active     | -          |
| capacity_0.9                      |                85.000 |                        0.7655 |                    4131.78 |                    0.0095 | active     | -          |
| reserve_0.05                      |                85.000 |                        0.7716 |                    4132.76 |                    0.0106 | active     | -          |
| reserve_0.2                       |                80.000 |                        0.7136 |                    4110.74 |                    0.0079 | active     | -          |
| reserve_0.5                       |                50.000 |                        0.4394 |                    4264.35 |                    0.0049 | active     | -          |
| reserve_0.95                      |                 5.000 |                        0.0261 |                    6623.21 |                    0.0005 | active     | -          |
| deposit_low                       |                85.000 |                        0.7655 |                    4131.78 |                    0.0095 | active     | -          |
| lending_low                       |                85.000 |                        0.3235 |                    3938.89 |                    0.0129 | active     | -          |
| deposit_high                      |                85.000 |                       -0.0645 |                    3874.12 |                    0.0095 | active     | -          |
| lending_high                      |                85.000 |                        1.1776 |                    4280.25 |                    0.0055 | active     | -          |
| new_charter_rates                 |                85.000 |                       -0.3743 |                    3721.43 |                    0.0129 | active     | -          |
| withdraw_20                       |                85.000 |                        0.7473 |                    6091.93 |                    0.0062 | active     | paid       |
| withdraw_60                       |                85.000 |                        0.7655 |                    4131.78 |                    0.0095 | active     | refused    |
| withdraw_60_window                |                85.000 |                        0.4061 |                    4024.71 |                    0.0095 | active     | refused    |
| named_default                     |                85.000 |                      -85.0057 |                    2055.11 |                   85.0009 | failed     | -          |
| tight_capacity_expensive_deposits |                24.735 |                       -0.1165 |                    2169.70 |                    0.0031 | active     | -          |
| high_reserve_expensive_loans      |                 5.000 |                        0.0503 |                    6635.81 |                    0.0003 | active     | -          |

### Player and public outcomes

- All nine charter/currency baseline banks stay active and all nine named loans repay. The six deposit-taking baselines earn between 0.507M and 0.773M Anchor over 12 turns; their savers gain between 12,501 and 469,758 Anchor. Investment charters refuse deposits and leave the saver's 100M-equivalent wallet intact.
- The 20% withdrawal pays. Its immediate reserve surplus is -3.0M Anchor, then actual servicing restores liquidity; the bank remains active. The 60% request is refused without changing the account. Even the 25M-equivalent window draw leaves insufficient cash for 60%, so that request is still refused.
- The window creates exactly 28,805,888 USD, records matching bank debt, and charges 414,084.64 USD to the central-bank reserve account over 12 turns. Its bank stays active and the named loan repays.
- The unpaid 85M-equivalent loan defaults on turn 8 and the bank fails. Player claim 115,233,155.69 USD (including 9,602.32 interest) returns to central-bank holding. Actual fund premiums of 2,367.98 USD fund only a small part of the payout; the named treasury backstop is 88,487,937.46 USD (76.797M Anchor), explicitly minted and booked as fiscal cost. All other cases have zero backstop.
- Existing clamped new-charter rates lose 0.374M Anchor in this deposit-heavy, amortizing-loan case. High deposit rates lose 0.064M; the low-capacity/high-deposit/low-lending combination loses 0.116M. Those losses consume shareholder equity and are included in the review; they are not omitted from the recommended unchanged-parameter decision.

## Conservation and retry findings

Maximum absolute cash reconciliation error across all recorded steps: **0.005859375 native units**, within the numerical bound on trillion-unit retained pools. No partial/claimed settlement remains at any checkpoint. Every same-turn banking retry processes zero banks and leaves all observed business stocks unchanged.

The stock sum counts holding-company cash, bank vault cash, player wallets, household monetary pool, insurance cash, central-bank reserve cash and positive spendable treasury cash. Savings claims are reported separately to avoid counting the same vault/pool backing twice. The signed treasury fiscal position is also reported separately: a negative position is a public obligation, not spendable cash. Each stock delta must equal the journal's applied explicit mints minus burns. Bank-loan writeoffs are asset losses, not cash destruction.

Facility interest actually credits central-bank reserve cash. The default insurance waterfall explicitly mints deficit-financed support and records the equal treasury fiscal cost; the report includes both. No cash adjustment or unexplained balancing leg is added by the runner.

## Interpretation, ramp and rollback

- Baseline viability, liquidity limits, borrower outcomes, reserve restrictions and public-tail costs should be read together. High reserves deliberately restrict credit; rate extremes can reduce bank income or household demand. Neither zero defaults nor a guaranteed profit is a calibration target.
- The 12x equity ceiling can bind before the physical branch ceiling. Raising the branch share alone therefore need not create proportionally more deposits. The default capacity constant remains consistent with the authored 150M face baseline at 250 units/50% share.
- Low prime plus a low deposit offset reaches the explicit savings floor. The high-deposit/low-lending joint case exposes margin pressure rather than assuming all permitted rate choices are profitable.
- The authoritative failure path protects the complete savings claim with a treasury backstop. The capped insured reference affects the premium base; it does not imply a 5M haircut cap in this path. Public fiscal exposure is real and must not be described as insurer-funded or cost-free.
- Twelve turns and three currencies are a bounded sensitivity review, not a long-run premium adequacy estimate. A future change to coverage policy or premium adequacy needs an explicit loss-distribution decision and report; this pass does not invent either.

**Ramp:** none, because every production constant and banking activation flag is unchanged. Future supported tuning should change one parameter at a time in sandbox and compare the same cash/depositor/default receipts before staged rollout. **Rollback:** revert this reporting-only PR to remove the harness; no gameplay/data rollback is required. If a later parameter change is approved, restore the prior value through the same parameter/configuration path and recheck outstanding contracts without rewriting historical balances.

## Verification

Focused ESLint and Prettier passed for the runner. The complete source-pinned sandbox matrix supplies execution checks. Full repository verification and build are required from the final PR CI head.
