export const nationalMetricsContent = `# National Metrics

National metrics are the economic and social health indicators tracked for each country. They aggregate from state-level data each turn and are the primary scorecard for how well a country is performing. Bills, policies, corporate activity, and player actions all feed into these numbers.

## The core national metrics

### GDP growth

GDP growth measures the percentage change in total economic output. Corporate sector activity first produces a demand signal: owned sectors contribute their growth weighted by revenue, unowned sectors contribute a **0.5% background rate**, and a **40% inertia** smooths the sector signal.

The displayed national rate then runs through the output-gap model:

\`\`\`
sectorSignal = smoothed revenue-weighted sector activity
impulse = sectorSignal - potentialGrowth
gdpGrowth = potentialGrowth + realizedChangeInBoundedOutputGap
\`\`\`

The output gap closes over time, so a one-turn boom or contraction does not permanently reset the printed growth rate.

Potential growth comes from labor-force growth, capital accumulation, and productivity. Productive public spending on infrastructure, transport, housing, and energy can add to capital alongside paid corporate expansion. Both channels share a cap, so they cannot stack into unlimited growth.

Economies below the live GDP-per-capita frontier can also receive a self-extinguishing catch-up bonus. Market economies qualify through ownership, trade, and economic freedom. State-heavy economies can instead qualify through industrial-plan execution, workforce skill, transport efficiency, productive public investment, and trade access. The bonus shrinks as the income gap closes and never reduces frontier-country growth.

### Unemployment

Unemployment follows a simplified Okun's Law relationship with GDP growth relative to the country's **potential growth**:
- **At potential:** No Okun pressure
- **Above potential:** Unemployment falls by 0.2 percentage points per 1% excess growth
- **Below potential:** Unemployment rises by 0.25 percentage points per 1% shortfall

Potential falls back to 2% only when the country has no seeded value. When macro labour effects are active, wage and automation shocks add pressure after Okun. Unemployment has an **85% inertia** and hard bounds of **1% to 15%**.

### Inflation

Inflation is recalculated **every turn** (not just annually), incorporating:
- Central bank prime rate (higher rates dampen inflation)
- GDP growth (higher growth adds demand-pull pressure)
- Unemployment (lower unemployment adds wage-push pressure)
- Commodity prices (commodity cost-push effect)
- Fiscal stance (deficit spending adds inflationary pressure)
- Exchange rates (weaker currency makes imports more expensive)
- Savings flow (deposits dampen, withdrawals stimulate)

The target rate is **2.0%**. Deviations trigger Chair infamy accumulation and affect all corporate margins.

## State-level metrics

GDP growth and unemployment are national aggregates. States also track many more granular metrics organized by category:

### Economic metrics
- Unemployment rate
- Median income
- GDP growth (state-level)
- Poverty rate
- Cost of living
- Small business formation

### Education metrics
- Test performance
- Literacy rate
- Workforce skill
- Education spending
- College enrollment / graduation rates

### Healthcare metrics
- Physician rate
- Health outcomes
- Insurance/access metrics

### Infrastructure metrics
- Power grid reliability
- Road condition
- Broadband access

### Public safety metrics
- Crime rate

### Environment metrics
- Carbon emissions
- Renewable energy percentage

### Governance metrics
- Corruption index

Each metric has a **value** and a **baseline**. Policy effects push values away from baseline; natural decay (0.25% per turn toward baseline) slowly pulls them back.

## How metrics change

### Policy effects

Bills that pass into law apply ongoing effects to state metrics. For example:
- A bill funding public education raises the education spending and literacy rate metrics in targeted states
- An environmental regulation lowers carbon emissions for affected industries
- Infrastructure spending improves road condition or broadband access

Policy effects are applied each turn as long as the law remains enacted.

### Corporate effects

Corporations drive several metrics directly:
- **GDP growth:** Your sector activity feeds the demand signal that moves the national output gap
- **Unemployment:** Growth above or below potential moves unemployment through the Okun relationship
- **Workforce skill:** Technology, Healthcare, Manufacturing, and Defense sectors have higher margins in states with higher workforce skill, and can be affected by a skills mismatch

Additionally, per-sector margin modifiers mean that state conditions feed back into corporate decisions:
| State metric | Effect on corporate margins |
| --- | --- |
| Unemployment rate | ±5% (pivot at 3%) |
| Power grid reliability | −4% below 95% uptime |
| Corruption index | −3% at max index |
| Road condition | ±3% (pivot at 60) |
| Crime rate | −5% (retail, real estate, entertainment) |
| Broadband access | −4% (tech, telecom, media, financial) |
| Workforce skill | ±4% (tech, healthcare, manufacturing, defense) |

### Natural decay

All state metrics decay slowly toward their baseline at **0.25% of the current deviation per turn** (proportional, not flat). A metric displaced 10 points from baseline returns to within 1 point after ~920 turns (roughly 19 game years). Sustained policy and corporate effects are needed to hold metrics away from baseline.

## National aggregation turn

Each turn, after state-level updates complete:
1. State GDP growth rates are GDP-weighted into a national GDP growth figure
2. Unemployment is updated via the Okun relationship
3. Inflation is recalculated using current macro indicators
4. National metric history snapshots are saved

## What players can do

**As a legislator:** Pass bills targeting specific state metrics. Subsidies for specific sectors, infrastructure spending, education funding: each enacted law leaves a permanent trace in the budget and the metrics it affects.

**As a CEO:** Grow your corporation's sectors to drive state GDP growth. High-growth sectors in a state improve the employment situation over time.

**As a Central Bank Chair:** Adjust the prime rate to manage inflation and indirectly support or constrain GDP growth. The Chair's effectiveness is measured against the 2.0% inflation and 2.0% GDP growth targets.

**As Governor/President:** Your approval rating is partly driven by economic conditions in your country or state. Strong GDP growth and low unemployment improve your standing; high inflation and unemployment hurt it.

See also: [Government Approval](/wiki/government-approval), [Central Banks](/wiki/central-banks), [National Budget](/wiki/national-budget), [Corporations](/wiki/corporations)
`;
