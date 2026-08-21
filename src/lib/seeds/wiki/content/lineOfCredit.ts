export const lineOfCreditContent = `# Line of Credit

The Line of Credit (LOC) lets a player borrow against their credit score directly from the central bank. It is a revolving facility: draw when you need cash, repay when you can, and the interest accrues every turn on the outstanding balance. If you miss an automatic payment, the system garnishes your income at the source until the obligation is cleared.

## Feature flag

\`\`\`
isLineOfCreditEnabled() → boolean
\`\`

The flag **defaults to enabled**. Only an explicit \`false\` disables the facility: absence of the flag means it is on.

## Credit composite (0 to 100)

Borrowing power is governed by a composite credit score from 0 to 100. The score blends two sub-scores depending on whether a corporate snapshot is available:

\`\`\`
with corporation snapshot:
  composite = 0.75 × corpScore + 0.25 × incomeScore

without corporation snapshot:
  composite = 0.50 × incomeScore + 0.50 × netWorthScore
\`\`

| Blend | Weighting |
| --- | --- |
| With corp snapshot | 75% corporate + 25% income |
| Without corp snapshot | 50% income + 50% net worth |

### Income score

Annualises per-turn income and maps it through a saturating exponential (a curve that grows fast at first then levels off) so that very high income asymptotically approaches 100:

\`\`\`
annualIncome   = perTurnIncome × TURNS_PER_YEAR
incomeScore    = 100 × (1 − exp(−k_income × annualIncome))
// saturates near 100 at ~2.5M annual income
\`\`

### Net worth score

Same saturating shape, keyed to internal net-worth units:

\`\`\`
netWorthScore = 100 × (1 − exp(−k_nw × netWorth))
// saturates near 100 at ~4M internal units
\`\`

### Leverage penalty and prime-environment adjustment

The blended base score above isn't the final composite. Two more adjustments apply in sequence before the spread is computed:

\`\`\`
afterLeverage = base − min(30, debtToAssetsRatio × 38)          // high existing LOC debt worsens your score
final         = afterLeverage − rawStress × (1 − 0.65 × shield) // tighter policy worsens it further
// rawStress = min(22, max(0, primeRate − 2.5) × 5)
// shield    = netWorthScore / 100
\`\`

**Leverage penalty:** the more of your assets are already tied up in LOC debt, the worse your composite gets, capped at a 30-point hit.

**Prime-environment adjustment:** when the central bank's prime rate runs above a 2.5% baseline, borrowers take an additional stress penalty (capped at 22 points) that scales with how far above baseline the rate sits. Wealthier borrowers are partially shielded: a high net-worth score cushions up to 65% of that stress.

## Spread (interest rate)

The composite score maps to an interest-rate **spread** in percentage points versus the prime rate. A perfect 100 earns a 1pp discount; a zero score costs +5pp over prime.

\`\`\`
spread = 5 − (composite / 100) × 6
// composite 0   → +5.0pp over prime
// composite 50  → +2.0pp over prime
// composite 100 → −1.0pp (below prime)
\`\`

| Composite | Spread vs prime | Effective rate at prime 3% |
| --- | --- | --- |
| 0 | +5.0pp | 8.0% |
| 25 | +3.5pp | 6.5% |
| 50 | +2.0pp | 5.0% |
| 75 | +0.5pp | 3.5% |
| 100 | −1.0pp | 2.0% |

## Borrowing limits and payment mode

The credit limit is also constrained by affordability and wealth:

- Total debt service may use at most 70% of income under the DTI limit.
- Outstanding LOC principal may not exceed 1x net worth.
- Interest-only mode adds 2.0 percentage points to the rate.
- Switching the interest-only setting starts a 24-turn cooldown before it can
  be changed again.

## Funding sources

The central bank funds LOC draws from one of three configured sources:

| Source | Mix |
| --- | --- |
| \`deposits\` | 100% from bank deposits |
| \`reserves\` | 100% from bank reserves |
| \`both\` | 50% deposits + 50% reserves |

The choice affects which balance sheet line is depleted when you draw, but from the player's perspective the rate and mechanics are identical.

## Repayment and garnishment

Each turn the system attempts an **automatic payment** covering interest plus a principal amortization slice. If the payment succeeds, the balance shrinks normally.

If the automatic payment fails (insufficient liquid cash), \`drawFrozen\` is set to \`true\` and **garnishment** kicks in. Garnishment intercepts the player's income at the source:

\`\`\`
garnishOrder = [arrears (missed interest) → principal → (cross-currency if needed)]
sources intercepted: CEO salary, dividends, bond coupons
\`\`

| Garnishment rule | Detail |
| --- | --- |
| Trigger | \`drawFrozen = true\` (missed auto-payment) |
| Sources | CEO salary, dividend income, bond coupon income |
| Order | Arrears first, then principal |
| Currency | Cross-currency: garnished income converts to the LOC's currency as needed |

Garnishment continues every turn until the frozen state is cleared, meaning a single missed payment can cascade into a long income drain if the underlying cash shortage is not addressed.

## Ledger

Every LOC transaction is recorded in a per-account ledger with split interest and principal portions:

\`\`\`
ledgerEntry = {
  turn,
  amount,
  interestPortion,
  principalPortion,
  runningBalance,
}
\`\`

This ledger is the source of truth for arrears tracking, garnishment order, and balance history. Review it when debugging why a garnishment is larger or smaller than expected: the interest/principal split explains how much of each payment is actually reducing debt versus servicing it.

## Practical use

- **Bridge financing:** Draw on the LOC to cover a short-term cash gap (e.g. before a dividend lands) rather than selling assets at a bad price.
- **Credit building:** A high composite lowers your spread dramatically. Improving your income and net worth before drawing saves real money over the life of the loan.
- **Avoid the freeze:** The garnishment regime is punitive. Keep enough liquidity to cover the auto-payment, or the system will claw back income at source across currencies.

See also: [Central Banks](/wiki/central-banks), [Corporate Bonds](/wiki/corporate-bonds), [Sovereign Bonds](/wiki/sovereign-bonds), [Savings & Interest](/wiki/savings-interest)
`;
