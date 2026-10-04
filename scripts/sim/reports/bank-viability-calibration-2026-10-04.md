# Bank viability calibration, 2026-10-04

This deterministic, local model uses the 1991 US budget, rate, savings APY,
capital, branch ceiling, loan, fee, premium, sovereign issuance, pool quote,
and funded Treasury claim rules. It uses a representative bank with $5 million
opening capital, 250 units of financial-sector capacity, a 50% branch share,
and a $150 million deposit ceiling. It does not read or mutate a world database.

The current implementation funds public-float and bank-holder sovereign coupon
claims from the same Treasury cash stock. A public-float coupon is credited to
the pool only after its issuer debit is funded. The seed begins with zero
spendable Treasury cash; the signed fiscal position is kept separate. Funded
primary issuance is limited by real pool cash and creates the matching Treasury
cash receipt.

| Scenario | Annualized ROE | End equity | Outcome |
| --- | ---: | ---: | --- |
| 1991 seed, balanced profile, current rates, zero opening pool cash | 8.63% | $74.4M | Adequate |
| Neutral midpoint rates, balanced profile | 12.21% | $68.3M | Adequate |
| Neutral legal-minimum deposit rate | 13.74% | $124.6M | Adequate |
| Neutral legal-maximum deposit rate | -0.43% | $15.9M | Adequate |
| Aggressive profile, midpoint pricing, 5-point prime shock at turn 240, production stress-loss at shock and 5x stressed default rates | -106.89% | $0.23M | Adequate; no modeled failure |

The aggressive case is a severe deterministic stress path, not an estimate of
failure probability. It loses nearly all representative equity but does not
cross the current failure rule. The modeled 1991 and midpoint ROEs are not
whole-bank acceptance or grounds for premium calibration.

The model still excludes national budget cash outflows and full tax settlement.
As a result, its ending funded Treasury balance is not available fiscal
headroom. In the 1991 seed case, $3.826T of pool-held maturity principal remains
unpaid at the end of the ten-year run, despite all modeled pool coupons being
funded. This is a material rollover/primary-funding shortfall. Premium cash is
charged to the bank, but this run does not yet model a complete insurer fund,
failure waterfall, or Treasury rescue. Service-fee rows in the script are
hypothetical sensitivities and are not implemented prices.

## Remaining acceptance work

- Make the existing nationalization Treasury debit and donor compensation
  credit one durable, replay-safe funded transfer before enabling the ledger.
- Include actual fiscal receipts and spending, insurer fund accumulation and
  drawdown, and the Treasury/pool-funded backstop in the model.
- Size premiums from modeled expected failure losses and a declared reserve
  target; verify an aggressive recession reaches the production failure rule
  under an explicitly stated scenario rather than claiming it from negative
  ROE alone.
- Re-run neutral and stress cases with fully funded sovereign coupons,
  maturities, and no outstanding unfunded claims before claiming bank
  viability.
