export const subsidiesContent = `# Subsidies

Subsidies are government financial support programs that boost corporate profit margins. They are enacted through legislation and represent a legislature's decision to support specific industries, domestically or for any corporation operating in the territory.

## What a subsidy does

Each active subsidy provides a **+7.5 percentage point profit margin bonus** to every qualifying corporation sector. This bonus applies directly to the sector's effective margin before it is capped at 100%.

Subsidies are not a one-time payment: they persist as active policy until explicitly terminated by another bill, providing a continuous margin boost every turn.

## Enacting a subsidy

Subsidies are created through the [legislation system](/wiki/bills-legislation). A bill containing a \`subsidy\` provision, when passed and enacted, creates or updates a subsidy record.

The key parameters in a subsidy provision:

| Parameter | Options | Effect |
| --- | --- | --- |
| Scope | \`national\` or \`state\` | Whether the subsidy covers an entire country or a single state |
| Scope type | \`economy_wide\` or \`sector\` | Whether all sectors qualify or only a specific sector type |
| Target sector | e.g. \`extraction\`, \`healthcare\` | Only used when scope type is \`sector\` |
| Target strategy | e.g. \`oil_gas\`, \`iron_mining\` | Optional; further restricts to sectors using a specific operating strategy |
| Domestic only | \`true\` or \`false\` | If true, only corporations headquartered in the territory qualify |

Re-enacting the same combination of parameters (scope, scope type, target sector, target strategy) updates the existing subsidy rather than creating a duplicate.

## Qualification rules

A corporation sector qualifies for a subsidy if it passes all four filters:

**1. Territory filter**
- For a *national* subsidy: the sector must be operating in that country.
- For a *state* subsidy: the sector must be physically located in that specific state.

**2. Sector type filter**
- If the subsidy targets a specific sector type (\`sector\` scope), the sector's type must match.
- Economy-wide subsidies skip this check.

**3. Strategy filter** (optional)
- If the subsidy specifies a required strategy, the sector's active operating strategy must match.
- Sectors using the default \`standard\` strategy are checked against \`"standard"\`.

**4. Domestic-only filter**
- If \`domesticOnly: true\`, the corporation's headquarters must be in the subsidized territory.
  - National subsidy: corporation's country must match.
  - State subsidy: corporation's headquarters state must match.
- If \`domesticOnly: false\`, foreign corporations operating in the territory also qualify.

## Stacking rules

Multiple subsidies can apply to the same sector, and their bonuses stack additively:

| Active subsidies | Total margin bonus |
| --- | --- |
|| 1 federal economy-wide | +7.5pp |
|| 1 state sector subsidy | +7.5pp |
|| 1 federal + 1 state (same sector) | +15pp |
|| 1 federal economy-wide + 1 federal sector | +15pp |

**Important:** Multiple subsidies of the same exact scope and type do not stack: re-enacting the same provision overwrites the existing record rather than creating a second one. But a federal economy-wide subsidy and a federal sector-specific subsidy for the same sector **do** stack (they are different records). A federal subsidy and a state subsidy also stack freely, since they are different scope levels.

### Stacking example

A pharmaceutical company with healthcare sectors in Germany qualifies for:
- A Germany-wide economy-wide subsidy: +7.5pp
- A Germany healthcare sector subsidy: +7.5pp
- A Bavaria healthcare sector subsidy (if operating in Bavaria): +7.5pp

Total margin bonus: **+22.5pp**, a substantial boost that can make the difference between a marginal and highly profitable operation.

## Market sentiment

When a **sector-scoped subsidy** is enacted, the market reacts with a sentiment pulse:

- **Subsidy created:** +8% to +15% sentiment multiplier for the targeted sector type (default +10%)
- **Subsidy ended:** -8% to -15% sentiment multiplier for the targeted sector type

Sentiment pulses decay at rate **0.85 per turn** and are subject to the global sentiment cap of ±25%. Economy-wide subsidies do not emit sentiment pulses: their effects are too diffuse to register as a market-wide event.

## Ending a subsidy

An \`end_subsidy\` provision in a new bill marks the matching subsidy as \`active: false\`. The record is preserved for historical audit purposes but no longer applies to margin calculations.

Subsidy termination takes effect the turn the enacting bill is processed.

## Fiscal cost

Subsidies are not free for the government. Every turn, the system calculates the total cost of all active subsidies and writes it into the relevant budget:

- **Cost basis:** Under plants, sum realized revenue for qualifying sectors, multiply by \`TURNS_PER_YEAR\`, then by \`0.105\`.
- **Currency normalization:** Sector revenues are converted to the anchor currency via each corporation's FX rate before summing, so cross-currency corporations weight consistently.
- **Budget impact:** The annualized total is written to \`spending.byCategory.sectorSubsidies\` under the federal budget for national subsidies, or the relevant state budget for state subsidies.

A large economy-wide subsidy covering many high-revenue sectors can create a significant budget line item. The cost updates every turn, so subsidy creation and termination are immediately reflected in the fiscal picture.

## Domestic vs. foreign targeting

The \`domesticOnly\` flag is the primary tool for targeting subsidies at home-country corporations:

**\`domesticOnly: false\`** (default): Any corporation operating in the territory qualifies, including foreign-headquartered corporations. This boosts all extraction or manufacturing in a territory regardless of where the profits ultimately flow.

**\`domesticOnly: true\`**: Only corporations headquartered in the territory (or the specific state) qualify. This is the standard approach for industrial policy aimed at protecting or growing national champions.

Combined with tariffs (which penalize foreign corporations), a legislature can create a two-sided policy: domestic corporations get subsidies while foreign competitors face margin penalties.

## Integration with turn processing

Subsidy margin modifiers are calculated during sector processing each turn:

1. All active subsidies for the relevant country are loaded.
2. For each corporation sector, the system checks every subsidy against all four qualification filters.
3. Qualifying subsidies are summed: each adds +7.5pp to the total margin modifier.
4. The modifier is added to the sector's base profit margin before the 100% cap is applied.

The calculation runs as part of the corporation turn phase: see [Corporations](/wiki/corporations) for the broader context of how margins affect revenue and sector health.

## Viewing active subsidies

Active subsidies are visible in the national Congress view and in the legislation history for the enacting bill. Each subsidy's scope, target, and domestic-only flag are displayed, along with the bill that created it.

## Related systems

- **[Tariffs](/wiki/tariffs)**: the counterpart to subsidies, margin penalties imposed on foreign corporations operating in your territory
- **[Bills & Legislation](/wiki/bills-legislation)**: how subsidy provisions get enacted into law
- **[Corporations](/wiki/corporations)**: how profit margins affect sector revenue and corporate performance
- **[Resources](/wiki/resources-overview)**: extraction-sector subsidies are especially effective for resource-rich states
`;
