# Corporate specialization: operating return validation

Issue #1608. Control source: `77d7d3ce0852c41e876f1f82b6303953a2f32d81`.

The candidate raises the primary industry operating margin bonus from 5 to 10 percentage points and the secondary bonus from 2.5 to 5. The payroll basis retains its previous specialization modifiers. Unrelated-industry penalties, state-enterprise exemptions, margin caps and bond rules remain unchanged.

## Controlled operating comparison

The real corporation processor was replayed on captured turn-719 inputs from a turn-718 world. Both revenue governors were fully expired in memory for the settled comparison. Prices, clearing results, production decisions, capacity, staffing, time and random seed were held constant. Each arm repeated identically. The control also exactly reproduced the original control aggregates before the formula was extracted.

The cohort contains 88 player-controlled corporations and 1,177 sectors. CEO identifiers were checked against the character collection. No player identifiers or individual records are included here.

| Settled player-sector outcome, per turn |     Control |   Candidate |
| --------------------------------------- | ----------: | ----------: |
| Revenue, anchor                         |  97,600,265 |  97,600,265 |
| Operating profit, anchor                |  48,012,183 |  51,327,971 |
| Losing sites                            |         172 |         152 |
| Jobs                                    |   1,485,053 |   1,485,053 |
| Labour cost, anchor                     |  24,991,217 |  24,991,217 |
| Produced units                          | 260,195,816 | 260,195,816 |

Operating profit improves 6.91% and losing sites fall 11.63%, without a production, employment or wage reduction. This is a direct operating effect, not evidence of additional demand or future investment by players.

Expiring transition protection changes the baseline substantially. For example, logistics profit falls from 20.43 million to 0.99 million anchor with the same staffing. Current supported revenue must not be extrapolated as permanent investment income. The forecast now requires both governors to have expired in the observed operating turn.

## Equal-capital investment scenarios

Each scenario commits 100,000 anchor. Construction uses the captured strategy, build duration, local market share, competitors, prime rate, business acumen, technology, host price level and currency spread. It deducts allocated corporation overhead, a fixed 20% marginal tax assumption, and replacement reserves while capacity depreciates. This is cash funded, so borrowing cost is zero. Cash returns exclude the retained plant's value.

The table includes chosen-industry sectors with no retool or mothball, an open build queue, expansion no greater than 10% of existing capacity, and enough captured unmet demand for the entire incremental sales run. This is a market-room screen, not a complete feasibility or permissions check. In particular, resource availability and future staffing must also support an expansion.

| Sector        | Cases | 48 turns, control / candidate | 96 turns, control / candidate | 192 turns, control / candidate |
| ------------- | ----: | ----------------------------: | ----------------------------: | -----------------------------: |
| Energy        |    66 |                9.65% / 11.18% |               28.25% / 32.72% |                64.13% / 74.29% |
| Manufacturing |    37 |               16.07% / 17.88% |               40.88% / 45.49% |                88.76% / 98.77% |
| Extraction    |    21 |                 3.83% / 5.22% |               11.22% / 15.29% |                25.48% / 34.71% |
| Retail        |     1 |               -0.61% / -0.41% |               -1.27% / -0.87% |                -2.56% / -1.75% |

Values are medians of fixed-price, fixed-demand scenarios, not realized investment returns. Logistics and real estate have no qualifying 100,000-anchor cases in this capture. The retail case remains loss-making. Raising operating bonuses does not create buyers or justify expanding an oversupplied industry.

Revenue-linked policy credits and charges follow forecast sales, not production. A zero-buyer expansion receives no additional specialization credit. Existing production costs and upkeep remain payable. This corrects a forecast error that could otherwise overstate the benefit in a glut.

## Bond comparison and limits

The captured market contains 452 non-defaulted, unmatured quotes with enough public float for a 100,000-anchor purchase. Quotes use the game's actual ask and bid formulas and pool state. All have enough quoted exit depth at capture, which is not a guarantee of future liquidity or eligibility for a particular holder.

A single purchase, held until each horizon or maturity, produces the following modeled net returns. Coupons and positive gains use the same 20% tax assumption. These scenarios assume no default, unchanged exchange rates and resale bids, no reinvestment after maturity, and cash already in the bond's currency. Cross-currency buyers would also pay conversion costs.

| Horizon   | Median modeled net return | Median coupon cash |
| --------- | ------------------------: | -----------------: |
| 48 turns  |                     2.24% |              3.72% |
| 96 turns  |                     4.65% |              5.48% |
| 192 turns |                     4.78% |              5.96% |

