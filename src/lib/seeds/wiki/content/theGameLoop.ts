export const theGameLoopContent = `# The Game Loop

You do not need to live in the tab. This page is when to click, and what happens if you do not.

## How often to log in

**Default: once or twice a day.** Actions carry to a cap of 200. Above 100 you pay a -4 hoarding penalty per turn, so do not sit on a huge stack.

A 10-minute daily pass:

1. Open **Dashboard**. Read notifications (endorsements, attacks, race phase changes).
2. If you are in a race, open **View Campaign** and spend Campaign until PI holds or rises.
3. If Favorability is under 60, **Run Advertisements** once.
4. **Fundraise** once if Donor Level is 2+.
5. If you hold office, open the legislature and clear your vote queue.

\`\`\`guide-screenshot
dashboard
\`\`\`

## What a turn does (even while you are offline)

Every real hour:

- Actions refresh (+4 base + office + party).
- Campaign Funds tick from donor base and office.
- PI decays 0.75%. NPI accrues from local PI. Infamy decays. Favorability decays if above 60.
- Elections, bills, NPPs, and markets advance.

Refresh the Dashboard after the hour if you want the new numbers.

## When to log in hourly

- Last ~4 turns of a close general (those turns carry ~25% of the vote pool).
- Senate cabinet confirmation with a 24-hour window.
- Live confidence vote in your parliament.
- A bill about to close that you still need to whip or switch.

## Per-week clicks (positional)

Once a day is not enough if you ignore these:

1. Open **Elections**. Confirm you have not missed a primary declaration.
2. Check PI, Favorability, donor level vs your next race.
3. If you drifted on bills, your party alignment (and bonus actions) got worse. Skim your vote history.
4. Help an ally: Barnstorm or NPP endorsement is cheaper than running yourself every cycle.

\`\`\`guide-screenshot
elections
\`\`\`

## The election cycle (the real loop)

1. **Build** (no race open for your office): Campaign, ads, donor network, party influence.
2. **Primary:** **Elections** → race → declare. Your standing = alignment + favorability + PI; over the primary's closing window your party's registered voters cast ballots split by that standing, and the top count per party advances (president: pledged delegates).
3. **General:** same race page, live tally. Sustain PI and Favorability through the last 4 turns. **View Campaign** for spend.

\`\`\`guide-screenshot
campaign
\`\`\`

4. **Resolution:** winner takes office; a new cycle of that office spawns immediately.
5. **In office:** legislature / cabinet tools unlock. You still re-elect.

Detail: [Election Mechanics](/wiki/election-mechanics). Career ladder: [Player Progression](/wiki/player-progression).

## Your first week

- [ ] Daily Dashboard pass (notifications, Campaign, one ad or fundraise).
- [ ] Elections page checked so a primary window cannot close unseen.
- [ ] Favorability held at 60+; PI climbing, not rotting.
- [ ] You know whether you are in Build, Primary, or General.
- [ ] Last-4-turns alarm set if a general is live.

## Safe to ignore (week one)

- Tiny Favorability drift. Infamy under 20. Uncontested NPP primaries. Most news posts.

## Not safe to ignore

- Missed primary declarations. Last-turn generals. Cabinet votes if you are a Senator. Confidence votes. Drifting far from your party.

## Related

- [Core Systems](/wiki/core-systems)
- [Stats & Actions](/wiki/stats-actions)
- [Campaign Strategy](/wiki/campaign-strategy)
- [First Campaign Walkthrough](/wiki/first-campaign-walkthrough)
`;
