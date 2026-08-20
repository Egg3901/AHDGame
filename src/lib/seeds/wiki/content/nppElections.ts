export const nppElectionsContent = `# NPP Elections

NPPs enter primaries and generals autonomously each turn. Understanding exactly how they decide to enter, how they perform, and when they drop out gives you control over the races you care about.

## When NPPs enter

NPP election entry runs each turn as part of the NPP behavior phase. Entry only happens while a primary is active and still accepting candidates. NPPs cannot enter a primary after it closes.

### Eligibility requirements

An NPP must satisfy all of these to enter a race:
- Not retired
- Not on cooldown for that specific election (from a previous dropout)
- Not already an active candidate in any other race
- Home state (or region/Land/prefecture) must match the election's state
- Country must match the election's country
- No same-party candidate already in that primary

**Presidential races are barred by default**, but the bar lifts in **autonomy-active, non-player-enabled countries**. If NPP autonomy is active for a country and no player controls it, NPPs can enter that country's presidential primary; the standard eligibility checks above still apply. In every other country, NPPs stay locked out of presidential primaries regardless of ambition or eligibility.

## Two-phase entry: incumbents first

Every turn, the entry process runs in two phases:

**Phase 1: Incumbents.** NPPs currently holding the seat being contested get first priority to enter and defend it. An NPP who is the sitting governor of Texas will be matched to the Texas governor primary before any non-incumbent NPP from their party is considered.

**Phase 2: Non-incumbents.** After incumbents are placed, remaining open slots are filled by matching available NPPs by party and home state. Higher-priority races are filled first:

| Priority (1 = highest) | Race Type |
| --- | --- |
| 1 | stateSenate |
| 2 | regionalCouncil (UK) |
| 3 | peoplesCongress (CN) |
| 4 | sangiin (JP) |
| 5 | house |
| 6 | commons (UK) |
| 7 | senate |
| 8 | shugiin (JP) |
| 9 | npcDelegate (CN) |
| 10 | governor |
| n/a | president (barred except in autonomy-active, non-player countries) |

Each primary gets **exactly one NPP per party**: NPPs never split the party vote in a primary.

## The primary score penalty

When a player character is in the same primary, NPP candidates receive a **50% score penalty**.

If the normal primary score formula would give an NPP 60 points, they land at 30 after the penalty. This makes any competent player candidate a heavy favorite over any NPP in a contested primary.

The penalty applies only when **at least one player character** is an active candidate in the same primary. NPP-only primaries (no player candidates) run without the penalty.

## The general election penalty

In generals, NPPs also face a vote-weight reduction when a player is in the race: NPP candidates accumulate 80% of the votes they would otherwise receive in any general election that includes at least one player candidate. This gives player candidates a structural edge in head-to-head matchups.

## Dropout mechanics

NPPs do not automatically drop out of primaries based on an appeal threshold. There is no low-appeal dropout rule.

## The political influence floor

NPPs start with a **minimum Political Influence of 10%**. If a value is missing, it defaults to 10. This means even the weakest NPP always has a baseline of influence in their home state. It's by design: NPPs should be a real presence, not paper candidates.

In contrast, player characters can fall below 10% Political Influence if they neglect their political activities. A player who lets their influence decay below 10% is at a disadvantage against NPPs.

## Beating NPPs

### In primaries

1. **Enter early**: your presence halves their entry chance and triggers the x0.5 primary penalty
2. **Stay ideologically close to the party**: NPPs are calibrated near the party median; match or beat their alignment score
3. **Build favorability**: NPPs can't run ads or canvass; you can
4. **One race at a time**: NPPs can only hold one candidacy; if they're in your race, they're blocked from higher-priority races

### In generals

1. **Leverage party org**: you can actively build org; NPPs benefit from it passively but can't invest
2. **Use targeted campaigning**: NPPs have fixed positions; find the demographics they don't appeal to and campaign there
3. **Adjust your positions**: if you know an NPP's positions, you can shift to better match demographics they miss

## Related

- [NPPs Overview](/wiki/npps-overview): what NPPs are, the influence system.
- [NPP Behavior](/wiki/npp-behavior): how NPPs vote, whip compliance, personality traits.
- [Primaries](/wiki/primaries): primary mechanics including declaration rules and the NPP penalty in detail.
- [General Elections](/wiki/general-elections): vote accumulation and the NPP general-phase penalty.
`;
