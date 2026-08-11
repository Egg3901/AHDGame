export const savingsInterestContent = `# Savings & Interest

Idle cash in a savings account earns interest every turn. There is no feature flag: savings interest is always on. The rate is tied to the central bank's prime rate, accrues continuously, and credits to your balance on a quarterly schedule.

## The rate

The annual percentage yield (APY) paid on savings is exactly half the prime rate:

\`\`\`
APY = primeRate / 2
\`\`

| Prime rate | Savings APY |
| --- | --- |
| 2.0% | 1.0% |
| 4.0% | 2.0% |
| 6.0% | 3.0% |
| 8.0% | 4.0% |

When the [Central Bank Chair](/wiki/central-banks) raises rates, your savings yield rises in lockstep, and vice versa.

## Per-turn accrual

Interest accrues **every turn** but is only **credited quarterly** (every 12 turns, i.e. \`TURNS_PER_YEAR / 4\`). The per-turn accrual is:

\`\`\`
perTurnAccrual = balance × (APY / 100) / TURNS_PER_YEAR
\`\`

With 48 turns per year and a prime rate of 4% (APY 2%):

\`\`\`
perTurnAccrual = balance × 0.02 / 48 = balance × 0.0004167
\`\`

A ¥1,000,000 balance accrues roughly ¥41.67 per turn, credited as a ¥500 lump every 12 turns.

## Rounding

Accruals are rounded to the currency's native precision:

| Currency family | Rounding |
| --- | --- |
| JPY (and other 0-decimal currencies) | Whole units |
| All other currencies | 2 decimal places |

This keeps credited interest matching the ledger's expected precision: no fractional yen, no floating-point drift on dollar/euro balances.

## Crediting schedule

| Event | Cadence |
| --- | --- |
| Accrual computed | Every turn |
| Interest credited to balance | Every 12 turns (quarterly) |

Accrued-but-uncrerdited interest is tracked internally; if you close or move the account mid-quarter, the pending accrual is settled at that point so nothing is lost.

## Practical notes

- **Rate-following:** Because APY = prime / 2, savings is a rate-sensitive asset. In a high-rate environment it is a genuine yield instrument; in a low-rate environment it barely beats stuffing cash under a mattress.
- **No lock-up:** Unlike bonds, savings can be withdrawn at any time. The cost of that liquidity is the half-prime haircut versus buying sovereign bonds directly.
- **Compound effect:** Credited interest becomes part of the balance for the next quarter's accrual, so savings compounds quarterly, not just per-turn.

See also: [Central Banks](/wiki/central-banks), [Sovereign Bonds](/wiki/sovereign-bonds), [Line of Credit](/wiki/line-of-credit), [Currency Exchange](/wiki/currency-exchange)
`;
