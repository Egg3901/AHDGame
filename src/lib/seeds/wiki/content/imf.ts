export const imfContent = `# Corporate IMF Restructuring

Corporate IMF restructuring is an admin rescue for a distressed market corporation. It is separate from the [IMF Sovereign Facility](/wiki/imf-sovereign-facility), which applies to national budgets after failed sovereign-bond auctions.

## Activation

An admin selects the rescued corporation, the IMF's target ownership percentage, a bond-haircut retention rate, the facility interest rate and term, and an income-capture percentage. The IMF institution must already exist. The rescue cannot be applied to the IMF itself, a national corporation, or a corporation with no outstanding bond principal.

Activation performs one restructuring transaction:

1. Existing corporate bonds are reduced by the selected retention rate and removed from the normal bond ledger.
2. The retained face value becomes the principal of an amortizing IMF facility.
3. New shares are issued to the IMF corporation until its fully diluted ownership reaches the selected target.
4. Dividends and CEO salary are set to zero.
5. Affected character bondholders receive a system notice.

## Facility payments

The facility calculates principal and interest each turn. Its payment is limited by the rescued corporation's operating income. The default capture is **35% of per-turn income**, with a hard cap of **45%**. If the income cap cannot cover scheduled interest, unpaid interest increases principal and the schedule stretches.

Payments reduce the rescued corporation's liquid capital and are remitted to the IMF institution. The IMF records the outstanding facility as a portfolio receivable.

## Restrictions while active

- Share price carries a **0.85 multiplier**.
- Positive dividends are blocked.
- CEO compensation is blocked.
- New corporate bonds cannot be issued.
- A defaulted bond cannot be refinanced through the normal crisis action.
- Automatic default resolution does not dissolve an IMF-managed corporation.

The restrictions end when the facility clears or an admin ends the program. Ending the program clears the active facility fields but does not automatically sell the IMF's equity stake.

## How it differs from a sovereign bailout

| | Corporate restructuring | Sovereign facility |
| --- | --- | --- |
| Borrower | One corporation | A country's national budget |
| Entry | Admin rescue of corporate debt | Executive resolution of a sovereign crisis |
| Default income capture | 35% | 20% |
| Capture cap | 45% | 30% |
| Equity dilution | IMF receives new shares | None |
| Share-price effect | 0.85 on the rescued corporation | No countrywide share discount |

See also: [Corporate Bonds](/wiki/corporate-bonds), [Corporations](/wiki/corporations), [Stock Market](/wiki/stock-market), [Sovereign Default](/wiki/sovereign-default).
`;