Bond net return includes spread or redemption gain/loss after recovering purchase principal. Sector cash return excludes any plant resale value and leaves capital committed to the plant. These are different liquidity profiles.

This quote-based comparison does not model an active arbitrage strategy that buys new mispricings or reinvests proceeds. Earlier observed closed trades also had different holding periods and incomplete coupon coverage. Neither dataset proves a repeatable arbitrage return at all three horizons. The candidate improves productive sector returns; it does not establish that sectors outperform every bond strategy.

## Reproduction

Run `npx tsx scripts/sim/sectorOperatingReturns.ts` for public deterministic reference cases. They exercise the shipped construction and forecast rules, equal capital, unchanged sales and replacement, and zero-buyer cases. Reference inputs are illustrative, separate from the captured-world aggregates above.

Regression coverage includes the payroll clamp, both revenue governors, sales-linked policy credits and the real sector calculation suites. Captured source documents remain private. The captured processor input has SHA-256 `93573832d8d9de0a76b800c668c64b32e598c2dcf5377e9c95ab8b148327a1d5`.

## Full-engine stress and read cost

The paired short stress run starts from the same local world at turn 718, pins the clock and seed, and preserves gameplay configuration. Human actions and logins are not synthesized. Autonomous decisions can diverge after the initial turn, so this complements the deterministic operating comparison rather than replacing it.

Both arms completed turns 719 through 730, with every phase completed or skipped and no turn warnings. Means over those 12 turns:

| Original player-cohort outcome              | Candidate versus control |
| ------------------------------------------- | -----------------------: |
| Sector revenue                              |                  +0.085% |
| Sector operating profit                     |                  +8.274% |
| Losing sites                                |                 -10.449% |
| Jobs                                        |               +0.000059% |
| Labour cost                                 |                  +0.065% |
| Corporation operating profit after overhead |                  +9.152% |
| Corporation income                          |                  +9.374% |
| Government annual revenue                   |                  +0.130% |

This short current-world run does not establish long-run equilibrium after transition protection expires. The separate settled comparison establishes the immediate operating effect at fixed market conditions.

Read cost was measured in separate production-mode local profiles of the first turn, with Mongo command monitoring enabled:

| Read measure                  |     Control |   Candidate |
| ----------------------------- | ----------: | ----------: |
| Corporation phase round trips |       1,751 |       1,719 |
| Corporation phase BSON bytes  |  82,993,388 |  82,947,758 |
| Whole-turn round trips        |      21,387 |      21,421 |
| Whole-turn BSON bytes         | 312,812,958 | 312,813,759 |

The rules add no database reads. Autonomous decisions account for differences in downstream operations. No read-budget increase is required. Earlier test-mode stress telemetry is not used for read-cost claims because that mode disables Mongo command monitoring.

Subsequent upstream election, military interface and access changes were reviewed separately; they do not change these corporation or market rules.

## Integration with monetary-accounting changes

A second pair starts from the same turn-718 capture on control `54b4766d721b4d66505322a6c77bcd1966fbfef8` and candidate `855aedbc9a8c0caa5eb73f2e4b06675fdd116678`. Both include the separately merged monetary-accounting and union-funding update, which affects downstream economic inputs. Both complete turns 719 through 722 with every phase completed or skipped and zero turn warnings. Means over these four matched turns:

| Original player-cohort outcome              | Candidate versus control |
| ------------------------------------------- | -----------------------: |
| Sector revenue                              |                  -0.035% |
| Sector operating profit                     |                  +7.889% |
| Losing sites                                |                 -11.022% |
| Jobs                                        |                  +0.000% |
| Labour cost                                 |                  -0.078% |
| Corporation operating profit after overhead |                  +8.847% |
| Corporation income                          |                  +9.090% |
| Government annual revenue                   |                  +0.035% |

Revenue and aggregate wages decline slightly in this integration path. Those declines are retained in the result; the candidate does not create additional demand. The fixed-input comparison establishes equal payroll at each player site, while the full-engine paths allow market conditions and autonomous decisions to change. Employment remains identical across the matched integration means.

Production-mode first-turn monitoring records corporation round trips of 1,747 / 1,715 and BSON bytes of 82,938,542 / 82,892,912 (control / candidate). Whole-turn round trips are 21,317 / 21,345 and BSON bytes 307,936,599 / 307,906,523. No read-budget increase is required.

An earlier integration attempt was interrupted by the local simulation database restarting under host memory pressure. It is excluded; both accepted arms start from fresh copies. Neither short stress establishes long-run equilibrium or an active bond-arbitrage return.
