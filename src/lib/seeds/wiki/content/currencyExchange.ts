export const currencyExchangeContent = `# Currency Exchange

The foreign exchange (Forex) system gives each active country its own floating currency. Players can trade currencies for profit, and cross-country investments settle in the currency of the asset's country.

Planned economies work differently: a fully command country's official rate is fixed and does not float with macro or player volume. See [Planned / Command Economies](/wiki/planned-economies).

## Active currencies

| Country | Currency | Code | Initial rate (vs. internal unit) |
| --- | --- | --- | --- |
| United States | US Dollar | USD | 1.0 |
| United Kingdom | Pound Sterling | GBP | 0.75 |
| Japan | Japanese Yen | JPY | 106.0 |
| Germany / EU | Euro | EUR | 0.92 |
| China | Chinese Yuan | CNY | 7.2 |
| Brazil | Brazilian Real | BRL | 5.0 |

All six currencies above are active in forex trading. Canada (CAD) is reserved for future expansion. Nigeria (NGN) has full monetary baselines (neutral prime rate 12.0%, target inflation 6.0%) and an initial rate of 1,550 NGN per internal unit, but is not yet in the forex trading system.

Rates are measured against an internal "anchor" unit, not directly against each other. Cross-rates are derived: USD/JPY = jpyRate / usdRate.

## How exchange rates move

Each turn, rates update through three components:

### 1. Macro fundamental drift

Each country's rate drifts toward a target based on its economic conditions:

\`\`\`
macroTarget = baseRate × max(0.01, 1
  − (primeRate − baselinePrime) × 0.02         // higher rates → stronger currency
  + (inflationRate − baselineInflation) × 0.015 // higher inflation → weaker currency
  − (gdpGrowth − baselineGDP) × 0.01           // higher growth → stronger currency
  − (tradeGrowth − baselineTrade) × 0.005       // trade surplus → stronger currency
)
\`\`\`

The rate drifts toward the target at **5% per turn**. A significant rate shock takes roughly a full game year (~48 turns) to converge 90% of the way. This creates multi-month currency trends: time to spot, build positions, and exit.

**Baseline economic values (neutral state):**

| Country | Baseline prime | Baseline inflation | Baseline GDP | Baseline trade |
| --- | --- | --- | --- | --- |
| US | 3.0% | 2.0% | 2.5% | 0% |
| UK | 3.0% | 2.0% | 1.5% | 0% |
| JP | 1.0% | 1.0% | 1.0% | 0% |
| DE | 3.0% | 2.0% | 1.5% | 0% |
| IE | 3.0% | 2.0% | 3.5% | 2.5% |
| CN | 4.0% | 2.0% | 5.0% | 4.0% |
| BR | 8.0% | 4.0% | 2.5% | 2.0% |

If the US central bank raises its prime rate from 3.0% to 5%, the USD macro target strengthens by 0.04 (2.0% excess × 0.02 sensitivity). The USD rate then drifts toward that stronger target over many turns.

### 2. Player volume pressure

Net buy/sell volume from the past 24 turns creates a short-term rate offset:

\`\`\`
volumePressure = clamp(netVolume × sensitivity, −5%, +5%)
finalRate = macroRate × (1 − volumePressure × 0.2)
\`\`\`

Volume pressure accounts for **20%** of rate direction; macro fundamentals drive the other 80%. The ±5% cap prevents whale trades from causing extreme swings.

### 3. Random noise

Per-turn jitter of **±0.3%** prevents perfectly predictable movements.

### Guardrails

Rates are capped at ±50% from their base rate. A currency cannot hyperinflate or collapse beyond that floor/ceiling.

## Trading currencies: three tiers

| Tier | Method | Spread | Fill |
| --- | --- | --- | --- |
| 1 | Market maker | 0.275% | Instant, always available |
| 2 | Public limit order | 0.175% | When market rate meets your limit |
| 3 | Direct player trade | 0.10% | When target player accepts |

**Tier 1 (Market Maker):** Instant fill at the current rate ± 0.275% spread. Used automatically for auto-convert purchases. Volume pressure still applies.

**Tier 2 (Limit Orders):** Post a public order at a target rate. The order auto-fills when the market price crosses your limit (0.175% spread). Other players can manually fill it early for a direct player trade fee instead. Set an optional expiry in turns.

**Tier 3 (Direct Trades):** Send a specific currency offer to a named character. They can accept or decline, no counter-offers. Expires after 24 turns by default.

Spread fees are split: **50% destroyed** (deflationary sink) and **50% to the currency's central bank**. The central bank's share is itself split **80% to forex revenue** (intervention ammunition) and **20% to reserve balance** (long-term buffer).

## Multi-currency wallet

Your character has two money pools:

- **Campaign funds:** Always in your home currency. Used for campaign spending, ads, and party actions. Never converted or held in foreign currency.
- **Personal wealth:** Multi-currency. Each currency is a separate balance. Foreign income deposits directly into the relevant currency slot.

When making personal purchases in a foreign currency:
1. Spend from your existing balance in that currency (free, no spread)
2. If you lack enough, auto-convert the shortfall from your home currency (0.275% spread)
3. If both are insufficient, the transaction is rejected

## Foreign income

Income from foreign corporations is handled differently by type:

- **Dividends:** Automatically converted to your home currency at the market-maker rate (0.275% spread) when forex is enabled. There is no per-holding preference: this conversion is automatic.
- **Bond coupons:** Paid in the bond's denomination currency and deposited directly into your personal balance in that currency. No auto-conversion.
- **CEO salary:** Paid in the corporation's home currency and deposited directly into your personal balance in that currency. No auto-conversion.

## How forex affects the game

**Cross-country investments:** If you buy JP stock at ¥26,900 per share and the yen strengthens against your home currency, your holding is worth more in home-currency terms even if the share price didn't move.

**Corporate economics:** Corporation revenues and costs are denominated in the corporation's home currency. When a US corporation's sector operates in Japan, the revenue is earned in USD (the corp's currency) but taxed at Japanese rates against a JPY-denominated tax base. Cross-country HQ relocations trigger a full treasury conversion at the spot rate.

**Central bank policy:** The [Central Bank Chair](/wiki/central-banks) sets the prime rate, which feeds directly into the macro target formula. A rate hike makes the currency stronger over the following game months.

**Bond prices:** Sovereign bonds are priced using the current prime rate. When a central bank changes rates, existing bond prices move, and so does the exchange rate. Both effects compound for cross-country bond holders.

## Speculation strategy

The standard forex speculation flow:
1. Identify a country with weakening fundamentals (high inflation, slow growth, low rates)
2. Wait for the currency to reach a cycle low
3. Buy a meaningful position (limit orders save on spread)
4. Invest in that country's assets while holding the cheap currency
5. Sell when the currency recovers or fundamentals improve

The 24-turn volume lookback means heavy buying gradually pushes the rate up, accelerating your returns, but also attracting other speculators who may exit before you.

See also: [Central Banks](/wiki/central-banks), [Stock Market](/wiki/stock-market), [Sovereign Bonds](/wiki/sovereign-bonds), [Planned / Command Economies](/wiki/planned-economies)
`;
