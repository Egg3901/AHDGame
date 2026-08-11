export const imfContent = `# IMF & Bailouts

The IMF bailout facility is the least-destructive exit from a [Sovereign Default](/wiki/sovereign-default) crisis. Instead of repudiating or restructuring unilaterally, the country accepts an IMF loan facility, but the IMF extracts ongoing payments and imposes a share-price penalty until the facility is repaid.

## When it applies

The IMF bailout is one of three resolution paths available to the executive during a sovereign default crisis. It carries the smallest immediate GDP penalty (−2%) but is the only path that comes with **ongoing conditions**:

| Resolution path | GDP penalty | Ongoing conditions? |
| --- | --- | --- |
| Repudiate | −12% | No |
| Restructure | −6% | No (one-time haircut) |
| **IMF Bailout** | **−2%** | **Yes: income capture + share discount** |

## Income capture

While the bailout is active, the IMF captures a share of the country's per-turn income as loan payment:

\`\`\`
imfPayment = perTurnIncome × 0.35     // 35% of per-turn income
// capped at 45% of per-turn income
\`\`

| Parameter | Value |
| --- | --- |
| Income capture rate | 35% of per-turn income |
| Capture cap | 45% of per-turn income |
| Duration | Until the IMF facility is repaid |

The cap means even if amortization math would demand more than 35%, the IMF cannot take more than 45% of any single turn's income: the country keeps at least 55% to function.

## Share price multiplier

All corporations headquartered in the bailed-out country trade at a discount while the facility is active:

\`\`\`
sharePriceMultiplier = 0.85     // 15% discount applied to share valuations
\`\`

This reflects investor unease about IMF oversight and the drag on national economic autonomy. The discount lifts automatically once the IMF facility is fully repaid.

## Loan amortization

The IMF facility is repaid as a **level annuity**: the standard loan amortization formula:

\`\`\`
P = principal
r = periodicRate
n = remainingTerms

payment = P × r / (1 − (1 + r)^(−n))
\`\`

Each turn the payment is split into interest and principal portions in the same way as any amortizing loan. The ledger tracks the running balance, and once it reaches zero the facility closes, the income capture stops, and the share-price multiplier returns to 1.0.

## IMF board membership

The IMF is governed by a board. A character's seat is checked via:

\`\`\`
isImfBoardMember(character) → boolean
\`\`

Board members have influence over bailout terms and approvals: having a friendly character on the board can smooth (or complicate) a country's bailout negotiation.

## Strategic considerations

- **Cheapest up front, costliest over time:** The −2% GDP hit is attractive, but 35% income capture plus a 15% share discount can cost more than a one-time restructuring if the facility runs for many turns.
- **Repay early if possible:** Because conditions persist until the balance hits zero, running a primary surplus to accelerate principal repayment ends the drag sooner.
- **Board politics:** Elections and appointments that change the IMF board composition can shift bailout terms mid-stream.
- **No new corporate debt:** Corporations under an active IMF sovereign bailout cannot issue new bonds (see [Corporate Bonds](/wiki/corporate-bonds)).

See also: [Sovereign Default](/wiki/sovereign-default), [Sovereign Bonds](/wiki/sovereign-bonds), [National Budget](/wiki/national-budget), [Central Banks](/wiki/central-banks)
`;
