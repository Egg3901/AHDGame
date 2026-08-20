export const granularPollingContent = `# Granular Polling

A standard poll gives you overall appeal against the twelve broad voter archetypes. Granular polling is a deeper read on the same electorate: exit-poll style marginals and cross-tab segments built from Layer-1 census demographics instead of the archetype buckets. It shows up as an extra panel on your poll results when it is turned on for your world.

## Whether it's available

Granular polling is an admin-controlled world setting. If it is off, your poll results look exactly like the standard poll: overall appeal, top and bottom groups, category breakdowns. If it's on, you get an additional "Granular electorate" panel underneath. There is no separate action or extra cost, it rides on the same poll action you already take, small or large.

## What the panel shows

The electorate in your state is built out of cross-product cells: every combination of the census dimensions available for that country (in the US model, this includes race, age, education, and income, among others). Each cell carries its own share of the electorate, its own turnout, and its own read on how you and your opponents are doing with it.

The panel groups this into dimension tabs. Pick a dimension (say, age) and you see the electorate broken into its buckets (young, middle-aged, mature, senior) with, for each:

- **Share of the electorate.** How much of the state's voting population this segment is.
- **Turnout.** Expected participation for the segment.
- **You %, best opponent %, undecided %.** Your standing in that segment during an active election, when one is running.
- **Margin.** How far ahead or behind you are with that segment.

You can also stack filters across dimensions, click a chip in one row and then another, to drill into a single cross-tab segment (for example: young, college-educated voters specifically) rather than reading one dimension at a time.

## Reading the margin of error

Smaller segments have a wider margin of error, the same reason a national poll can be confident to a point or two while a subgroup crosstab in that same poll bounces around more. A narrow lead inside a small segment is much less reliable than the same lead in the topline number. Treat granular numbers as directional signal for targeting, not as a promise of the exact outcome.

## What this means for you

- Use granular polling to find where your appeal is weak within a state, not just whether it's weak overall. A flat overall appeal number can hide a state where you are dominating one demographic and getting wiped out in another.
- Small, narrow segments (especially after stacking two or more filters) carry the widest error. Do not over-commit a campaign strategy to a single small cross-tab reading.
- If your world doesn't show the granular panel, the feature is simply off for that world; there is nothing broken on your end and no separate unlock to chase.

See also: [Campaign Manager](/wiki/campaign-manager), [Canvassing](/wiki/canvassing).
`;
