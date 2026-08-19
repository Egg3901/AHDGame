export const savingsInterestContent = `# Savings & Interest

Idle cash in a savings account earns interest every turn. There is no feature flag: savings interest is always on. The rate is tied to the central bank's prime rate, accrues continuously, and credits to your balance on a quarterly schedule.

## The rate

The annual percentage yield (APY) paid on savings is half the **real** rate: the prime rate minus local inflation, not the prime rate on its own.

\`\`\`
realRate = max(0.5, primeRate - inflation)
APY      = realRate / 2
\`\`\`

So a 4.42% prime rate does **not** pay 2.21% APY unless inflation is zero. With 2% inflation the real rate is 2.42% and the APY is 1.21%.

| Prime rate | Inflation | Real rate | Savings APY |
| --- | --- | --- | --- |
| 4.0% | 0.0% | 4.0% | 2.0% |
| 4.0% | 2.0% | 2.0% | 1.0% |
| 8.0% | 6.0% | 2.0% | 1.0% |
| 14.0% | 13.8% | 0.5% (floor) | 0.25% |

Using the real rate is what closes the carry trade. A currency with a high nominal prime rate normally also has high inflation, so its real spread, and therefore its savings APY, lands near everyone else's. Parking money in a high-nominal-rate currency earns no free real return.

The real rate never falls below a 0.5 percentage point floor, so every currency pays at least 0.25% APY. The floor is the same everywhere, so it gives no currency an edge.

When the [Central Bank Chair](/wiki/central-banks) raises rates, your savings yield rises with them, but only to the extent the rise beats inflation.

## Per-turn accrual

Interest accrues **every turn** but is only **credited quarterly** (every 12 turns, i.e. \`TURNS_PER_YEAR / 4\`). The per-turn accrual is:

\`\`\`
perTurnAccrual = balance × (APY / 100) / TURNS_PER_YEAR
\`\`\`

With 48 turns per year and a real rate of 4% (APY 2%):

\`\`\`
perTurnAccrual = balance × 0.02 / 48 = balance × 0.0004167
\`\`\`

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

Accrued-but-uncredited interest is tracked internally; if you close or move the account mid-quarter, the pending accrual is settled at that point so nothing is lost.

## Practical notes

- **Rate-following:** Because APY = real rate / 2, savings is sensitive to both policy rates and inflation. In a high-rate environment it is a genuine yield instrument; in a low-rate environment it barely beats stuffing cash under a mattress.
- **No lock-up:** Unlike bonds, savings can be withdrawn at any time. The cost of that liquidity is the half-real-rate haircut versus buying sovereign bonds directly.
- **Compound effect:** Credited interest becomes part of the balance for the next quarter's accrual, so savings compounds quarterly, not just per-turn.

See also: [Central Banks](/wiki/central-banks), [Sovereign Bonds](/wiki/sovereign-bonds), [Line of Credit](/wiki/line-of-credit), [Currency Exchange](/wiki/currency-exchange)
`;
