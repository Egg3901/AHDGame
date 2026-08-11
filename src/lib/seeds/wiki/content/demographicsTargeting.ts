export const demographicsTargetingContent = `# Demographics & Targeting

Every state has a unique demographic profile that determines who votes, how many of them show up, and how they weight the economic and social policy axes. Understanding this is how you turn "my Favorability is 70" into "my Favorability with Union & Trades voters in Pennsylvania is 58, and that's what's losing me the race."

This page covers the twelve voter archetypes, how they combine to produce state vote totals, and how to target them. For vote-accumulation math see [Election Mechanics](/wiki/election-mechanics); for canvassing mechanics see [Canvassing](/wiki/canvassing).

## The twelve voter archetypes

Each state's voter pool is composed of twelve archetypes with distinct policy leans. The table shows the **national anchors**; actual leans are derived per state from the state's Layer-1 census (see below):

| Archetype | Econ lean | Social lean |
| --- | --- | --- |
| College Liberals | -5 (far left) | -5 (far left) |
| Evangelicals | +4 (right) | +5 (far right) |
| Rural Traditionalists | +4 (right) | +4 (right) |
| Libertarians | +5 (far right) | +2 (centre-right) |
| Young Renters | -4 (left) | -4 (left) |
| Small Business | +4 (right) | +2 (centre-right) |
| Secular Professionals | -3 (centre-left) | -4 (left) |
| Union & Trades | -3 (centre-left) | +1 (centre) |
| Public Sector | -3 (centre-left) | -2 (centre-left) |
| New Americans | -2 (centre-left) | -1 (centre) |
| Retirees | +2 (centre-right) | +3 (centre-right) |
| Soccer Moms | varies | varies |

**Leans are state-derived.** Every archetype is a weighted blend of Layer-1 census groups (race, age, education, wealth, ideology), and each state's archetype leans are computed from that state's own census shares and position overrides. Evangelicals in a deep-red state sit meaningfully further right than Evangelicals in a blue coastal state; College Liberals are furthest left where the surrounding electorate is. Practical consequence: **never assume the national table, poll the state.** The Full Demographic Poll shows the leans your opponents are actually being scored against.

## Reach x appeal x approval x party org x infamy

Every turn, for every candidate, the vote math computes **per-archetype contributions** using five multiplicative factors:

| Factor | Range | What it measures |
| --- | --- | --- |
| **Reach** | 0-1.0 | A square-root curve on influence, clamped to 1.0 at 100 PI/NPI |
| **Appeal** | 0-50 | (50 minus 5 times the econ distance minus 5 times the social distance), squared and divided by 100, plus 25 times the reach curve above |
| **Approval** | 0-1 | Favorability divided by 100 |
| **Party Org** | 0.5-1.0 | 0.5 plus half of state party organization divided by 100 (1.0 for independents) |
| **Infamy** | 0.95-1.0 | 1 minus 0.05 times infamy divided by 100 (1.0 for NPPs) |

For each archetype the turn pool contribution is split among candidates proportional to **appeal x reach x approval x party org x infamy multiplier**. Then the party strength modifier, (1 plus state government approval) times office strength, scales the entire turn pool.

### Appeal is quadratic

The key insight: Appeal is a **quadratic function** of policy distance. A 1-point distance loses you far less than a 4-point distance:

| Distance from group lean (econ + social combined) | Appeal component |
| --- | --- |
| 0 | 50 (max) |
| 2 | 40 |
| 4 | 28 |
| 6 | 16 |
| 8 | 6 |
| 10 | 0 |

A centrist candidate (0, 0) has moderate distance from every group, so appeal sits around 28 across the board. A far-left candidate (-5, -5) has 0 distance from College Liberals (appeal 50+) and 20 distance from Rural Traditionalists (appeal 0). Specialists beat generalists within their core base; generalists beat specialists across the full field.

## Turnout system

Every archetype has a **baseline turnout** rate (e.g. Seniors 65+ vote at ~70%, Young 18-29 at ~38%). This rate can be modified up or down:

- **Player canvassing** action (see [Canvassing](/wiki/canvassing)): cheap, home-state only, per-group, doubles in final 4 turns.
- **Party GOTV** passive spend: automatic based on party treasury allocation.
- **Organic drift**: modifiers decay 2% per turn toward zero.
- **Cap**: plus or minus 20 percentage points from baseline.

Turnout modifiers feed into archetype turnout through **weighted Layer 1 composition**. The canvassing action operates on Layer 1 categories (race, age, education, wealth, ideology); these attributes are then weighted to compute each archetype's turnout. Young Renters are heavily composed of the young age group, so canvassing "Young (18-29)" raises Young Renters' turnout.

## State political lean

Every state has a **turnout-weighted average of all group leans**:

Labels use the shared -5..+5 position ruler, rounded to the nearest step: 0 = Centrist, plus/minus 1 = Center-Left / Center-Right, plus/minus 2 = Lean Left / Lean Right, plus/minus 3 = Left / Right, and so on. Post-calibration state leans typically span about -2.5 to +2.5.

State lean affects:

- **Presidential vote allocation**: lean-aligned candidates receive boosted appeal in presidential races via the per-state lean modifier.
- **Primary party availability**: some parties only field candidates in leaning states.
- **Starting demographic profile**: states have different archetype population shares.

## Targeting strategy

### Know the field

- Commission a **Full Demographic Poll** at the start of every general election you plan to win. ₳75k, 6 actions. Breaks down your per-archetype vote share.
- Identify three categories: **locks** (Appeal > 35, Favorability > 65), **contested** (Appeal 20-35, Favorability 50-65), **lost** (Appeal < 20, Favorability < 50).
- Spend on contested; maintain on locks; ignore lost unless they're huge.

### Play to strengths

- Higher appeal + higher turnout = more votes per action.
- A 1-point Favorability bump on a 15%-of-state archetype is worth more than a 5-point bump on a 2%-of-state archetype.
- Canvassing an archetype where you have Appeal 45 converts turnout directly to votes; canvassing one at Appeal 5 is near-worthless.

### Shore up weaknesses

- Archetypes where you're at Appeal 20-30 are recoverable with ads. Target ads there, lift Favorability 5-10 pts, gain 2-4 effective appeal.
- Archetypes where you're at Appeal 5 are not recoverable mid-cycle. Skip them.

### Use polls, not vibes

- A Quick Poll shows your best-5 and worst-5 groups. A Full Poll shows every group.
- Re-poll when strategy changes (e.g., after a canvassing burst or an opponent's ad spike).
- Track trend data across polls: are you gaining or losing ground in each archetype?

## Canvassing vs ads: what does what

| Tool | Moves | Best for |
| --- | --- | --- |
| Ads (₳100k, 5 actions) | Favorability (0-100) | Lifting approval with groups where you're at 50-70 |
| Canvassing (₳100, 1 action) | Turnout modifier (±20) | Boosting participation of groups that already favour you |

They attack different variables in the same vote formula. If your poll says you **own** Young Renters (Favorability 80, appeal 40) but turnout is only 38%, canvassing Young age group adds 5-10 points of turnout. If your poll says you're 50/50 with Union & Trades, ads lift Favorability directly.

## State-specific profiles

No two states have identical archetype shares. A rural state might be 40% Rural Traditionalists and 30% Evangelicals; an urban coastal state might be 35% Secular Professionals and 15% College Liberals. Check the Full Poll output to see the actual composition: relying on intuition from other states will mislead you.

## Multi-country notes

The twelve-archetype model is **US-centric**. UK, DE, and JP use equivalent archetypes localised to each country's real political landscape:

- **UK:** archetypes tuned to UK Labour/Conservative/SNP voter bases.
- **DE:** archetypes tuned to CDU/SPD/Greens/AfD bases.
- **JP:** archetypes tuned to LDP/CDP/Komeito/Ishin bases.

The math is identical; the specific archetype names and lean values differ. Every country's derived leans are calibrated per era against real historical election results. See each country hub.

## Related

- [Demographics](/wiki/demographics): full system, Layer 1 composition, turnout mechanics.
- [Canvassing](/wiki/canvassing): turnout-boosting action mechanics.
- [Polling](/wiki/polling): quick vs full poll outputs.
- [Election Mechanics](/wiki/election-mechanics): full vote math.
- [Fundraising & Ads](/wiki/fundraising-ads): how to move Favorability.
- [Formula Deep-Dive](/wiki/formula-deep-dive): every formula with derivations.
`;
