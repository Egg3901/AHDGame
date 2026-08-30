export const corporateBondsContent = `# Corporate Bonds

Corporations can issue bonds to raise liquid capital. Bonds are fixed-income debt instruments: the issuing corporation receives cash immediately, then pays periodic coupon interest to bondholders until the bond matures, at which point the full face value is returned.

## Issuing a bond

Only the CEO can issue bonds. Access the bond panel from the corporation page.

| Parameter | Details |
| --- | --- |
| Minimum issuance | anchor currency 100,000 |
| Maximum total debt | 2x equity, and never more than what the corporation could realise by selling up (its plants at book, its cash, and the bonds it holds). The second cap is usually the binding one for a built-out corporation, and it is the same test the insolvency check applies, so a corporation inside its quoted ceiling cannot be judged insolvent. The Bonds tab says which limit is binding. Refinancing defaulted debt is exempt, since it adds no debt. |
| Unit face value | anchor currency 1,000 per bond unit |
| Maturity options | 96 turns (2 years), 240 turns (5 years), 336 turns (7 years) |
| Coupon rate | prime rate + credit spread + 1.0pp + term premium (see below) |
| Issuance cooldown | 24 turns between issuances for publicly-listed corporations; 12 turns for private corporations |

**Blocked while under IMF restructuring:** If your corporation is under an active corporate IMF restructuring, you cannot issue new bonds or refinance defaulted debt until the restructuring ends. This is separate from a country's sovereign IMF facility.

Corporate bonds are issued in the corporation's home currency (see [Currency Exchange](/wiki/currency-exchange)). The proceeds go directly to corporate liquid capital. Bond units enter the **public float** and can be purchased by any player or corporation.

**What borrowing actually costs.** The corporation receives the whole face value in cash at issuance, pays a coupon every turn, and then repays the **whole face value in one payment on the maturity turn**, not gradually. Both the coupon and that repayment are charged on every unit issued, including units nobody bought. The issue card prices the principal due at maturity beside the interest, and a standing notice on every tab of the corporation page names the next principal falling due, turning into a warning once it is within 24 turns and saying so outright when liquid capital is already below the amount owed. A bond moved abroad with the corporation stays in the currency it was issued in.

## Credit rating and coupon rate

Your corporation has a **credit rating** (0-100 composite score) based on four weighted factors:

| Factor | Weight | Description |
| --- | --- | --- |
| Debt-to-equity ratio | 30% | Lower ratio = better |
| Interest coverage ratio | 25% | Operating income vs. interest payments |
| Profitability | 25% | Return on equity |
| Liquidity | 20% | Liquid capital relative to short-term obligations |

The credit spread added to the prime rate reflects this score. A highly profitable corporation with low debt pays a coupon close to the prime rate. A heavily indebted or loss-making corporation pays a significantly higher spread.

Credit scores use **inertia smoothing** (changes phase in gradually instead of jumping instantly): each turn the new raw score is blended 75% new + 25% previous. This prevents a single bad turn from instantly nuking your rating.

If your corporation has previously defaulted on a bond, a **credit penalty** applies for **96 turns**, locking your rating at CCC and capping your composite score.

## Term premium

Longer bonds command a higher coupon to compensate investors for locking up capital. The term premium is added on top of the credit-spread formula:

| Duration | Term premium |
| --- | --- |
| 2 years (96 turns) | +0.00pp |
| 5 years (240 turns) | +1.00pp |
| 7 years (336 turns) | +1.75pp |

**Full formula:** coupon rate = prime rate + credit spread + 1.0pp (corporate premium) + term premium

A BBB-rated corporation (credit spread 3.0pp) with a prime rate of 3.0% would pay:
- 2yr: 3.0 + 3.0 + 1.0 + 0.00 = **7.00%**
- 5yr: 3.0 + 3.0 + 1.0 + 1.00 = **8.00%**
- 7yr: 3.0 + 3.0 + 1.0 + 1.75 = **8.75%**

The bond issuance form shows the exact rate for each duration before you commit.

## Per-turn coupon payments

Each turn, the bond pays a fraction of its annual coupon to all current bondholders:

\`\`\`
perTurnPayment = (faceValue x couponRate / 100) / turnsPerYear
\`\`\`

For a anchor currency 100,000 bond at 8% coupon rate with 48 turns per year:
- Annual coupon: anchor currency 8,000
- Per-turn payment: anchor currency 8,000 / 48 ≈ anchor currency 166.67

Payments are made from corporate liquid capital. If the corporation's liquid capital falls below zero after coupon payments, the bond **defaults**.

## Bond market price

Bond market prices fluctuate based on the current effective rate and time to maturity. The price is computed as a fraction of face value (1.0 = par):

\`\`\`
r = currentRate / 100          // effective annual rate as decimal
c = couponRate / 100           // coupon as decimal
n = yearsRemaining

discountFactor = (1 + r) ^ -n
annuityFactor = (1 - discountFactor) / r

price = c x annuityFactor + discountFactor
\`\`\`

This is the present value of remaining coupon payments plus the present value of the face value returned at maturity. The result is clamped between 0.05 and 2.0.

**Key relationships:**
- When rates **rise**, existing bond prices **fall** (your fixed coupon is worth less relative to new issuances)
- When rates **fall**, existing bond prices **rise**
- As a bond approaches maturity, its price converges toward par (1.0) regardless of rate movements. This **pull-to-par** effect dampens price volatility for bonds near maturity.
- If the bond defaults, its market price is fixed at **0.1** (10 cents on the dollar)

## Buying and selling bonds

Any player or corporation can buy bond units from the public float:

- **Players:** Payment from personal cash. Coupon payments received as personal income each turn.
- **Corporations:** Payment from liquid capital. Coupon payments received as corporate income. Add \`?corporationId=\` to buy for your corporation.
- **NPP caretaker CEOs:** When the corp is profitable and cash sits above one day of revenue, they buy high-coupon home-currency paper from the public float (a quarter of the surplus per turn). They will not buy the corp's own issue, and a loss-making corp keeps the cash as runway.

CEOs can also **buy back** their own bonds from the public float to reduce outstanding debt:
- Non-defaulted bonds: buyback at current **market price**
- Defaulted bonds: buyback at **face value** (anchor currency 1,000/unit), which prevents buying distressed debt at a discount and immediately retiring it for a profit

## Default

A bond defaults when the corporation's liquid capital goes negative after a coupon payment **or a maturity repayment** (the lump-sum principal is the trigger people miss), AND it fails a solvency check: the corporation's bond portfolio counts as an asset here, and a corporation whose actions are paused is never declared insolvent while paused, though its coupons and maturities still settle. A positive bond buyback escrow can cover the shortfall first, and a corp whose total assets (valued the same way the restructure planner values them) still exceed its debt is judged illiquid rather than insolvent and does not default. Only a corp that fails both checks actually defaults. On default:

- Bondholders receive no payment that turn
- The corporation's credit rating takes a **96-turn penalty**, locking it at CCC
- **Defaulted bonds can still be traded** on the open market at distressed prices (fixed at 0.1)
- CEOs **cannot** buy their own corporation's bonds at all (prevents self-dealing)

### Refinancing defaulted debt

A CEO can **refinance** defaulted bonds by issuing a new bond for the full defaulted principal and migrating holders to it. This bypasses the normal issuance cooldown but still enforces the 2x equity leverage cap. A corporation can refinance defaulted debt at most **2 times** in its lifetime. If the limit is reached, dissolution is the only remaining option.

**National corporations** (government-owned) cannot refinance defaulted bonds or pay them off with cash: only private corporations have these restructuring options.

### Auto-resolving lingering defaults

If a corporation defaults and the CEO does not resolve the crisis, the turn processor auto-resolves it on a later turn (once the default is at least one turn old, so the CEO had a turn to act in the crisis modal). National and IMF-managed corporations are never auto-resolved. Resolution is tried in this order:

1. **Refinance (no sale):** if the corp is within its leverage limits and hasn't hit the refinance cap, a replacement bond is issued and holders are rolled into it. This preserves every sector, the least destructive outcome.
2. **Restructure (sell):** if refinance isn't feasible, the turn processor sells the **minimum number of sectors** needed, at orderly-sale salvage values, to repay **100% of defaulted principal**, cures the defaulted bonds, and keeps the corporation alive with its remaining sectors.
3. **Stand for dissolution:** if neither works, the default stands until the CEO dissolves and settles.

The CEO is notified and an audit entry is written for every auto-resolution.

This closes the loophole of defaulting and ignoring the crisis when the balance sheet still has enough asset value (or refinancing headroom) to make creditors whole.

Distressed bond speculators can buy defaulted bonds cheaply and wait for the CEO to buy them back at face value, making a profit on the spread.

## Bond holdings

From your corporation page (Bonds tab) you can see:
- Bonds your corporation has **issued** (outstanding debt)
- Bonds your corporation **holds** in other companies (investment portfolio)

The portfolio view shows issuer names, units held, and current market values.

## Strategic considerations

**When to issue bonds:**
- Fund rapid expansion: cheap debt is better than diluting equity if your credit rating is strong
- Bridge a temporary cash crunch while revenue catches up to growth costs
- Finance HQ relocation (cross-country moves cost 14% of market cap; a 7-year relocation bond is offered as an alternative payment method)

**When to buy bonds:**
- Steady income with minimal management: coupon payments arrive each turn automatically
- Rate speculation: buy long-duration bonds when rates are high (prices are depressed), profit when rates fall and prices rise
- Distressed debt: buy defaulted corporate bonds cheaply, wait for CEO buyback at face value

**Watch the prime rate:** The [Central Bank Chair](/wiki/central-banks) sets the prime rate each turn they act. Rate changes ripple directly into all bond market prices.

See also: [Corporations](/wiki/corporations), [Sovereign Bonds](/wiki/sovereign-bonds), [Central Banks](/wiki/central-banks), [Stock Market](/wiki/stock-market)
`;
