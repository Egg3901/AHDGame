# Primary underwriting fee rule check

This deterministic report exercises the production `quotePrimaryUnderwritingFee` rule at the default 1.5% fee. It uses no world data or stochastic simulation. The fee is rounded to the nearest 0.01 local cash unit after multiplying the actual placed proceeds, and the issuer receives gross proceeds less that fee.

| Actual placed proceeds | Fee at 1.5% | Issuer net |
| ---------------------: | ----------: | ---------: |
|              10,000.00 |      150.00 |   9,850.00 |
|             100,000.00 |    1,500.00 |  98,500.00 |
|           1,000,000.00 |   15,000.00 | 985,000.00 |
| 12,345.67 partial fill |      185.19 |  12,160.48 |

Only filled gross proceeds are charged. A quote or unfilled order has no fee. Each funded fill places the actual fee in the underwriting bank's charter-currency cash reserves and records it in the bank's actual underwriting receipt ledger. Banking P&L includes that receipt in `lastBankingIncome` for the settlement turn. The fee does not increase the bank corporation's unrelated `liquidCapital` balance: charter reserves are the bank's operating cash and the booked income raises its retained capital/equity through banking P&L. The issuer is paid in its frozen home denomination, and settlement leases prevent changing either recipient's denomination until the cash, issue publication, receipt, and lease-release acknowledgements complete.

Reproduce the values with `npx tsx scripts/sim/primaryUnderwritingFeeReport.ts`. The script imports the same portable production rule used by quote and settlement code.
