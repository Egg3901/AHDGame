export const demographicsContent = `# Demographics

The demographics system models voter populations in each state. It is the foundation of election mechanics: every vote in every election flows through demographic groups and their alignment with candidates. Demographics are a **voter and election mechanic**, not a corporation mechanic.

## The 12 voter archetypes

Each state's electorate is divided into **12 mutually exclusive voter archetypes**. Every voter belongs to exactly one archetype. Each archetype has an ideological lean (economic and social, on a −5 to +5 scale) and a turnout rate. The table below shows the **national default leans**, but see *Layer 1: where the numbers come from* below: in each state the actual leans are derived from that state's own census makeup, so the same archetype leans differently in different states.

| Archetype | Economic lean | Social lean | Default turnout |
| --- | --- | --- | --- |
| Young Renters | −4 | −4 | 38% |
| Evangelicals | +4 | +5 | 72% |
| Rural Traditionalists | +4 | +4 | 68% |
| Union & Trades | −3 | +1 | 52% |
| Soccer Moms | 0 | −1 | 58% |
| College Liberals | −5 | −5 | 68% |
| Small Business | +4 | +2 | 72% |
| Public Sector Workers | −3 | −2 | 70% |
| Retirees | +2 | +3 | 72% |
| Libertarians | +5 | +2 | 68% |
| New Americans | −2 | −1 | 42% |
| Secular Professionals | −3 | −4 | 74% |

The population percentage of each archetype varies by state: a rural state has far more Rural Traditionalists than a coastal metro area.

## Layer 1: where the numbers come from

Underneath the archetypes sits the **Layer 1 census**: every state carries real demographic shares across five dimensions: **race, age, education, wealth, and ideology**. Each archetype is defined as a weighted blend of these Layer-1 groups (Young Renters are mostly young + no-college + low-wealth; Secular Professionals are college/graduate + middle/high wealth + progressive-leaning).

Three things are derived from the census, per state:

- **Composition**: how large each archetype is. Layer-1 shares are multiplied by each group's turnout rate, so the archetype mix reflects *voters*, not raw population.
- **Lean**: each archetype's economic/social position is the share-weighted average of its constituent Layer-1 groups' positions. Every era has a base position table, and states carry their own per-group position overrides on top, so **Evangelicals in Texas genuinely sit to the right of Evangelicals in Massachusetts**: regional political texture emerges from the census instead of one national table.
- **Turnout**: each archetype's baseline turnout is blended from its Layer-1 groups' participation rates (seniors vote more than 18-29s), with a civic-engagement multiplier for groups facing structural barriers.

**Eras.** Every playable era (1953-2023) has its own census bundles and position tables: a 1979 world has a 1979 electorate, not a reweighted 2019 one. Derived leans are calibrated against real historical election results per era and country, and an automated calibration suite keeps them honest.

## How demographics drive elections

During elections, candidates compete for votes from each archetype through a multi-factor formula:

### 1. Reach
\`\`\`
reach = politicalInfluence / 100
\`\`\`
How much of the turned-out voters a candidate can actually contact and persuade.

### 2. Appeal
\`\`\`
appeal = (50 − |econDiff| × 5 − |socialDiff| × 5)² / 100 + (politicalInfluence / 100) × 25
\`\`\`
Where \`econDiff\` and \`socialDiff\` are the absolute differences between the candidate's policy positions and the archetype's leans. Maximum appeal is 50. Candidates who match an archetype's positions score high; candidates far from their positions score low.

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

Within each archetype, candidates split the group's votes proportional to their relative \`appeal × reach × approvalScalar × orgShare × regResistance × supportMood × infamyMult\` in general elections. Primaries drop the three general-only factors (orgShare / regResistance / supportMood): Org is a neutral \`1×\` intra-party. Either way, the group votes as a bloc, and each candidate gets a fraction of the group's total turned-out voters.

Total votes are summed across all archetypes.

## State political lean

Each state has an overall political lean calculated from its demographics:

1. For each archetype: multiply population share × turnout to get voter weight
2. Compute turnout-weighted average economic lean and social lean
3. Average the two leans and clamp to −5..+5

Labels use the shared −5..+5 position ruler, rounded to the nearest step: 0 = Centrist, ±1 = Center-Left / Center-Right, ±2 = Lean Left / Lean Right, ±3 = Left / Right, and so on. Post-calibration state leans typically span about −2.5 to +2.5.

This display label appears on the state page and the political map. It is for display only: elections use raw position differences, not the display lean.

## Turnout manipulation

Candidates and parties can increase (or decrease) how many voters from each archetype actually vote. Turnout modifiers sit on top of baseline turnout and range from **−20% to +20%**.

### Party GOTV spending

Party budgets include a turn-by-turn GOTV budget that automatically boosts turnout each turn for aligned archetypes. A party only boosts archetypes within **2 points** of the party's position on both economic and social axes, so the DEM party (ideologically left) boosts Young Renters and College Liberals, not Evangelicals.

Boost formula per archetype per turn:
\`\`\`
boost = (budgetPerArchetype × 0.01%) × diminishingReturns(currentModifier)
\`\`\`

Diminishing returns: at a +10% existing modifier, a 1% boost becomes only 0.5% effective.

All modifiers decay **2% per turn** toward 0, requiring sustained spending to maintain boosts.

### Player canvassing

The canvassing action targets a specific archetype in your active campaign state (home state by default; presidential candidates use their travel/primary campaign state):

- **Cost:** 100 funds + 1 action point
- **Base boost:** 0.05 percentage points
- **Alignment multiplier:** Perfect policy alignment = 1.0×, distance 10 = 0.1× minimum
- **Campaign season bonus:** 2× effective during the 4 turns before an election
- **Effect:** Immediate (not queued)

You are most effective canvassing archetypes that already align with your positions. Mismatched canvassing wastes actions.

## Demographic alignment and character policy

Candidates declare economic and social policy positions on a −5 to +5 scale. These are compared directly to each archetype's leans **in that state** when computing appeal. The closer a candidate's positions are to an archetype's leans, the higher their appeal with that group.

This means:
- A candidate at (−4, −4) naturally appeals to College Liberals and Young Renters
- The same candidate poorly serves Evangelicals and Small Business owners
- A centrist candidate (0, 0) has moderate appeal everywhere but strong appeal nowhere
- Because leans are state-derived, the *same* platform lands differently state to state: poll locally rather than assuming the national table

Winning elections requires either mobilizing your natural coalition (GOTV + canvassing) or moderating your positions to pick up swing groups like Soccer Moms or Union & Trades.

## Polling

Players can use poll actions to check demographic standings before an election. A full demographic poll breaks down support by every archetype in a state, showing which groups are strongly for, weakly for, or opposed to your candidacy.

See also: [Election Mechanics](/wiki/election-mechanics), [Government Approval](/wiki/government-approval), [Campaign Strategy](/wiki/campaign-strategy)
`;
