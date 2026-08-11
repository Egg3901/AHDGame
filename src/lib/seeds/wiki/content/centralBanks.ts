export const centralBanksContent = `# Central Banks

Each active country has a central bank with an appointed **Central Bank Chair**, a player-held position that controls the country's prime interest rate. The prime rate ripples through bond prices, corporate margins, exchange rates, and inflation.

Fully command economies run a passive monobank instead: the automatic rate setter does not fire. See [Planned / Command Economies](/wiki/planned-economies).

## The Central Bank Chair role

The Chair is the most economically powerful non-executive position in the game. Unlike elected offices, it is an **appointed** position with a 4-year term (192 turns).

**Benefits of holding the Chair:**
- +0.5 national political influence per turn
- +3 actions per turn (the "chairActionBonus")
- A platform to set monetary policy

**Drawbacks:**
- Chair infamy (scrutiny) rises when inflation or GDP growth deviate from targets
- High infamy halves your NPI bonus and costs 1.5 actions per turn
- Poor monetary policy is politically visible: it affects your favorability

## How infamy works

The Chair's infamy (scrutiny) tracks how well you are managing the economy. Each turn:

\`\`\`
scrutinyDelta = (inflationRate − targetInflation) × 0.5
              + (2.0 − gdpGrowth) × 0.5           // slow growth → more scrutiny
\`\`\`

The GDP growth target is **2.0%**. Inflation targets are country-specific monetary baselines; most developed markets target **2.0%**, while countries such as Japan, Brazil, and Nigeria use different baselines. Every 1% deviation from either target moves infamy by 0.5 points per turn.

Natural decay is **5% per turn** (same as character infamy). Good economic conditions let infamy fall naturally; bad conditions push it up faster than decay.

**Positive effects (infamy reduction) are dampened at high scrutiny:**
\`\`\`
dampener = max(0.1, 1 − chairInfamy / 150)
\`\`\`

At infamy 75, positive effects are cut in half. At infamy 150+, they are reduced to 10%. Once scrutiny climbs, it is hard to shed.

**Infamy penalty threshold:** Above 25 infamy, chair bonuses are halved (+0.25 NPI instead of +0.5) and 1.5 actions are debited each turn.

## Chair selection

When a term expires, a new Chair is selected from two pools:

| Pool | Weight | Source |
| --- | --- | --- |
| Political | 70% | Characters nominated by executives (President/PM/Chancellor) |
| Economic (Wealth) | 30% | Top 3 wealthiest player characters + 2 random from ranks 4 to 20 |

Lobbying funds shift weights within each pool: spending ₳500,000 on lobbying **doubles** your selection weight.

The selected candidate must **accept** the offer. If they decline, the next eligible candidate is offered the post. Political pool declines re-run the weighted draw with decliners excluded.

**Term length:** 192 turns (4 game years)
**Nomination window:** Opens during the last 48 turns of the current term

## Setting the prime rate

The Chair sets monetary policy by adjusting the prime rate. The prime rate can be set between **0% and 25%** in **0.25% increments** (e.g., 2.00%, 2.25%, 2.50%). This is done through the character's available actions on the Central Bank page. The prime rate affects:

### 1. Corporate bond costs

Coupon rates on new corporate bonds = prime rate + credit spread. Raising rates makes borrowing more expensive for corporations, reducing expansion capacity. Lower rates make bonds cheap and encourage investment.

### 2. Sovereign bond coupon rate

Sovereign bonds pay exactly the prime rate, with no spread. New bond issuances each quarter carry whatever the current prime rate is. Higher rates mean the government pays more interest, widening the deficit.

### 3. Exchange rates

The prime rate is one of four macro factors that drive the exchange rate target each turn. The full macro target formula is:

\`\`\`
macroTarget = baseRate × multiplier

multiplier = 1
  − (primeRate − baselinePrime) × 0.02
  + (inflation − baselineInflation) × 0.015
  − (gdpGrowth − baselineGdpGrowth) × 0.01
  − (tradeGrowth − baselineTradeGrowth) × 0.005
\`\`\`

- **Prime rate**: higher rates strengthen currency (lower target rate); sensitivity 0.02
- **Inflation**: higher inflation weakens currency (higher target rate); sensitivity 0.015
- **GDP growth**: stronger growth strengthens currency; sensitivity 0.01
- **Trade growth**: trade surplus strengthens currency; sensitivity 0.005

The actual rate converges toward this target at **5% per turn** (\`DRIFT_SPEED\`), so a full rate shock takes roughly one game year (~48 turns) to work through. On top of macro drift, two additional forces apply each turn:

- **Volume pressure**: net buy/sell activity creates a short-term offset capped at **±5%** per turn. Volume accounts for **20%** of rate direction; macro fundamentals account for **80%**.
- **Random noise**: ±0.3% per-turn jitter prevents perfectly predictable movement.

**Guardrails** clamp the final rate to **±50% of the base rate** (floor = 0.5× base, ceiling = 1.5× base).

### 4. Inflation

The prime rate is a direct inflation management tool. High rates dampen borrowing and spending, reducing inflationary pressure. This relationship is captured in the per-turn inflation recalculation, which feeds GDP growth data and prime rate into an inflation model that updates every turn.

### 5. Corporate profit margins (via inflation)

Inflation affects all corporate sector margins:

| Inflation | Margin effect |
| --- | --- |
| 0% | +2% |
| 1% | +1% |
| 2% (target) | 0% |
| 5% | −3% |
| 7% | −5% |
| 10%+ | −8% (cap) |

Below the 2% target, the bonus scales linearly from 0% at target to +2% at 0% inflation. Above target, the penalty scales linearly to −8% at 10% inflation, then caps.

### 6. Corporate growth costs

Revenue growth costs scale with the prime rate. Higher rates increase the cost of growing each sector's revenue, slowing organic expansion across all corporations.

## Central bank and fiscal policy

The Chair does not control fiscal policy: that requires legislation passed through the legislature. But monetary and fiscal policy interact:

- High deficit spending stimulates the economy (boosting growth and margins) but can fuel inflation
- High inflation forces the Chair to raise rates, which raises borrowing costs, which can slow growth
- High national debt crowds out private investment, reducing margins across all sectors

A Chair who raises rates aggressively to fight inflation may tip the economy into a slowdown, but a Chair too slow to act lets inflation compound. Both mistakes play out in real time, across every active country at once.

## FX intervention (standing band policy)

The Chair can post a **soft-band intervention policy**: a floor and ceiling around the current exchange rate. When the market rate moves outside this band, the central bank automatically defends it by injecting synthetic trade volume, drawing on reserves to push the rate back toward the band.

### Setting the band

Access the Central Bank page and set:
- **Floor**: minimum acceptable rate (stronger than this triggers selling)
- **Ceiling**: maximum acceptable rate (weaker than this triggers buying)

**Policy change rules:**
- **Widening** the band (making it looser) is free: do it any time.
- **Narrowing or cancelling** the band requires a **6-turn cooldown** after the last policy change. This mirrors the prime-rate cadence and prevents rapid-fire policy whipsawing.

The band **persists across chair transitions**. A new chair inherits the previous band and must wait out any active cooldown before tightening it.

### How defense works

Each turn, if the published rate is outside the band:

1. The game computes the **breach distance** (how far outside the band the rate sits).
2. It calculates desired spend as \`breachDistance × aggressiveness × baseRate\`.
3. Actual spend is capped by available reserves.
4. The synthetic volume is folded into the same **volume-pressure channel** that organic trades use, so intervention obeys the same ±5% per-turn cap.
5. The rate is recomputed with the synthetic volume included.

**Reserve draw order:**
- **Forex Revenue** is spent first (the central bank's accumulated spread-fee income).
- **Reserve Balance** is tapped only after forex revenue is exhausted.

### Reserve pools

| Pool | Source | Purpose |
| --- | --- | --- |
| Forex Revenue | 40% of spread fees on every currency trade | Primary intervention ammunition |
| Reserve Balance | Treasury transfers + 10% of spread fees on every trade | Secondary buffer when forex revenue is empty |

**Spread fee split:** On every currency trade, 50% of the spread is destroyed (deflationary sink). The remaining 50% goes to the central bank: 40% of the total spread becomes forex revenue, and 10% of the total spread seeds the reserve balance directly.

**Treasury → FX Reserve Transfer:** The Finance Minister (US Secretary of the Treasury, UK Chancellor, JP/DE Finance Minister) can move federal surplus into the reserve balance. This action is capped at **0.5% of annual federal revenue per turn** and rate-limited to once per turn. It is config-driven via \`financeMinisterCabinetId\`, so future countries wire up automatically by setting that field.

### Failure and infamy

If the rate is **still outside the band after spending all available reserves**, the seated Chair receives an **intervention failure**:

- **+15 infamy** charged once per breach cycle (deduped so you don't get stacked penalties every turn)
- A system mail notifies the Chair that reserves are depleted
- The band remains posted; the Chair must either restore reserves (via treasury transfer or waiting for forex revenue to accumulate) or widen the band

If no reserves are available at all when the breach occurs, failure infamy still fires: the band was undefended.

**IMF lock:** If the country is under an IMF bailout (\`chairControlsLocked\` is true), the Chair **cannot change** the intervention policy, but ongoing defense continues to fire if a band was already posted.

### Intervention history

The Central Bank page shows a running log of recent interventions:
- Turn number
- Direction (buy / sell)
- Reserves spent
- Funding source (forex revenue, reserve balance, or mixed)
- Rate before and after

History is retained for the last 24 intervention events per currency.

## Savings and credit lines

The central bank system also manages player savings accounts and lines of credit. Interest on savings deposits flows through the central bank's reserve balance. The **savings APY is half the prime rate** (e.g., 5% prime → 2.5% APY). These are secondary functions separate from the main Chair role.

See also: [Currency Exchange](/wiki/currency-exchange), [National Metrics](/wiki/national-metrics), [Sovereign Bonds](/wiki/sovereign-bonds), [Corporate Bonds](/wiki/corporate-bonds), [Government Approval](/wiki/government-approval), [Planned / Command Economies](/wiki/planned-economies)
`;
