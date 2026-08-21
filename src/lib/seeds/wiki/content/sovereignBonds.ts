export const sovereignBondsContent = `# Sovereign Bonds

Sovereign bonds are government-issued debt instruments that finance national deficits. They share the same trading infrastructure as corporate bonds but are backed by entire nations rather than individual corporations. Unlike corporate bonds, sovereigns do not default in the bond processor (a separate crisis system handles sovereign distress).

## What they are

When a country runs a budget deficit, it needs to borrow money to cover the gap. The government issues sovereign bonds: players, corporations, and imperial characters buy them, the government gets cash, and bondholders receive regular coupon payments until the bond matures.

## Active issuers

| Country | Currency | Maturity |
| --- | --- | --- |
| United States | USD | 48 turns (1 game year) |
| United Kingdom | GBP | 48 turns (1 game year) |
| Japan | JPY | 48 turns (1 game year) |
| Germany | EUR | 48 turns (1 game year) |
| Ireland | EUR | 48 turns (1 game year) |
| Brazil | BRL | 48 turns (1 game year) |
| China | CNY | 48 turns (1 game year) |
| Nigeria | NGN | 48 turns (1 game year) |

All configured countries with a national budget issue sovereign bonds automatically. Every issuer has the same 48-turn (1 game year) maturity.

Each sovereign bond is denominated in the issuing country's currency. A US Treasury bond pays coupons in USD; a UK gilt pays in GBP; a Japanese government bond pays in JPY.

## Automatic issuance

Sovereign bonds are issued **automatically every 12 turns** (once per game quarter). You cannot manually trigger issuance: it happens on schedule regardless of who is in office.

Each quarter, the issuance amount has two components:

**Deficit component:**
\`\`\`
quarterlyAmount = annualDeficit / 4
deficitAmount = floor(quarterlyAmount / 1,000) * 1,000
\`\`\`
If the budget is in surplus, this component is zero. The floor rounds to the nearest bond unit (1,000 face value).

**Rollover component:**
Any sovereign bonds maturing in the upcoming 12 turns are refinanced. Their total face value is reissued as new bonds. This keeps the bond market liquid even when the country is running a surplus: the float replenishes automatically.

## Coupon rate

Sovereign bonds use the **central bank prime rate** as their base, plus a term premium for longer maturities and any credibility spread the issuing bank has accumulated:

\`\`\`
couponRate = primeRate + termPremium + credibilitySpread
\`\`\`

Unlike corporate bonds, there is no separate corporate risk premium. But a bank whose Chair has let scrutiny climb pays a credibility spread on top of the base rate, so sovereigns are not entirely immune to credit-style pricing. When the [Central Bank Chair](/wiki/central-banks) raises rates, newly issued bonds carry higher coupons.

## Bond structure

| Field | Value |
| --- | --- |
| Face value | 1,000 per unit (in the bond's currency) |
| Maturity | 48 turns (1 game year) |
| Market price at issuance | 1.0 (par) |
| Units start in | Public float (available to buy immediately) |
| Can default in bond processor | No; sovereign distress is handled by the crisis system |

## Budget integration

When sovereign bonds are issued, the national budget is updated immediately:

- **Principal increases** by the total face value issued
- **Annual interest cost** increases by \`couponRate% * totalIssued\`
- **Surplus decreases** (or deficit increases) by the new interest cost
- **Debt-to-GDP ratio** updates, which affects the country's credit rating

When bonds mature, the process reverses: principal and interest obligations are reduced, improving the surplus figure.

## Per-turn processing

Each turn, the bond system:

1. Issues any scheduled sovereign bonds (every 12 turns)
2. Pays coupon interest to all holders from the national treasury
3. Updates market prices based on current interest rates and time to maturity
4. Settles matured bonds (returns face value to holders, reduces national debt)
5. Records history snapshots

Sovereign bond coupons are ledgered as government coupon payments. This is not
the same as the Monetize sovereign-crisis resolution. Monetize is a separate
executive action and is blocked once inflation reaches 8%.

## Market price dynamics

Sovereign bond prices update each turn based on the present value of remaining cash flows:

\`\`\`
r = currentPrimeRate / 100  (decimal)
c = couponRate / 100          (decimal)
yearsRemaining = turnsRemaining / 48

discountFactor = (1 + r) ^ (-yearsRemaining)
annuityFactor = (1 - discountFactor) / r
price = c * annuityFactor + discountFactor
\`\`\`

This is the standard present-value formula: PV of coupon annuity + PV of par repayment.

- **Rising prime rates → falling prices** (existing bonds become less attractive)
- **Falling prime rates → rising prices** (existing bonds offer above-market coupons)
- **Near maturity:** Price converges toward par regardless of rates
- **Recovery value:** If a corporate bond defaults, price drops to 0.1 (10 cents on the dollar). Sovereign bonds do not default in the bond processor.

## Buying sovereign bonds

From any country's stock exchange page, you can browse available sovereign bonds and buy units:

- **Players:** Purchase from personal cash, receive coupon payments each turn (in the bond's currency)
- **Corporations:** Purchase as an investment, coupons flow into liquid capital
- **Imperial characters:** Can also hold bonds and receive coupon income

There is no minimum purchase amount beyond 1 unit (1,000 in the bond's currency).

### Currency handling

When forex is enabled, bond coupon payments and maturity returns are paid in the bond's denomination currency. For character holders, the system auto-converts foreign-currency bond income to the holder's home currency at the market-maker rate (1% spread). Corporate holders receive coupons in their own liquid capital currency.

## Credit rating tiers

The country's debt-to-GDP ratio determines its credit rating, which affects the interest rate the government pays on new debt:

| Debt-to-GDP | Rating | Interest Rate | GDP Growth Penalty | Public Trust Penalty |
| --- | --- | --- | --- | --- |
| <= 60% | AAA | 2.0% | 0 | 0 |
| <= 80% | AA | 2.5% | 0 | 0 |
| <= 100% | A | 3.5% | -0.1% | 0 |
| <= 120% | BBB | 5.0% | -0.2% | 0 |
| <= 150% | BB | 7.0% | -0.3% | -5 |
| <= 250% | B | 10.0% | -0.5% | -10 |
| > 250% | CCC | 14.0% | -0.7% | -15 |

Public-trust penalties apply at fiscal year close. The table's GDP value is implemented as per-turn corporate margin drag, not as a direct write to the country's displayed GDP-growth metric. Risk scoring also normalizes debt against the country's seeded sovereign-risk anchor, so the raw bands do not automatically punish a high-debt starting baseline.

## How national debt affects corporations

High sovereign debt has real economic effects on corporations through two channels:

### Debt-to-GDP margin penalty

| Debt-to-GDP | Corporate margin effect |
| --- | --- |
| Below 50% | No penalty |
| 50-100% | -0.5% per 10 percentage points |
| Above 100% | -2.5% base + -1% per additional 10 pp, capped at -5% |

This means a heavily indebted country actively hurts every corporation operating there, though the penalty is capped well short of crippling margins outright. Passing legislation to reduce the deficit (raising taxes or cutting spending) improves conditions for corporations across the board.

### Deficit stimulus

Conversely, deficit spending provides a short-term stimulus: **+0.5% to all corporate margins per 1% of GDP deficit**, capped at +5%. This is a separate effect from the debt penalty: a country can have both high debt (hurting margins) and an active deficit (helping margins) simultaneously.

## Sovereign default crisis

While sovereign bonds do not "default" in the ordinary bond processor, a country can enter a **sovereign default crisis** when **three consecutive fiscal-year sovereign bond auctions fail** (market demand ratio below 0.7). Auction evaluation occurs once per year at fiscal year close (turn 40), so this requires three consecutive years of failure. When this happens:

- The country enters crisis status
- The Executive proposes one of four resolutions: **IMF Bailout**, **Repudiate**, **Restructure**, or **Monetize**
- The Legislature ratifies (or rejects) the choice
- Existing bonds may be restructured (haircut + maturity extension) or repudiated (written down)

See the country dashboard and \`/world/crises\` for crisis tracking. A separate **Debt Sustainability Index** (0 to 100) provides a forward-looking warning gauge but is not the crisis trigger itself.

## Strategic uses

**Income strategy:** Sovereign bonds are the safest income-generating investment in the game. No default risk in the bond processor, predictable coupon payments, and automatic maturity settlement.

**Rate speculation:** Buy when prime rates are high (prices are depressed) and sell when rates fall. The Central Bank Chair's rate decisions directly move sovereign bond prices.

**Fiscal politics:** If you hold significant sovereign debt, you have a financial interest in keeping the country solvent. Debt-reducing legislation benefits both your bond portfolio and your corporate sectors.

**Currency play:** Sovereign bonds are denominated in the issuer's currency. If you expect JPY to strengthen against your home currency, buying Japanese government bonds gives you both coupon income and FX appreciation.

See also: [Corporate Bonds](/wiki/corporate-bonds), [Central Banks](/wiki/central-banks), [National Budget](/wiki/national-budget), [National Metrics](/wiki/national-metrics), [Currency Exchange](/wiki/currency-exchange)
`;
