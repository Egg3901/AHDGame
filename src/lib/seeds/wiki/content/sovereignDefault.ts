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

The demand ratio is driven down by three penalties that stack:

### Debt-to-GDP penalty

\`\`\`
BASE_DEMAND = 1.2
FLOOR       = 0.6
RATE        = 0.3     // normal regime
CLIFF_RATE  = 0.4     // kicks in once debt/GDP > 2.0

demand = BASE_DEMAND − RATE × min(debtGDP, 2.0)
if debtGDP > 2.0:
    demand −= CLIFF_RATE × (debtGDP − 2.0)
demand = max(demand, FLOOR)
\`\`

The cliff at 2.0× debt-to-GDP means crossing that threshold accelerates the collapse: the rate steepens from 0.3 to 0.4 per unit of excess leverage.

### Inflation penalty

\`\`\`
inflationPenalty = max(inflation × 2.0, floor 0.05)
\`\`

A minimum 0.05 penalty applies even at low inflation; above that it scales linearly with the inflation rate.

### FX depreciation penalty

\`\`\`
fxPenalty = depreciation × 1.5
\`\`

A weakening currency compounds the demand problem: foreign buyers face a depreciating asset.

The final demand ratio is the base minus all three penalties, floored at 0.6.

## Warning window

The system gives a **3-turn warning** before the crisis formally fires. During this window the country dashboard and \`/world/crises\` show a countdown, giving the executive a chance to act pre-emptively (cut spending, raise rates, negotiate).

## Crisis windows

Once the crisis triggers, two clocks start:

| Decision | Window |
| --- | --- |
| Executive proposes a resolution | 12 turns |
| Each legislative chamber votes | 24 turns per chamber |

If either window expires without action, consequences escalate (forced resolution, governance collapse, or automatic repudiation depending on the country's constitution).

## Resolution paths

The executive selects one of three resolutions, each with a different GDP penalty:

| Path | GDP penalty | Description |
| --- | --- | --- |
| **Repudiate** | −12% GDP | Refuse to pay; bondholders take the full hit |
| **Restructure** | −6% GDP | Haircut + maturity extension for bondholders |
| **IMF Bailout** | −2% GDP | Accept an IMF facility (see [IMF & Bailouts](/wiki/imf)) |

Repudiate is the most destructive to the economy and to investor confidence but leaves the country debt-free. Restructure splits the pain between the state and bondholders. The IMF bailout is the smallest immediate GDP hit but comes with the IMF's own ongoing conditions (income capture, share-price discount).

## Default scar

Regardless of path, a default leaves a **scar** lasting 100 turns:

\`\`\`
scarPenalty = −1% per turn (applied for 100 turns)
\`\`

This is a persistent drag on economic performance for the full 100 turns.

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
| Demand floor | 0.6 |
| Normal rate (debt/GDP) | 0.3 |
| Cliff rate (debt/GDP > 2.0) | 0.4 |
| Debt-to-GDP cliff threshold | 2.0 |
| Inflation floor | 0.05 |
| Inflation rate | 2.0 |
| FX depreciation rate | 1.5 |
| Failed-auction threshold | demand < 0.7 |
| Undersubscribed threshold | demand < 1.0 |
| Consecutive failures to trigger | 3 |
| Warning window | 3 turns |
| Executive decision window | 12 turns |
| Legislative vote window | 24 turns per chamber |
| Repudiate GDP penalty | −12% |
| Restructure GDP penalty | −6% |
| IMF bailout GDP penalty | −2% |
| Default scar duration | 100 turns |
| Scar per-turn penalty | −1% |
| Cascade depth | 3 levels |
| Recovery floor | 48 turns |

See also: [Sovereign Bonds](/wiki/sovereign-bonds), [IMF & Bailouts](/wiki/imf), [Central Banks](/wiki/central-banks), [National Budget](/wiki/national-budget)
`;
