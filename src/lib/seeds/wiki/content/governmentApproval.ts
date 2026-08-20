export const governmentApprovalContent = `# Government Approval

Government approval measures how much of the population supports the current government. It is tracked per country as a percentage (0-100) and updates each turn. Low approval has real political consequences: it weakens the governing party's position and can embolden opposition action.

## How approval is derived

Government approval is computed from **state metrics compared against national averages**, not from the head of government's personal favorability. Every turn, the game evaluates each state's performance across 10 metric categories, compares each metric to the national average, and produces a state approval score. National approval is the population-weighted average of all state scores.

This means approval reflects the objective condition of the country: economy, healthcare, infrastructure, safety, environment, as experienced by the population, rather than the popularity of any individual politician.

> **Note:** Presidential systems formally track approval as tied to the president's standing, while parliamentary-style and one-party systems track it as tied to the PM's standing. In practice, the live system always computes approval through the aggregate metric method described below, regardless of government type.

## Metric categories

Approval walks 10 `stateMetrics` category buckets (including population). Some cohort metrics in population are skipped as approval terms. The live metric engine has additional country-specific nodes beyond the sample table:

| Category | Sample Metrics |
| --- | --- |
| Economic | Unemployment rate, median income, GDP growth, poverty rate, cost of living, small business formation |
| Education | High school graduation rate, university enrollment, test performance, education spending, literacy rate, workforce skill |
| Healthcare | Uninsured rate, affordability index, physician rate, life expectancy, preventable mortality, public health preparedness |
| Infrastructure | Road condition, broadband access, public transit, water quality, power grid reliability, infrastructure investment gap |
| Public Safety | Crime rate, violent crime rate, police per capita, incarceration rate, recidivism rate, public safety confidence |
| Environment | Air quality, renewable energy, carbon emissions, recycling rate, climate resilience, protected land |
| Social | Social mobility, income inequality, homelessness rate, food insecurity, civic participation, social cohesion |
| Governance | Government transparency, budget balance, corruption index, voter turnout, public trust |
| Population | Population growth, urbanization rate, median age, migration rate |
| Media & Information | Media polarization, disinformation risk, press freedom, social media sentiment, news trust |

For each metric, the game knows whether higher values are good (e.g., GDP growth, life expectancy) or lower values are good (e.g., unemployment, crime rate). The direction is inverted for "lower is better" metrics before comparison.

## The calculation

### Per-metric contribution

For every metric where both the state value and national average are available:

\`\`\`
pctDiff = (stateValue - nationalAverage) / nationalAverage
signedDiff = higherIsBetter ? pctDiff : -pctDiff
contribution = clamp(signedDiff * 15, -2, +2)
\`\`\`

Each metric can contribute at most +/-2 points to the score. The scale factor of 15 means a metric must be roughly 13% above average to hit the +2 cap, or 13% below to hit -2.

### State approval formula

\`\`\`
baseScore = 50 + (sum of all contributions / number of metrics evaluated) * 2.5
stateApproval = clamp(baseScore, 0, 100)
\`\`\`

If a state has no metrics data, it defaults to 50%.

### National approval

\`\`\`
nationalApproval = sum(stateApproval * statePopulation) / sum(statePopulation)
\`\`\`

The national score is rounded to one decimal place and clamped to 0-100.

### Named modifiers

After the base metric score is computed, the system checks for **named conditions** (styled after Democracy 3) that add or subtract small bonuses when their thresholds are met. These stack: multiple active conditions sum their effects.

There are **82** defined modifiers, each with 1-3 metric conditions that must all be met. Examples:

| Modifier | Effect | Conditions |
| --- | --- | --- |
| Economic Boom | +2 | GDP growth >= 3.0% AND unemployment <= 4.5% |
| Recession | -3 | GDP growth <= 0% AND unemployment >= 7% |
| Healthcare Excellence | +2 | Life expectancy >= 83 AND affordability >= 78 |
| Healthcare System Strain | -2 | Affordability <= 48 AND preventable mortality >= 350 |
| Low Crime Rate | +2 | Crime rate <= 2,800 AND safety confidence >= 70 |
| Crime Wave | -2 | Crime rate >= 5,000 AND violent crime >= 380 |
| Clean Environment | +2 | Renewable energy >= 50% AND air quality <= 25 |
| Environmental Degradation | -2 | Air quality >= 48 AND carbon emissions >= 18 |
| High Government Transparency | +2 | Transparency >= 78 AND public trust >= 62 |
| High Corruption | -3 | Corruption index >= 48 AND public trust <= 35 |
| Fiscal Crisis | -2 | Budget balance <= -5.0% of GDP |
| Modern Infrastructure | +2 | Roads >= 80, broadband >= 90, water >= 95 |
| Crumbling Infrastructure | -2 | Roads <= 55, water <= 80, broadband <= 68 |
| Free Press | +1 | Press freedom >= 75 |
| Restricted Press Freedom | -2 | Press freedom <= 40 AND disinformation risk >= 50 |
| Strong Social Cohesion | +1 | Social cohesion >= 68 AND civic participation >= 62 |
| Social Fragmentation | -2 | Food insecurity >= 16 AND social cohesion <= 45 |
| Cost of Living Crisis | -2 | Cost of living >= 140 AND poverty >= 17% |
| Population Decline | -1 | Population growth <= 0 AND migration <= 0 |
| High Immigration Pressure | -1 | Migration rate >= 0.4% |

The full set of 82 modifiers covers economic, healthcare, safety, environmental, governance, social, infrastructure, media, and demographic conditions. Effects range from -3 (severe crises) to +2 (exceptional performance), with most modifiers at +/-1.

Modifiers are evaluated against the same flat metrics map used for the base score, so they work on both individual states and pre-computed national averages.

### Per-turn damping

Approval doesn't jump straight to its freshly-computed target each turn. Each state's stored rating is stepped toward the target by **at most 2 points per turn**, so even a modifier swing that would otherwise move approval by double digits plays out gradually over several turns rather than landing all at once.

### Cabinet penalties

Two penalties are applied to the **national** approval score after all metric and modifier calculations:

| Penalty | Condition | Amount |
| --- | --- | --- |
| No cabinet | Country has zero confirmed cabinet members | -7.5 |
| Acting appointments | Each unconfirmed (acting) cabinet member in countries with Senate confirmation | -0.5 per acting member |

A country without a functioning cabinet is heavily penalised. The acting-appointment penalty stacks per member, so a cabinet with 5 acting members loses an additional 2.5 points.

## What is tracked

Each country has one approval record with:
- **Approval rating:** 0-100, percentage of population approving
- **Disapproval rating:** 0-100, percentage disapproving (computed as 100 - approval)
- **Net approval:** approval minus disapproval (can be negative)
- **Source:** always the aggregate metric method, not personal favorability
- **History:** last 20 turns of approval/net values for charting (capped at 20 entries)

Approval and disapproval sum to exactly 100: there is no "undecided" category in this system.

## Crises and approval

Active crises can apply **direct approval effects** each turn, adding or subtracting from the national approval rating of all affected countries. These are flat or tick-based effects applied during turn processing, after corporations and before history snapshots. A major crisis can swing approval by several points per turn independently of the metric-based calculation.

## Snap elections

The wiki previously claimed that low UK government approval triggers snap elections. **This is incorrect.** Snap elections in parliamentary countries (UK, JP, DE) are triggered by:

1. **PM initiative:** A sitting Prime Minister (or Chancellor in DE) voluntarily dissolves the lower chamber.
2. **PM vacancy deadline:** If no PM is appointed within 96 turns of the government entering "pending" status, the system auto-triggers a snap election.

There is **no approval threshold** for snap elections. The 96-turn vacancy clock is the automatic trigger. See [Snap Elections](/wiki/snap-elections) for full mechanics.

For US and other fixed-term systems, low approval does not directly end a term, but it affects re-election prospects and can empower opposition members to pursue impeachment or no-confidence motions.

## Reading the approval tracker

From any country's main page or government page, the approval chart shows:
- Current approval and disapproval percentages
- Net approval trend over the last 20 turns
- Comparison to previous governments (historical line)

A net approval above +10 is generally considered safe political territory. Net approval below 0 (more disapproval than approval) is a warning sign.

## Relationship to elections

Government approval **directly scales the vote pool** in every election. Each state's government approval rating is converted to a decimal and applied as a strength multiplier:

- **Presidential elections:** \`(1 + (approval - 0.5) * 0.5) *
  officeStrength\`, a swing of up to +/-25% from the 50% baseline
- **Legislative and other elections:** \`(1 + (approval - 0.5) * 0.2) *
  officeStrength\`, a swing of up to +/-10%

On top of this direct scaling, approval is a useful **leading indicator**:
- Low approval reflects poor national conditions, which hurts the governing party's candidates through the direct multiplier and through primary resolution
- Low approval motivates opposition players to run stronger campaigns and pass no-confidence votes
- High approval gives the governing party a morale and recruitment advantage
- Crisis-driven approval swings can signal electoral volatility

## Strategic management

**As head of government:**
- Pass legislation that improves economic and social metrics: these feed directly into approval
- Monitor the 10 metric categories; weakness in any one drags the average
- Appoint a capable Central Bank Chair who keeps inflation near 2% and GDP growth positive
- Form a full cabinet promptly: the -7.5 no-cabinet penalty is severe
- Avoid acting appointments where Senate confirmation is available

**As opposition:**
- Track metric trends: if inflation rises or unemployment spikes, approval will follow downward
- Vote against government bills that would improve key metrics
- In the UK: monitor the PM vacancy clock, not approval thresholds, for snap election opportunities

See also: [National Metrics](/wiki/national-metrics), [Demographics](/wiki/demographics), [Central Banks](/wiki/central-banks), [Snap Elections](/wiki/snap-elections), [Crisis System](/wiki/crisis-system)
`;
