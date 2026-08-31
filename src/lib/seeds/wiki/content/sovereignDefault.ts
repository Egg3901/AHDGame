export const sovereignDefaultContent = `# Sovereign Default

A sovereign default crisis is the endgame of fiscal mismanagement. When a country's debt burden overwhelms demand for its bonds, auctions begin to fail. After three consecutive failed auctions, the country enters a crisis with a fixed window for the executive and legislature to choose a resolution. Each path carries a GDP penalty and a long "scar" that suppresses the bond market for years afterward.

There is no feature flag: sovereign default is always active.

## Trigger: failed auctions

Sovereign bond auctions are evaluated once per fiscal year (turn 40). Demand is measured as a **demand ratio**:

| Demand ratio | Status |
| --- | --- |
| ≥ 1.0 | Subscribed (healthy) |
| 0.7 to 1.0 | Undersubscribed (warning) |
| < 0.7 | Failed |

A default crisis is triggered by **3 consecutive failed auctions**: three straight years of demand ratio below 0.7.

## Demand penalty curve

The demand ratio starts from a base appetite and sums seven threshold-gated components, then adds a capped entity-holdings bonus:

\`\`\`
BASE_DEMAND = 1.2

debtToGdpPenalty  = debtGDP > 0.6 ? −(debtGDP − 0.6) × 0.3 : 0
debtToGdpCliff    = debtGDP > 2.0 ? −(debtGDP − 2.0) × 0.4 : 0   // stacks on top of the graduated penalty
inflationPenalty  = inflation > 0.05 ? −(inflation − 0.05) × 2.0 : 0
fxPenalty         = fxDepreciation10t > 0 ? −fxDepreciation10t × 1.5 : 0
defaultScar       = turnsSinceDefault < 100 ? −(100 − turnsSinceDefault) × 0.01 : 0
trustModifier     = (trust − 0.5) × 0.4
couponPremium     = (sovereignCoupon − globalBenchmark) × 5.0

demand = BASE_DEMAND + sum(debtToGdpPenalty, debtToGdpCliff, inflationPenalty,
                            fxPenalty, defaultScar, trustModifier, couponPremium)
       + min(entityHoldings ÷ requiredIssuance × 0.5, 0.4)   // capped Model B holdings bonus
demand = max(demand, 0)
\`\`

Both the debt-to-GDP penalty and the inflation penalty are threshold-gated: they only kick in once debt exceeds 60% of GDP or inflation exceeds 5%. Below those lines, neither component subtracts anything. The 2.0× debt-to-GDP cliff stacks on top of the graduated penalty once leverage crosses that line. A country can also buy back demand by offering a coupon above the global benchmark rate, or lose it to a lingering default scar or low investor trust.

## Warning window

The system gives a **3-turn warning** before the crisis formally fires. During this window the country dashboard and \`/world/crises\` show a countdown, giving the executive a chance to act pre-emptively (cut spending, raise rates, negotiate).

## Crisis windows

Once the crisis triggers, two clocks start:

| Decision | Window |
| --- | --- |
| Executive proposes a resolution | 12 turns |
| Each legislative chamber votes | 24 turns per chamber |

If the executive decision window expires without action, the game
automatically chooses Repudiate. A crisis does not sit unresolved forever.

## Resolution paths

The executive selects one of four resolutions:

| Path | GDP penalty | Description |
| --- | --- | --- |
| **Repudiate** | −12% GDP | Refuse to pay; bondholders take the full hit |
| **Restructure** | −6% GDP | Haircut + maturity extension for bondholders |
| **IMF Bailout** | −2% GDP | Accept an IMF facility (see [IMF & Bailouts](/wiki/imf)) |
| **Monetize** | no flat GDP hit; damage runs through inflation instead | Print money to cover the debt; blocked once current inflation exceeds 8% |

Repudiate is the most destructive to the economy and to investor confidence but leaves the country debt-free. Restructure splits the pain between the state and bondholders. The IMF bailout has the smallest flat GDP hit among those three paths but comes with ongoing income capture and a temporary sector-margin penalty. Monetize avoids a flat GDP penalty but is gated off once inflation is already high, and triggers its own inflation shock plus, in parliamentary countries, an automatic no-confidence vote.

## Default scar

Regardless of path, a default leaves a **scar** lasting 100 turns:

\`\`\`
scarPenalty = −(100 − turnsSinceDefault) × 0.01
\`\`

This contribution starts at −1.0 on the auction-demand ratio and decays linearly
to zero over 100 turns. It does not directly reduce GDP or other national
economic metrics.

## Cascade depth

Bond-holder insolvency **cascades up to 3 levels deep**. If a major bondholder (a bank, fund, or corporation) is wiped out by a sovereign haircut, its own creditors are stressed; if they fail, the next ring is tested, and so on for three levels. This is how a single sovereign default can trigger a systemic financial crisis.

## Recovery floor

After resolution, the country's bond market stays **closed for 48 turns** before new sovereign auctions can resume:

\`\`\`
recoveryFloor = 48 turns (bond market closed)
\`\`

During this floor the country cannot roll debt, forcing it to run primary surpluses or rely on the IMF facility.

## Summary of constants

| Constant | Value |
| --- | --- |
| BASE_DEMAND | 1.2 |
| Debt-to-GDP penalty threshold | 60% of GDP |
| Normal rate (debt/GDP, above threshold) | 0.3 |
| Cliff rate (debt/GDP > 2.0) | 0.4 |
| Debt-to-GDP cliff threshold | 2.0 |
| Inflation penalty threshold | 5% |
| Inflation rate (above threshold) | 2.0 |
| FX depreciation rate | 1.5 |
| Entity-holdings (Model B) bonus cap | 0.4 |
| Failed-auction threshold | demand < 0.7 |
| Undersubscribed threshold | demand < 1.0 |
| Consecutive failures to trigger | 3 |
| Warning window | 3 turns |
| Executive decision window | 12 turns |
| Legislative vote window | 24 turns per chamber |
| Repudiate GDP penalty | −12% |
| Restructure GDP penalty | −6% |
| IMF bailout GDP penalty | −2% |
| Monetize inflation gate | blocked above 8% inflation |
| Default scar duration | 100 turns |
| Scar per-turn penalty | −1% |
| Cascade depth | 3 levels |
| Recovery floor | 48 turns |

## Public API

\`GET /api/public/v1/sovereigns\` provides a world-wide sovereign watch feed for bots and dashboards. Each country row includes its credit rating, crisis state, debt-to-GDP ratio, auction-failure streak, demand ratio and band, demand components, and Debt Sustainability Assessment score. Values use the same calculations as the in-game sovereign watch surface.

\`GET /api/public/v1/country/[code]/economy/history\` adds the historical view for one country: per-turn interest rates, inflation, and GDP growth plus annual GDP, revenue, spending, surplus, debt principal, debt-to-GDP, and credit-rating snapshots.

Any public or private scoped API key can read both routes. See the [public API documentation](https://docs.lakesidegames.net/api/public-v1.html) for the complete response shapes and turn-range filters.

See also: [Sovereign Bonds](/wiki/sovereign-bonds), [IMF & Bailouts](/wiki/imf), [Central Banks](/wiki/central-banks), [National Budget](/wiki/national-budget)
`;
