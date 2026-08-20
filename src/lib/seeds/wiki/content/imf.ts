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
imfPayment = perTurnIncome × 0.20     // 20% of per-turn income by default
// capped at 30% of per-turn income
\`\`

| Parameter | Value |
| --- | --- |
| Income capture rate | 20% of per-turn income (default) |
| Capture cap | 30% of per-turn income |
| Duration | Until the IMF facility is repaid |

The cap means even if amortization math would demand more than 20%, the IMF cannot take more than 30% of any single turn's income: the country keeps at least 70% to function.

## Corporate margin penalty

Corporations headquartered in the country carry a sector-margin penalty while any sovereign default resolution path is in its penalty window, not a share-price multiplier. The bailout path's penalty is smaller than the other two paths: repudiate -18% (financial-sector multiplier), restructure -9%, bailout -4.5%, all before per-sector multipliers and decay over the following turns.

There is a separate, unrelated 0.85x (-15%) share-price discount in the game, but it applies only to an individual corporation placed under its own admin-driven corporate IMF restructuring (a per-corporation flag), not to every corporation in a country whose government is in a sovereign bailout.

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

- **Cheapest up front, costliest over time:** The −2% GDP hit is attractive, but 20-30% income capture plus the ongoing corporate margin penalty can cost more than a one-time restructuring if the facility runs for many turns.
- **Repay early if possible:** Because conditions persist until the balance hits zero, running a primary surplus to accelerate principal repayment ends the drag sooner.
- **Board politics:** Elections and appointments that change the IMF board composition can shift bailout terms mid-stream.

See also: [Sovereign Default](/wiki/sovereign-default), [Sovereign Bonds](/wiki/sovereign-bonds), [National Budget](/wiki/national-budget), [Central Banks](/wiki/central-banks)
`;
