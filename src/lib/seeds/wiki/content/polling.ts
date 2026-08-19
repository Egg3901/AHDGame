export const pollingContent = `# Polling

Polls are paid actions that simulate what would happen if the election resolved right now. They're the single most useful intelligence tool in the game, since they run the **same vote math** the turn processor uses, so what they predict is literally what you'd get. Two tiers: Quick and Full.

## Quick poll

- **Cost:** 2 actions + ₳25,000
- **Scope:** Your current or about-to-declare race
- **Returns:** Topline vote share + your 5 strongest demographic groups + your 5 weakest

Quick Poll is the "should I run?" tool. Before declaring any candidacy, spend 2 actions and ₳25k to see whether you've got a realistic path. The topline is presented as a percentage-of-votes projection against the current field.

## Full demographic poll

- **Cost:** 6 actions + ₳75,000
- **Scope:** Same race as Quick, deeper output
- **Returns:** Complete per-group breakdown across every demographic category

Full Poll is the "what do I need to fix?" tool. It tells you:

- Your vote share with every segment of the state's electorate.
- Your Favorability per group.
- Turnout modifiers on each group (who's been canvassed / GOTV'd in this state).
- Where your appeal times reach times approval math is lowest: the gaps.

Use it mid-general to plan the closing sprint: which demographics to ad-target, which to canvass, which to accept as lost and move on from.

## When to use each

| Situation | Which poll |
| --- | --- |
| Considering declaring | Quick |
| Declared but unsure of strategy | Full |
| Mid-general, leading comfortably | Quick (spot-check) |
| Mid-general, competitive or behind | Full (diagnostic) |
| Primary season, picking a race | Quick |
| Final 4 turns of a general | Neither: act on your plan, don't re-plan |

## What polls actually compute

For **state races** (House, Senate, Gov, State Senate, Commons, Bundestag constituency, Sangiin, Shūgiin):

Polls run the **exact same** group-level competitive allocation the turn processor uses, with the **same** FPTP spoiler rule for FPTP states. Per-segment opponent effective favorability is used when available (the "what if my opponent's ad campaign is working on graduate-educated suburban voters" case). Results reflect real vote math.

For **presidential races**:

Player polls are **home-state projections only**. The actual presidential vote model is different: it runs per electoral unit with party-weighted positions, steep party-org curves, state-lean adjustments, swing-state ground-game bonuses, and does **not** apply the FPTP spoiler step. Your poll shows what your home state would do; it does **not** forecast the Electoral College.

## FPTP spoiler in polls

In FPTP states, polls show the spoiler effect's actual numbers. If you're a Democratic candidate in a race with a viable Green opponent, your poll shows:

- Your raw group-level allocation.
- The FPTP adjustment taking 4% of the Green's group votes and redistributing: either subtracting from you (if you're the closest major party) or leaving you alone (if you're the Republican instead).
- The final effective vote share.

This is the same math the turn processor will run when the election actually resolves. It's not a "worst case," it's the case.

## Polling cooldowns and limits

- **No hard cooldown** on polls: you can poll multiple times per turn if you can afford the actions and funds.
- **Diminishing strategic value.** Polling the same race 3 times in a row wastes resources because your stats haven't moved much.
- **Election must be active.** You cannot poll an election that hasn't started the primary phase or that has resolved.

## Reading a poll output

**Quick Poll topline:**
- Shows projected vote percentage for each candidate in the field.
- Your own projection is shown as both a percentage and a raw vote count.
- "Best 5 groups": demographics where your relative share is highest.
- "Worst 5 groups": demographics where your relative share is lowest. These are your ad-targeting and canvassing priorities.

**Full Poll output:**
- Per-segment rows with size, turnout, your appeal, your reach, your approval, and the final allocated vote count.
- A separate column showing the same numbers for each opponent.
- A "gap analysis" section identifying the largest deltas.

## Tactical uses

1. **Declaring intelligence.** Quick Poll before any primary declaration. If the topline shows you at 15% and an NPP at 65%, re-evaluate.
2. **Mid-primary health check.** One Full Poll 24-48 hours before the primary deadline to confirm you're winning the primary score. If you're close, a burst of Campaign actions in the final hours often seals it.
3. **Early-general diagnostic.** Full Poll at the start of the general. Identify the weakest 3 demographics. Invest ads/canvassing there for the middle of the general.
4. **Closing sprint positioning.** Quick Poll about 10 turns out from election end. If you're up 5+ points, coast; if you're tied or behind, the final 4 turns matter disproportionately, so prepare a burst.
5. **Opposition scouting.** When a competitor declares in your primary or general, a Full Poll shows their appeal breakdown too. Use it to understand where they'll pull votes from.

## Common polling mistakes

- **Skipping Quick Poll before declaring.** You walk in blind. Almost always the wrong call.
- **Over-polling.** Three Quick Polls a day is expensive and the stats haven't moved. One poll per 6-12 turns is usually enough.
- **Treating presidential polls as Electoral College forecasts.** They're not: they're home-state projections. Use them to understand your home state's lean, not to project 270.
- **Ignoring the "worst 5 groups" list.** This is the most actionable output of any poll. Each of those 5 groups is a candidate for targeted ads or canvassing.

## Related

- [Stats & Actions](/wiki/stats-actions): Poll action costs and stat effects.
- [Election Mechanics](/wiki/election-mechanics): The vote math polls replicate.
- [Demographics & Targeting](/wiki/demographics-targeting): Group composition and appeal math.
- [Canvassing](/wiki/canvassing): Acting on poll findings to boost turnout.
- [Fundraising & Ads](/wiki/fundraising-ads): Acting on poll findings to boost favorability.
- [Campaign Strategy](/wiki/campaign-strategy): Upgrades and long-game planning.
`;
