export const demographicsTargetingContent = `# Demographics & Targeting

Every state has a unique demographic profile that determines who votes, how many of them show up, and how they weight the economic and social policy axes. Understanding this is how you turn "my Favorability is 70" into "my Favorability with no-college voters in Pennsylvania is 58, and that's what's losing me the race."

This page covers the census buckets, how they combine to produce state vote totals, and how to target them. For vote-accumulation math see [Election Mechanics](/wiki/election-mechanics); for canvassing mechanics see [Canvassing](/wiki/canvassing).

## The census buckets

A US state's voter pool is described by four dimensions. Every voter sits in one bucket of each:

| Dimension | Buckets |
| --- | --- |
| Race | White, Black, Hispanic, Asian, Other |
| Age | Young (18-29), Mid (30-44), Mature (45-64), Senior (65+) |
| Education | No college, College, Graduate |
| Wealth | Low, Middle, High |

The engine combines them into **cells** (for example "Black, mid, college, middle income"), estimating each cell's size from the state's own shares. A cell's lean is the average of its buckets' positions and its turnout is blended from their participation rates. Cells are what the vote engine counts.

**Leans are state-derived.** Each state carries its own position overrides on top of the era's base table, so white voters in a deep-red state sit meaningfully further right than white voters in a blue coastal state, and graduate-educated voters are furthest left where the surrounding electorate is. Practical consequence: **never assume a national table, poll the state.** The Full Demographic Poll shows the leans your opponents are actually being scored against.

## Reach x appeal x approval x party org x infamy

Every turn, for every candidate, the vote math computes **per-cell contributions** using five multiplicative factors:

| Factor | Range | What it measures |
| --- | --- | --- |
| **Reach** | 0-1.0 | A square-root curve on influence, clamped to 1.0 at 100 PI/NPI |
| **Appeal** | 0-50 | A power-curve position score (exponent 1.5, not squared) on econ/social distance, plus a small directional bonus for tribally-aligned candidates, plus a normalized-influence term worth up to 12.5 |
| **Approval** | 0-1 | Favorability divided by 100 |
| **Party Org** | 0-1.0 | Each party's organization as a normalized share of the state's total organization (0 for parties with no presence there; independents use a neutral fallback) |
| **Infamy** | 0.95-1.0 | 1 minus 0.05 times infamy divided by 100 (1.0 for NPPs) |

For each cell the turn pool contribution is split among candidates proportional to **appeal x reach x approval x party org x infamy multiplier**. Then the party strength modifier, (1 plus state government approval) times office strength, scales the entire turn pool.

### Appeal is a softened power curve

The key insight: Appeal responds to policy distance through a **power curve with exponent 1.5**, not a square. A 1-point distance loses you less than a 4-point distance, but the curve is deliberately softer than squaring so that campaigning, favorability, and org still move outcomes instead of ideology alone dominating every race.

A centrist candidate (0, 0) has moderate distance from every group, so appeal sits in the middle across the board. A far-left candidate (-5, -5) is nearly on top of the most progressive cells (appeal near max) and far from the most conservative ones (appeal near the floor). Specialists beat generalists within their core base; generalists beat specialists across the full field.

## Turnout system

Every bucket has a **baseline turnout** rate (e.g. Seniors 65+ vote at ~70%, Young 18-29 at ~38%). This rate can be modified up or down:

- **Player canvassing** action (see [Canvassing](/wiki/canvassing)): cheap, home-state only, per-bucket, doubles in final 4 turns.
- **Party GOTV** passive spend: automatic based on party treasury allocation.
- **Organic drift**: modifiers decay 2% per turn toward zero.
- **Cap**: plus or minus 20 percentage points from baseline.

A modifier applies to the bucket you targeted and reaches every cell that carries it. Boosting "Young (18-29)" raises turnout in every young cell, whatever its race, education or wealth.

## State political lean

Every state has a **turnout-weighted average of all cell leans**:

Labels use the shared -5..+5 position ruler, rounded to the nearest step: 0 = Centrist, plus/minus 1 = Center-Left / Center-Right, plus/minus 2 = Lean Left / Lean Right, plus/minus 3 = Left / Right, and so on. Post-calibration state leans typically span about -2.5 to +2.5.

State lean affects:

- **Presidential vote allocation**: lean-aligned candidates receive boosted appeal in presidential races via the per-state lean modifier.
- **Primary party availability**: some parties only field candidates in leaning states.
- **Starting demographic profile**: states have different census shares.

## Targeting strategy

### Know the field

- Commission a **Full Demographic Poll** at the start of every general election you plan to win. ₳75k, 6 actions. Breaks down your vote share segment by segment.
- Identify three categories: **locks** (Appeal > 35, Favorability > 65), **contested** (Appeal 20-35, Favorability 50-65), **lost** (Appeal < 20, Favorability < 50).
- Spend on contested; maintain on locks; ignore lost unless they're huge.

### Play to strengths

- Higher appeal + higher turnout = more votes per action.
- A 1-point Favorability bump on a 15%-of-state segment is worth more than a 5-point bump on a 2%-of-state segment.
- Canvassing a bucket where you have Appeal 45 converts turnout directly to votes; canvassing one at Appeal 5 is near-worthless.

### Shore up weaknesses

- Segments where you're at Appeal 20-30 are recoverable with ads. Target ads there, lift Favorability 5-10 pts, gain 2-4 effective appeal.
- Segments where you're at Appeal 5 are not recoverable mid-cycle. Skip them.

### Use polls, not vibes

- A Quick Poll shows your best-5 and worst-5 segments. A Full Poll shows the whole electorate.
- Re-poll when strategy changes (e.g., after a canvassing burst or an opponent's ad spike).
- Track trend data across polls: are you gaining or losing ground in each segment?

## Canvassing vs ads: what does what

| Tool | Moves | Best for |
| --- | --- | --- |
| Ads (₳100k, 5 actions) | Favorability (0-100) | Lifting approval with groups where you're at 50-70 |
| Canvassing (₳100, 1 action) | Turnout modifier (±20) | Boosting participation of groups that already favour you |

They attack different variables in the same vote formula. If your poll says you **own** young voters (Favorability 80, appeal 40) but their turnout is only 38%, canvassing the Young bucket adds 5-10 points of turnout. If your poll says you're 50/50 with no-college voters, ads lift Favorability directly.

## State-specific profiles

No two states have identical census shares. A rural state might be 70% no-college and heavily mature/senior; an urban coastal state might be a third graduate-educated. Check the Full Poll output to see the actual composition: relying on intuition from other states will mislead you.

## Multi-country notes

The four-dimension model above is **US-specific**. Other countries use their own census dimensions, and the buckets inside them differ too:

- Most non-US models use **ethnicity, age, education, income and urbanization**.
- Education buckets are country-real: the UK runs no qualifications through degree-plus, Germany runs no-degree through Hochschulabschluss, Brazil has three levels where Japan has five.

The math is identical; the dimension list and bucket names differ. Every country's derived leans are calibrated per era against real historical election results. See each country hub.

## Related

- [Demographics](/wiki/demographics): full system, census composition, turnout mechanics.
- [Canvassing](/wiki/canvassing): turnout-boosting action mechanics.
- [Polling](/wiki/polling): quick vs full poll outputs.
- [Election Mechanics](/wiki/election-mechanics): full vote math.
- [Fundraising & Ads](/wiki/fundraising-ads): how to move Favorability.
- [Reference: Formulas](/wiki/reference-formulas): every formula with derivations.
`;
