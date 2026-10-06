# Corporate maturity-liquidity sensitivity for #2326

The source-derived principal cliff changes from A/69 to BBB/53 before repayment. A new 48-turn coupon quote at prime 5 changes from 7.5% to 9%. Covered and distant maturities preserve the previous score.

Run `npx tsx scripts/sim/corporateMaturityRisk2326.ts` to reproduce the [JSON matrix](corporate-maturity-risk-2326.json). The harness calls the production corporate-credit and default-refinance quote functions. Omitting the maturity option reproduces the scoring policy at baseline `ad4089c995be12873da90a3941ece949b8e1c873`. These are synthetic balance sheets, with no live player data.

| Fixed scenario     | Previous rating/score | Candidate rating/score | Previous new coupon | Candidate new coupon |
| ------------------ | --------------------- | ---------------------- | ------------------- | -------------------- |
| distant            | A/69                  | A/69                   | 7.5%                | 7.5%                 |
| next-turn-cliff    | A/69                  | BBB/53                 | 7.5%                | 9%                   |
| due-now-cliff      | A/69                  | BBB/53                 | 7.5%                | 9%                   |
| overdue-cliff      | A/69                  | BBB/53                 | 7.5%                | 9%                   |
| cumulative-cliffs  | A/66                  | A/58                   | 7.5%                | 7.5%                 |
| covered            | AA/70                 | AA/70                  | 6.5%                | 6.5%                 |
| operating-loss     | BBB/48                | BB/31                  | 9%                  | 11%                  |
| live-default-floor | CCC/12                | CCC/12                 | 18%                 | 18%                  |
| recovered          | AA/70                 | AA/70                  | 6.5%                | 6.5%                 |

The next-turn case supplies cash 20 million, annual operating income 10 million, sector NPV 100 million, principal 100 million and annual coupons 5 million. The same ratios reproduce the issue's 20/10/100/100/5 example. Income accrues only through each future date; current and overdue principal receive no extra turn of income. Principal accumulates across dates, so later obligations cannot reuse cash already required by earlier obligations. The current coupon is reserved even for a same-turn maturity.

The liquidity component is the smaller of the existing coupon-only component and forecast debt-service coverage in percentage points. Existing composite weights, rating thresholds, concentration/index adjustments and default floor remain unchanged. Turn scoring still smooths once; persisted read-only scores remain verbatim. Outstanding defaulted debt remains in the debt ratio, while its old maturity is excluded from the cashless replacement forecast.

| Forced replacement quote               | Previous coupon | Candidate coupon | Additional forecast proceeds |
| -------------------------------------- | --------------- | ---------------- | ---------------------------- |
| healthy-cashless-roll                  | 6%              | 6%               | 0                            |
| unfunded-cashless-roll                 | 7.5%            | 7.5%             | 0                            |
| cashless-roll-with-other-near-maturity | 7.5%            | 9%               | 0                            |

A forced replacement transfers existing holders into new paper without providing cash. The preview therefore credits no replacement face as liquidity, preserves the established fundamentals-only quote for the debt being cured, and evaluates any other live near maturity. Optional new borrowing is not assumed to succeed. This report does not qualify investor funding capacity.

The 24-turn half-year horizon is a provisional authored policy, not an empirically calibrated coefficient. The JSON includes 12-, 24- and 48-turn sensitivity for a maturity at turn 124: it is absent from the 12-turn window and included in the two longer windows. The forecast holds operating income and current coupon run rate fixed. Existing sector-income estimates omit corporate overhead and taxes. UI debt-repayment previews allocate repayments proportionally across current principal because the slider does not choose a particular bond.

The turn already loads the maturity, principal and currency fields used here; no additional maturity query or database write is introduced. The portable rule groups and sorts supplied maturity dates. This is a source-path observation, not a measured whole-turn performance improvement.

Focused regressions cover cumulative and same-date obligations, overdue/current principal, the inclusive horizon boundary, losses, covered repayments, malformed input, cross-currency equivalence, default-floor dominance, one-time smoothing/persisted displays, refinancing with another near maturity, and existing coupon/settlement/default/relocation behavior.

A forecast principal gap does not by itself prove an actual default: the existing default and exit-solvency detector has separate criteria. Scenario counts are not a rating distribution or observed default prevalence. There is no endogenous cash, asset sale, player choice, optional investor funding or world-level feedback in this matrix. Source-pinned sandbox qualification of rating distributions, refinancing capacity and default incidence remains required before closing #2326.
