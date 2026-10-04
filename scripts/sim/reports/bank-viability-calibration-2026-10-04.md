# Bank viability calibration, 2026-10-04

This deterministic local model uses the 1991 US budget, rate, savings APY,
capital, branch ceiling, loan, fee, premium, sovereign issuance, pool quote,
funded Treasury claims, confidence, deposit flight, and failure rules. It uses a
representative bank with $5 million opening capital, 250 units of
financial-sector capacity, a 50% branch share, and a $150 million deposit
ceiling. It does not read or mutate a world database.

The model opens the pool at the production migration value of 5% of 1991 M2
($201.5B), then applies production pool inflow and finite funded primary issuance.
Spendable Treasury cash starts at zero and grows only from actual pool-funded
bond proceeds. Public-float and bank-holder coupons and maturities use one
frozen per-bond claim. The claim pays both holder groups from the same Treasury
cash debit and remains due until fully paid. The signed fiscal position stays
an analytics track. Treasury accrual revenue and spending are not settled into
the new spendable cash ledger, so that ledger is not a complete national
budget cash model.

| Scenario                                                                                                   | Annualized ROE at failure | Equity at failure | Outcome                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------: | ----------------: | ---------------------------------------- |
| 1991 seed, balanced profile, current rates, pool seeded at 5% of M2                                        |                     1.54% |           $30.66M | Deposit run at turn 55                   |
| 1991 midpoint rates, balanced profile                                                                      |                    -2.21% |           $28.30M | Deposit run at turn 55                   |
| 1991 aggressive legal maximum deposit and minimum lending rates, 5-point prime shock scheduled at turn 240 |                    -4.61% |           $16.70M | Deposit run at turn 54, before the shock |
| 1991 balanced profile with a 10.67% premium sensitivity                                                    |                     3.61% |           $18.78M | Deposit run at turn 54                   |

These are not viability passes. The first seeded 1991 reconciliation tranche
places 25% of $3.665T opening sovereign principal into a bond due at turn 48.
That $916.25B public-float claim remains unpaid. The modeled pool follows the
production two-percent inflow toward target, and quarterly underwriting cannot
exceed actual pool cash. By the balanced case's failure, Treasury cash is
$336.87B and pool cash is $62.34B, against the original $916.25B due claim.
The model correctly retains the bond and claim instead of erasing the debt or
counting unpaid proceeds as bank income. The aggressive case fails before its
turn-240 recession shock, so it does not establish the requested recession
failure behavior. The earlier model result that reached turn 240 had removed
unpaid matured obligations and was invalid.

The funding gap corresponds to a production boundary: `treasuryTurn` records
macro revenue, spending, and debt service in the signed fiscal accrual, while
the funded Treasury cash ledger currently receives cash from funded sovereign
issuance and explicit funded receipts. It does not receive the modeled annual
tax revenue as cash. Treating the signed balance or revenue field as spendable
cash would double-count analytics or create cash without a payer debit. Until a
cash-conserving tax and budget flow exists, the model cannot claim sovereign
rollover, bank liquidity, rescue, or whole-system viability. No seed debt,
opening cash, pool capacity, or coupon yield was fabricated to make the
scenario pass.

The provisional insurance premium remains 0.4% annualized before the existing
reserve risk weight. This change adds a separate measured cohort: annual
insured-deposit exposure turns, actual gross insurance shortfalls, paid claim
count, and recoveries attributable to resolutions opened after evidence
measurement began. Pre-measurement estates do not supply recovery credit.
The measured rate is same-cohort net claims per insured deposit-year plus a
bounded reserve refill: a target of one year of observed net claims, refilled
over five years. It is blended with the provisional rate by credibility, the
product of measured years over ten and paid claims over three (each capped at
one), so a fund moves toward its measured rate gradually and never jumps on a
threshold turn. The base rate never falls below 0.4% and never exceeds 2%
before the existing 0.5x to 3x risk weight, so one large failure in a thin
cohort cannot price surviving banks into a failure spiral; losses beyond what
the ceiling funds fall to the funded Treasury backstop. Premium collection is
still limited by actual bank cash, and the existing shortfall path records any
unpaid premium. No modeled scenario reaches a paid claim before its failure
turn, so every row above prices at the provisional rate.

The archived 1991 audit reports USD lifetime deposit-insurance payouts of
$10.46B against $0.16B in premiums, with $10.30B covered by Treasury. These
historical aggregates predate the measured cohort and do not include a matching
insured deposit-year denominator or recovery cohort, so they cannot set an
annual actuarial rate. The 10.67% sensitivity is a single-event stress
calculation, not an expected annual loss or a proposed rate. No premium
calibration or neutral 8 to 15% ROE acceptance is claimed from this evidence.

## Remaining acceptance work

- Implement and qualify an actual payer-backed source for Treasury cash,
  including tax collection, with exact-once receipt recovery and no double
  counting against signed fiscal analytics.
- Re-run the seeded maturity waterfall, neutral bank case, aggressive recession
  case, and funded rescue after cash collection and rollover behavior are
  complete.
- Collect a credible post-start insurance exposure and resolution cohort before
  replacing the provisional premium rate.
- Qualify the 1991 minister or central-bank rescue choice against funded
  Treasury cash and the original bank charter epoch.
