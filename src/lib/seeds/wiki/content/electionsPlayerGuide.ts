export const electionsPlayerGuideContent = `# Elections: A Granular Player Guide

The elections UI has three levels: the country election board, the individual race page, and your campaign page. Each answers a different question. This guide explains what to read, what moves a race, and where national political influence fits.

## Results, maps and replay

In normal multiplayer mode, general-election returns update at half past the hour as well as during the main hourly turn. Campaign budgets, action refresh and race deadlines stay on the main turn. A tick may be skipped while a turn is processing; faster returns do not mean another action allowance.

Presidential races offer a full-screen map with state and county views, campaign presence and a road-to-270 strip for Electoral College races. Open a state in the map to inspect its results and campaign options. Popular-vote views answer a different question from the Electoral College count.

For a finished presidential race with recorded weekly history, choose **Replay the campaign** above the map. Play or pause, or move the slider to a recorded week. Switch between electoral-vote leadership and popular-vote margin, and zoom into counties. Choose **Final result** to return to the concluded race. Replay follows stored campaign snapshots; it does not rerun the election or change its outcome.

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

In a **primary**, each party has its own contest. The page shows each candidate's standing, the cumulative ballot shares once the closing window has opened (delegate shares for president), the phase schedule, and links to campaign operations. The top count in each party advances.

In a **general election**, the page shows live votes, share, trends, persuasion drivers, and any regional or county map available for the office.

![A gubernatorial general-election page with live tally, persuasion drivers, trends, and county results](/static/wiki/player-guides/governor-general.png)

### 3. Campaign page

Open **View Campaign** from the race page. This is where you raise and spend funds, buy upgrades, run actions, assign a manager, and inspect the activity log. The race page tells you where you stand. The campaign page is where you act.

## Primary phase: win your party first

State and regional primaries score your standing on four broad things:

1. alignment with the electorate;
2. alignment with your party;
3. favorability;
4. local political influence.

That standing sets your share of the ballots your party's registered voters cast each turn over the primary's closing window, and the cumulative count decides the nomination, so a lead you hold through the window beats one you seize on the last turn.

Presidential primaries are national. They use party alignment, your accumulated party influence, national political influence, and favorability, plus the Campaign Presence you have built state by state, and the nomination is settled by pledged delegates. The UI shows delegate projections because the presidential nomination is built state by state.

Practical primary checklist:

- Match the party and electorate before spending heavily.
- Build local political influence for a state race, early enough to hold the lead through the closing window.
- Build NPI, party influence and Campaign Presence for a presidential race.
- Check whether the contest is actually competitive. An uncontested nomination does not need a war chest.
- Do not read a projected primary lead as banked general-election votes. The general starts a different contest.

## General phase: read the live movement

General-election votes accumulate every turn. The early band carries 50% of the pool, the next 8-turn ramp carries 20%, and the final four turns carry 30%. A close race can move sharply at the end.

The most useful panels are:

- **Live tally:** votes already accumulated, not a one-time forecast.
- **Vote share:** your current share of the votes cast so far.
- **Persuasion drivers:** why one candidate is gaining on another among voters who can still move. Candidate support, policy alignment, money, incumbency, and coattails can appear here.
- **Trends:** whether your share or cumulative total is improving from turn to turn.
- **Regional results:** where the coalition is strong or weak.

If the headline share and the persuasion bars seem different, remember that persuasion drivers only describe the movable slice. Registration and party loyalty can keep most voters anchored.

## National political influence: why yours is low

National political influence, usually shortened to **NPI**, is accumulated national name recognition. It decays by **1% of its current value every turn**, then you gain this turn's NPI. It never falls below 0.

Because decay is proportional, every role settles at a level where gain equals decay: **100 x your per-turn gain**. If you leave office, the position part of your gain stops and your NPI fades toward the new, lower level, losing half the gap in about 69 turns.

Every turn your gain has two parts. The first comes from your local political influence:

| Local political influence | NPI per turn |
| --- | ---: |
| 0 | -0.5 |
| 25 | 0 |
| 50 | +0.5 |
| 75 | +1.25 |
| 100 | +2.0 |

Up to 50 the term is \`local political influence / 50 - 0.5\`. Above 50 it is \`0.5 + (local political influence - 50) x 0.03\`. Letting your home base fall below 25 costs national standing every turn.

You also receive the highest position bonus you qualify for:

| Position tier | NPI per turn |
| --- | ---: |
| National head of government or executive head of state | +2.5 |
| Vice president or deputy head of government, presiding officer (Speaker of the House, Bundestag President, NPC Standing Committee chair, Nigerian Speaker and Senate President, President pro tempore), House or Senate majority leader, national party chair | +2.0 |
| Confirmed cabinet member, governor or minister-president, Supreme Court justice, central bank chair, House or Senate minority leader, CPPCC chair, party vice chair or treasurer | +1.5 |
| National legislator, ceremonial head of state | +1.0 |
| Acting cabinet member | +0.75 |
| State or regional legislator, state party chair | +0.5 |
| CEO of one of the 10 largest listed corporations in its country by market cap | +0.3 |
| CEO of any other listed corporation in the top half of its country by market cap | +0.15 |

A CEO only qualifies after running the same corporation for 12 turns. Running a corporation grants no extra actions.

Position bonuses do not stack with each other. You get your single highest tier, then the local-influence term is added. Holding a seat, a party chair and a cabinet post is not +4.5 NPI per turn.

The one exception is international leadership. Holding an international organisation's leadership seat (Secretary-General or equivalent) adds **+1.0** on top of your domestic tier.

Some equilibrium examples, with local political influence around 30 (+0.1 per turn):

| Role | Gain per turn | NPI settles near |
| --- | ---: | ---: |
| National head of government | 2.6 | 260 |
| National legislator | 1.1 | 110 |
| State legislator | 0.6 | 60 |
| No office | 0.1 | 10 |

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
