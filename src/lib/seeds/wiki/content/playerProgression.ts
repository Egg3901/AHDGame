export const playerProgressionContent = `# Player Progression

Your career in A House Divided is a series of escalating gambles: build a base, join a team, win small, use that win to win bigger. This page describes the arc from character creation to head of state, plus the per-office benefits that make each step worth the climb.

## Character creation snapshot

You begin with:

- **₳250,000 Campaign Funds**, ₳0 Cash on Hand
- **25 one-time starting actions**
- **Favorability 50** (neutral)
- **Political Influence 0** (anywhere)
- **Donor Base Level 1**
- **No party**, no office

One character per account. See [Create a Character](/wiki/create-a-character) for every creation-time choice.

## Phase 1: build foundation

You're an independent with no office. You cannot run for office yet. Everything else is available:

- Campaign (+1 PI per action, diminishing above 50, free)
- Fundraise (earns ₳50k + ₳2k × donor level)
- Run Ads (+1 to 3 Favorability, cost scaled by state GDP)
- Build Donor Network (₳3k + ₳1.5k × level, scaled by state GDP, +1 donor level)
- Commission Polls (Quick ₳25k / Full ₳75k)
- Support or Attack other politicians (+/−1% their Favorability)
- Barnstorm for allies (+1% their PI, 5 actions + ₳100k)
- Influence NPPs (endorsements, withdrawals, opposition)
- Post news, form coalitions (if you're a chair later)

Typical Phase 1 goal: Political Influence 40 to 60, Favorability 60 to 70, Donor Level 3, one or two NPP relationships in your target demographic.

## Phase 2: join a party

Independents can't enter primaries. Pick a party whose **economic/social platform is close to your policy positions**: alignment amplifies your Party Influence → bonus-action conversion.

Joining a party immediately unlocks:

- Primary eligibility in your home state / region.
- Party Influence accrual (passive, scales with activity and closeness).
- Bonus actions from the party pool each turn (distributed by Party Influence × alignment).
- Party leadership candidacy (Chair, Vice Chair, Treasurer, elected by members every 72 turns).
- Access to party treasury for coordinated NPP operations.

Switching parties later is allowed but costs: Favorability and Political Influence both take a hit, and your Party Influence resets to 0.

## Phase 3: primary election

When a race's primary phase opens, declare candidacy. Primary scores combine:

- **Policy alignment** to your party's official economic/social position
- **Favorability**
- **Political Influence** (or NPI for presidential primaries)

The highest primary score per party advances to the general. Other party members competing for the same slot are your direct rivals, but attacking them raises your Infamy without necessarily helping you.

See [Primaries](/wiki/primaries) for full primary scoring details.

## Phase 4: general election

You're a party nominee. You face nominees from other parties. Vote accumulates each turn per demographic group, weighted by your **reach** (PI or NPI-based) and **appeal** (favorability × policy closeness to each group).

Final turns are heaviest: roughly 25% of the pool lands in the last ~4 turns. Sustained campaigning wins; bursty campaigning loses.

See [General Elections](/wiki/general-elections) for general-election tactics.

## Phase 5: in office

Winning a legislative office unlocks:

- **Bill writing** (you can propose legislation within the chamber you serve in).
- **Voting on bills**: each vote shifts your own policy position ±0.25 in the bill's direction.
- **Office action and fund bonuses** every turn.
- Committee membership where applicable.

Executive office (President / PM / Chancellor / Governor) adds:

- **Cabinet nomination** (Executives): nominate any character to principal-officer roles.
- **Sign or veto bills** passed by the legislature.
- **Executive orders / actions** where applicable.
- Special per-office privileges covered in the country hubs.

### Office action bonuses

Applied every turn on top of the 4-action base:

| Office | Bonus |
| --- | --- |
| House / State Sen / MP / MdB / Sangiin member | +1 |
| Senate / Vice President | +2 |
| Governor / equivalent sub-national executive | +2 |
| President / Prime Minister / Chancellor | +4 |
| Central Bank Chair | +3 (stacks with elected office) |

### Office fund bonuses (per turn, in local currency)

| Office | Bonus |
| --- | --- |
| House | +₳5,000 |
| State Senate | +₳3,000 |
| Senate | +₳15,000 |
| Vice President | +₳25,000 |
| Governor | +₳15,000 |
| President | +₳50,000 |

Non-US offices grant equivalent bonuses; see each country hub for specifics.

## Phase 6: re-election and advancement

You hold exactly one office at a time. To advance you must:

1. Win the next race **before** your current term forces you out, OR
2. Let your term expire, then contest the next higher office from out-of-office status.

Strategic moves:

- **House → Senate**: Senators earn more actions and funds. Longer terms (12 real days vs 4) let you build NPI faster.
- **Senate → Governor**: Governor has the highest sub-national action and fund bonuses, and appoints Senate vacancies in their state.
- **Governor → President**: Presidential races are NPI-driven. You'll need ~300+ NPI to be competitive, which takes many cycles of sustained state PI.
- **Any office → Party Leadership**: Chair elections fire every 72 turns. Holding chair gives you control of the party's action pool, a serious multiplier when running your own or allied campaigns.

In parliamentary systems (UK / DE / JP) advancement runs through **party leadership** rather than a separate presidential race: your party's leader is the Prime Minister / Chancellor candidate after the legislative election.

## Country-specific arcs

### United States

Standard ladder: State Senate → US House → US Senate → Governor → President. State-level offices serve as a viable endpoint on their own: Governors of large states wield significant real power via policy and cabinet appointments.

### United Kingdom

Ladder: MP (House of Commons) → Party Leader → Prime Minister (if your party wins the most seats and confidence vote passes). No direct "Prime Minister election": the position is a consequence of Commons results and the confidence process.

Detail: [United Kingdom](/wiki/united-kingdom).

### Germany

Ladder: Bundestag MdB → Party Leader → Chancellor (confidence vote by Bundestag). Mixed-member proportional means constituency and list MPs coexist. The Bundesrat provides a secondary legislative chamber representing the Länder.

Detail: [Germany](/wiki/germany).

### Japan

Ladder: Shūgiin (Lower House) or Sangiin (Upper House) member → Party Leader → Prime Minister. Parallel-system elections mean prefectural FPTP seats sit alongside PR list seats; different offices require different electoral strategies.

Detail: [Japan](/wiki/japan).

## Vice President, committee, and Cabinet paths

Beyond elected office, there are appointed and elected sub-roles:

- **Vice President (US)**: chosen by the Presidential candidate as running mate. +2 action bonus; tie-breaks Senate votes.
- **Cabinet Secretary (US)**: nominated by the President, confirmed by the Senate. Fifteen roles exist.
- **Committee Chair (US, UK, DE, JP)**: earned through committee elections within a party or chamber.
- **Central Bank Chair**: separate role; +3 action bonus stacks on any elected office.

None of these are dead ends: cabinet experience often translates into later Senate or Governor runs.

## Stat progression summary

| Stat | Starting | Grows by |
| --- | --- | --- |
| Political Influence | 0 | Campaign (+1/action, diminishing above 50); decays 0.75%/turn |
| National Influence (NPI) | 0 | +state PI / 100 per turn (uncapped, logarithmic in presidential races) |
| Favorability | 50 | Ads, Travel; decays if > 60 |
| Infamy | 0 | Attack or NPP lower action; decays 5%/turn |
| Campaign Funds | ₳250,000 | Fundraise, fund generation, donor base, office bonus |
| Cash on Hand | ₳0 | Passive income, 50% of personal donations made |
| Donor Base Level | 1 | Build Donor Network action |
| Actions | 25 initial | +4 base + office bonus + party bonus per turn; cap 200 |
| Party Influence | 0 | Passive while in party, scaled by activity and alignment |

## Out-of-office activities

When not holding office, you can still:

- Campaign, Fundraise, Run Ads, Build Donor Base (all core actions).
- Support / Attack / Barnstorm other politicians.
- Influence NPPs.
- Post news, form coalitions (as a chair), manage corporations.
- Commission polls.

You **cannot** write bills, vote on legislation, or use office-specific powers (cabinet nominations, executive orders, confidence motions, etc.).

## Related

- [Getting Started](/wiki/getting-started): Onboarding overview.
- [Stats & Actions](/wiki/stats-actions): Full stat and action reference.
- [Election Mechanics](/wiki/election-mechanics): Primary scores, vote accumulation.
- [Parties](/wiki/parties): Party Influence, leadership, action pool.
- [Cabinet](/wiki/cabinet): US cabinet nomination and confirmation.
- [United States](/wiki/united-states) · [United Kingdom](/wiki/united-kingdom) · [Germany](/wiki/germany) · [Japan](/wiki/japan): Country-specific career ladders.
`;
