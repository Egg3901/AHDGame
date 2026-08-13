export const electionsPlayerGuideContent = `# Elections: A Granular Player Guide

The elections UI has three levels: the country election board, the individual race page, and your campaign page. Each answers a different question. This guide explains what to read, what moves a race, and where national political influence fits.

## The three screens

### 1. Country election board

Open **Nation > Elections**. Use the filters for country, office, stage, and state or region. The board is for finding a race and checking its phase. It is not the place to judge your detailed position.

Before entering, confirm:

- the office matches your home state or region;
- declarations are still open;
- you are not already an active candidate elsewhere;
- you have enough time and campaign resources for both phases.

### 2. Individual race page

The race page changes between primary and general phases.

In a **primary**, each party has its own contest. The page shows projected score or delegate share, the phase schedule, and links to campaign operations. The highest finisher in each party advances.

In a **general election**, the page shows live votes, share, trends, persuasion drivers, and any regional or county map available for the office.

![A gubernatorial general-election page with live tally, persuasion drivers, trends, and county results](/static/wiki/player-guides/governor-general.png)

### 3. Campaign page

Open **View Campaign** from the race page. This is where you raise and spend funds, buy upgrades, run actions, assign a manager, and inspect the activity log. The race page tells you where you stand. The campaign page is where you act.

## Primary phase: win your party first

State and regional primaries score four broad things:

1. alignment with the electorate;
2. alignment with your party;
3. favorability;
4. local political influence.

Presidential primaries are national. They use party alignment, home-state party organization, national political influence, and favorability. The UI may show delegate projections because the presidential nomination is built state by state.

Practical primary checklist:

- Match the party and electorate before spending heavily.
- Build local political influence for a state race.
- Build NPI and home-state party organization for a presidential race.
- Check whether the contest is actually competitive. An uncontested nomination does not need a war chest.
- Do not read a projected primary lead as banked general-election votes. The general starts a different contest.

## General phase: read the live movement

General-election votes accumulate every turn. Earlier turns distribute most of the pool, but the final four turns carry 25% of the total. A close race can move sharply at the end.

The most useful panels are:

- **Live tally:** votes already accumulated, not a one-time forecast.
- **Vote share:** your current share of the votes cast so far.
- **Persuasion drivers:** why one candidate is gaining on another among voters who can still move. Candidate support, policy alignment, money, incumbency, and coattails can appear here.
- **Trends:** whether your share or cumulative total is improving from turn to turn.
- **Regional results:** where the coalition is strong or weak.

If the headline share and the persuasion bars seem different, remember that persuasion drivers only describe the movable slice. Registration and party loyalty can keep most voters anchored.

## National political influence: why yours is low

National political influence, usually shortened to **NPI**, is accumulated national name recognition. It does not decay each turn.

Every turn you gain:

\`min(100, local political influence) / 100\`

That means 40 local political influence adds 0.4 NPI per turn, while 100 or more adds 1.0. Keeping local influence high is the base path to national growth.

You also receive the highest position bonus you qualify for:

| Position tier | NPI per turn |
| --- | ---: |
| Seated legislature, governor, or ordinary cabinet role | +1.0 |
| Deputy congressional leader, party vice chair, or party treasurer | +1.5 |
| Vice president, top congressional leader, party chair, or seated justice | +2.0 |
| National head of government or state | +2.5 |

A central-bank chair also receives a separate NPI benefit while in office. High chair infamy reduces that office benefit.

Position bonuses do not all stack with each other. The action refresh uses your highest qualifying position tier, then adds the local-influence gain. Holding three ordinary seats is not +3 NPI per turn.

## Where NPI goes

NPI is both a score and a spendable political resource.

- Presidential primaries use it as one part of nomination strength.
- Presidential general elections use it for national reach.
- Some party and leadership systems rank or weight candidates with it.
- Proposing legislation can spend it.
- Moving to another country resets it; moving within the same country preserves it.

For ordinary policy, subsidy, and union-law bills, the provision ladder is:

| Charged provisions | NPI paid when proposed |
| --- | ---: |
| 1 | 5 |
| 2 | 15 total |
| 3 | 30 total |

If the bill is enacted, the game refunds the recorded proposal NPI cost to the sponsor. If it fails, the cost stays spent. There is no extra NPI profit on enactment: you receive the amount recorded on the bill back. Tariff provisions are excluded from this NPI ladder.

So a sudden 30-point drop after proposing a three-provision bill is expected. It is not passive decay, and it is not an election penalty.

## What actually moves votes

### Reach

Local political influence determines how much of a state electorate a candidate reaches. Presidential races use NPI for national reach. Influence has diminishing returns, so moving from very low to adequate matters more than adding the same amount at the top.

### Appeal

Policy distance is measured per demographic group. Being close to one bloc can cost you with another. Use the demographics and polling pages to see where your coalition is coming from.

### Favorability and support

Favorability is broad approval. Candidate support is short-term campaign mood. Both matter, but they are not interchangeable with influence: a popular candidate still needs reach, and a famous candidate can still repel voters.

### Party organization and registration

Party organization helps turn alignment into votes. Registration makes the party's own voters harder for opponents to persuade. These are structural advantages that campaign spending cannot instantly replace.

### Money

Money funds campaign actions and upgrades. It is a means, not a direct victory score. Spend it on the weakest link the race page exposes.

## A turn-by-turn routine

1. Open the race page after each turn.
2. Check phase and turns remaining before reading anything else.
3. Compare share and trend, not just raw votes.
4. Select yourself and your nearest opponent in Persuasion Drivers.
5. Identify one weak driver you can actually change.
6. Act on the campaign page.
7. Recheck after the next turn instead of spending several turns blind.
8. Save resources for the final four turns when the race is close.

## Related

- [Election Mechanics](/wiki/election-mechanics): full formulas and office rules.
- [Primaries](/wiki/primaries): declaration, scoring, and nomination tactics.
- [General Elections](/wiki/general-elections): vote accumulation and closing turns.
- [Campaign Manager](/wiki/campaign-manager): every campaign control.
- [Polling](/wiki/polling): quick and demographic polls.
- [Demographics & Targeting](/wiki/demographics-targeting): appeal by voter group.
- [Campaign Strategy](/wiki/campaign-strategy): advanced spending and timing.
`;
