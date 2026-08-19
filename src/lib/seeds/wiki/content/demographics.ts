export const demographicsContent = `# Demographics

The demographics system models voter populations in each state. It is the foundation of election mechanics: every vote in every election flows through demographic groups and their alignment with candidates. Demographics are a **voter and election mechanic**, not a corporation mechanic.

## The census: who the electorate is

Each state's electorate is described by its **census**. In the US that is four dimensions:

| Dimension | Buckets |
| --- | --- |
| Race | White, Black, Hispanic, Asian, Other |
| Age | Young (18-29), Mid (30-44), Mature (45-64), Senior (65+) |
| Education | No college, College, Graduate |
| Wealth | Low, Middle, High |

Every state carries its own real shares in each dimension: a rural state has more no-college voters, a coastal metro more graduates. Other countries use their own dimensions and their own buckets (most use ethnicity, age, education, income and urbanization), because a bucket list that fits the US does not fit the UK or Japan.

Each bucket has an economic and a social position on the −5 to +5 scale, and a baseline turnout rate. Positions come from an era position table plus per-state overrides, so **white voters in Texas genuinely sit to the right of white voters in Massachusetts**: regional political texture comes out of the census rather than one national table.

## Cells: how the census becomes voters

The dimensions are combined into **cells**: a cell is one combination across all of them, for example "white, mature, no college, middle income". The engine estimates how many voters sit in each cell by raking the state's own dimension shares together with association priors (no-college voters are more likely to be low income, graduate degrees predict high income, and so on), then prunes the cells too small to matter.

A cell's lean is the average of its buckets' positions, and its turnout is blended from its buckets' participation rates. Cells are what the vote engine counts. Everything you see on a region page, in a poll, or in a turnout action is either a cell or an aggregate of cells.

**Eras.** Every playable era (1953-2023) has its own census bundles and position tables: a 1979 world has a 1979 electorate, not a reweighted 2019 one. Derived leans are calibrated against real historical election results per era and country, and an automated calibration suite keeps them honest.

## How demographics drive elections

During elections, candidates compete for votes from each cell through a multi-factor formula:

### 1. Reach
\`\`\`
reach = politicalInfluence / 100
\`\`\`
How much of the turned-out voters a candidate can actually contact and persuade.

### 2. Appeal
\`\`\`
appeal = (50 − |econDiff| × 5 − |socialDiff| × 5)² / 100 + (politicalInfluence / 100) × 25
\`\`\`
Where \`econDiff\` and \`socialDiff\` are the absolute differences between the candidate's policy positions and the cell's leans. Maximum appeal is 50. Candidates who match a cell's positions score high; candidates far from their positions score low.

### 3. Approval scalar
\`\`\`
approvalScalar = favorability / 100
\`\`\`
Voters won't support candidates they don't approve of, regardless of policy alignment.

### 4. Party organization (general elections)
In general elections, each party gets a multiplier equal to its **normalized share** of the state's total Org:

\`\`\`
orgShare = party.organization / Σ(every party's organization in this state)
\`\`\`

A party with 60 Org in a state where the total is 100 gets a 0.6× multiplier; a party with no presence in the state gets 0 (no votes). Two more general-election factors layer on top:

- **Reg resistance** (1.0×-1.3×): own-Reg makes voters harder to peel away through persuasion
- **Support mood** (0.6×-1.4×): short-term candidate momentum from debates / endorsements / scandals; neutral 1.0× at Support=50

In **primary** elections (intra-party), Org is applied as a uniform neutral \`1×\` instead: within-party normalization would cancel out since all primary candidates share the same Org.

### 5. Vote allocation

Within each cell, candidates split the cell's votes proportional to their relative \`appeal × reach × approvalScalar × orgShare × regResistance × supportMood × infamyMult\` in general elections. Primaries drop the three general-only factors (orgShare / regResistance / supportMood): Org is a neutral \`1×\` intra-party. Either way, the cell votes as a bloc, and each candidate gets a fraction of the cell's total turned-out voters.

Total votes are summed across all cells.

## State political lean

Each state has an overall political lean calculated from its demographics:

1. For each cell: multiply population share × turnout to get voter weight
2. Compute turnout-weighted average economic lean and social lean
3. Average the two leans and clamp to −5..+5

Labels use the shared −5..+5 position ruler, rounded to the nearest step: 0 = Centrist, ±1 = Center-Left / Center-Right, ±2 = Lean Left / Lean Right, ±3 = Left / Right, and so on. Post-calibration state leans typically span about −2.5 to +2.5.

This display label appears on the state page and the political map. It is for display only: elections use raw position differences, not the display lean.

## Turnout manipulation

Candidates and parties can increase (or decrease) how many voters actually vote. Turnout modifiers sit on top of baseline turnout and range from **−20% to +20%**. They are applied to a census bucket, and reach every cell that carries that bucket.

### Party GOTV spending

Party budgets include a turn-by-turn GOTV budget that automatically boosts turnout each turn for aligned voters. A party only boosts groups within **2 points** of the party's position on both economic and social axes, so the DEM party (ideologically left) boosts young and graduate-educated voters, not the groups furthest to its right.

Boost formula per group per turn:
\`\`\`
boost = (budgetPerGroup × 0.01%) × diminishingReturns(currentModifier)
\`\`\`

Diminishing returns: at a +10% existing modifier, a 1% boost becomes only 0.5% effective.

All modifiers decay **2% per turn** toward 0, requiring sustained spending to maintain boosts.

### Player canvassing

The canvassing action targets a specific census bucket in your active campaign state (home state by default; presidential candidates use their travel/primary campaign state):

- **Cost:** 100 funds + 1 action point
- **Base boost:** 0.05 percentage points
- **Alignment multiplier:** Perfect policy alignment = 1.0×, distance 10 = 0.1× minimum
- **Campaign season bonus:** 2× effective during the 4 turns before an election
- **Effect:** Immediate (not queued)

You are most effective canvassing groups that already align with your positions. Mismatched canvassing wastes actions.

## Demographic alignment and character policy

Candidates declare economic and social policy positions on a −5 to +5 scale. These are compared directly to each cell's leans **in that state** when computing appeal. The closer a candidate's positions are to a cell's leans, the higher their appeal with those voters.

This means:
- A candidate at (−4, −4) naturally appeals to young, graduate-educated, urban voters
- The same candidate poorly serves older no-college voters in conservative states
- A centrist candidate (0, 0) has moderate appeal everywhere but strong appeal nowhere
- Because leans are state-derived, the *same* platform lands differently state to state: poll locally rather than assuming a national table

Winning elections requires either mobilizing your natural coalition (GOTV + canvassing) or moderating your positions to pick up the middle-income and mid-age groups that sit closest to the centre.

## Polling

Players can use poll actions to check demographic standings before an election. A full demographic poll breaks the state's electorate down into its cells and shows which segments are strongly for, weakly for, or opposed to your candidacy.

See also: [Election Mechanics](/wiki/election-mechanics), [Government Approval](/wiki/government-approval), [Campaign Strategy](/wiki/campaign-strategy)
`;
