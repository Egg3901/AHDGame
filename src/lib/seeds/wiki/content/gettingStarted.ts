export const gettingStartedContent = `# Welcome to A House Divided

A House Divided is a **real-time political simulation**. You create a politician, build a base in your home state or region, run for office, vote on bills, and climb the career ladder against a world full of other players and autonomous NPPs (Non-Player Politicians). The world runs continuously (**1 real hour is 1 game turn**), and elections are always in progress somewhere.

This page gets you from account creation to your first campaign in the shortest useful path. When you're ready to dig deeper, each section links to a more detailed guide.

## Pick a country

A House Divided currently supports six playable countries. Each has its own political system, electoral rules, and offices.

| Country | Legislature | Top office | Electoral system |
| --- | --- | --- | --- |
| 🇺🇸 United States | Congress (House + Senate) | President | FPTP + Electoral College |
| 🇬🇧 United Kingdom | Parliament (Commons + Lords) | Prime Minister | Multi-seat regional PR |
| 🇩🇪 Germany | Bundestag + Bundesrat | Chancellor | Mixed-member PR |
| 🇯🇵 Japan | Diet (Shūgiin + Sangiin) | Prime Minister | Parallel + PR |
| 🇨🇳 China | National People's Congress | Premier | One-party (delegate-elected); see [One-Party States](/wiki/one-party-states) |
| 🇮🇪 Ireland | Oireachtas (Dáil + Seanad) | Taoiseach; Uachtarán (head of state, separate election) | PR-STV multi-seat constituencies |

Country choice is durable. You can relocate later (see [Relocation](/wiki/relocation)), but cross-country moves wipe party membership, national influence, and any national-level positions. Pick the country you want to play.

You can only campaign against, fund, or influence politicians **within your own country**: cross-country interactions are blocked by design.

## The first ten minutes

1. **Create your character.** Name, country, home state or region, avatar, and two policy positions on the economic and social axes (−5 to +5). Full details: [Create a Character](/wiki/create-a-character).
2. **Accept your starting kit.** You begin with **25 bonus actions**, **₳250,000 in Campaign Funds**, \`0\` Political Influence, \`50\` Favorability (neutral), and no office.
3. **Join a party.** Independents can fundraise, campaign, post news, and enter primaries (they run in the "independent" primary like any other party). However, party membership unlocks the party action pool and improves your primary scores through platform alignment. Pick the party whose platform is closest to your policy positions.
4. **Spend a few actions on Campaign (1 action, free) to build Political Influence.** This is the cheapest, most repeatable action in the game and the fastest way to raise your state profile.
5. **Check your state's upcoming elections.** Your home state has perpetual races (House, State Senate, Governor) plus your chamber's national race. Most new players aim at a State Senate or House seat first.

That's the core loop. The rest of this page is "where to go next."

## Your two money pools

Two separate pools: they don't mix.

- **Campaign Funds**: your political war chest. Built by fundraising and per-turn generation. Spent on Ads, Polls, Donor Base, NPP influence, party taxes, and personal campaign donations. Starts at ₳250,000.
- **Cash on Hand**: your personal liquid cash. Earned from passive income and a slice of any Personal Campaign Donations you make. Only spent on **wire transfers** to other politicians from the Portfolio page. Starts at ₳0.

If an action costs "funds," it means Campaign Funds unless explicitly labelled "personal cash."

## The stats that matter week one

You have a lot of stats. These four matter first:

| Stat | Range | How to grow | What it does |
| --- | --- | --- | --- |
| Political Influence | 0 to 100 | Campaign action (+1% per action) | Drives reach in state elections; decays 0.75%/turn |
| Favorability | 0 to 100 | Ads (+1 to 3, diminishing above 70%) | Drives vote appeal; starts at 50 |
| Donor Base Level | 1+ | Build Donor Network action | Scales fundraising income per turn |
| Party Influence | 0 to 100 | Passive (stay active in party) | Your share of the party's bonus action pool |

Full list with every stat, action, and formula: [Stats & Actions](/wiki/stats-actions).

## Actions: base and bonus

You earn actions each turn and they carry over (cap 200; hoarding penalty −4/turn above 100, so don't stockpile forever).

- **Base**: 4 actions per turn.
- **Office bonus** (if you hold office): House/State Senate +1, Senate/VP +2, Governor +3, President +4. Non-US offices grant equivalent bonuses.
- **Party bonus**: A variable share of your party's action pool, distributed each turn based on your Party Influence and platform alignment.

The one-time **25-action starting grant** is yours to spend on whatever you like. A common opener is: 2× Build Donor Network (~₳4.5k + ~₳6k = ~₳10.5k for donor level 1→3), one Run Advertisements (scaled by state GDP, ~₳100k at national average), and the rest on Campaign actions.

## Your first race

Until you're elected you can't write bills or vote on legislation, but everything else is available. The path:

1. **Primary phase**: declare candidacy while in your party during your target race's primary window. Highest primary score per party (alignment + favorability + influence) advances.
2. **General phase**: vote accumulates each turn, with the final turns weighted heaviest. Sustained campaigning matters; don't spike once and coast.
3. **Win**: take office, start earning office-tier action and fund bonuses, and unlock legislating powers.

Deep dive: [Election Mechanics](/wiki/election-mechanics).

## First-week checklist

- [ ] Create character, join a party, set policy positions close to that party's platform.
- [ ] Spend the 25 starting actions: ~10 Campaign (+10 PI), 1 Build Donor Network (~₳4.5k), 1 Run Advertisements (scaled by GDP, ~₳100k at national average, +1 to 3 Favorability).
- [ ] Fundraise once your donor base is at level 2+ to start the compounding income loop.
- [ ] Commission a Quick Poll (2 actions, ₳25k) before declaring candidacy to see your standing.
- [ ] Pick your first race (State Senate or House is the usual opener) and declare during the primary.
- [ ] Read [Campaign Strategy](/wiki/campaign-strategy) before spending your first ₳1M on a general.

## Go deeper

- [Create a Character](/wiki/create-a-character): every choice you'll make during onboarding.
- [Core Systems](/wiki/core-systems): turns, term cycles, processing order.
- [The Game Loop](/wiki/the-game-loop): a single day in the life of a player.
- [Stats & Actions](/wiki/stats-actions): every number, every action cost.
- [Player Progression](/wiki/player-progression): career arc from independent to head of government.
- [Relocation](/wiki/relocation): moving home state, country, or corporate HQ.
- [First Campaign Walkthrough](/wiki/first-campaign-walkthrough): week-by-week guide for a new player.
- [United States](/wiki/united-states) · [United Kingdom](/wiki/united-kingdom) · [Germany](/wiki/germany) · [Japan](/wiki/japan): country-specific rules and offices.
`;
