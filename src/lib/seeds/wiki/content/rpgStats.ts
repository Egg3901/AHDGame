export const rpgStatsContent = `# RPG Stats & Debates

Your character has **seven stats** that make two politicians with identical money and offices play differently. Stats decide how far your campaign dollars stretch, how many actions you get each turn, and whether you win an election debate. You set them at character creation and then *shape them through play*: the things you do repeatedly get stronger, and the things you neglect slip away.

## The seven stats

Every stat runs from **1 to 10**. Most of them give a smooth effectiveness bonus, roughly **−18% at 1, neutral at 5 to 6, and +18% at 10**, applied to the actions they govern. Energy is the exception: instead of a percentage it hands you more actions per turn.

| Stat | What it does | How you raise it |
| --- | --- | --- |
| **Charisma** | More political influence per **Campaign**, more favorability per **ad**, better relationships/favors when courting NPP politicians. Powers the *Remain above the fray* debate move. | **Campaign** and **Advertise**. |
| **Debate** | Drives your overall debate score and powers the *Attack* debate move. | **Debate Prep** action and **debating in elections** (see below). |
| **Energy** | Raises your **per-turn action cap (200 → 250)** and how many unused actions you can **bank between turns (100 → 125)**. | Stay **active**: accrues on every action; only sustained play keeps it up. |
| **Fundraising** | More money per **Fundraise** and a cheaper cost to **expand your donor network**. | **Fundraise** and **Build Donor Base**. |
| **Business Acumen** | Lowers the growth cost of sectors in any **corporation you run as CEO**, and softens how much high interest rates inflate that cost. | Hold a **CEO seat**: a *more profitable* corp trains it faster. |
| **Statecraft** | Better **party-whip success** (~±9 pts), longer **filibusters**, stronger **ministerial** policy effects. Powers the *Tout accomplishments* debate move. | **Whip** votes and **invoke filibusters**. |
| **Intellect** | Cheaper **Quick/Full polls** and softens the rising fund cost of repeated **Campaigning**. | **Run polls**. |

## How stats grow and decay

Stats aren't fixed: they drift with how you play. This is *stat* drift (your numbers moving up and down); it does **not** change your character's ideology or positions.

- **Use it.** Each time you perform a stat's action you bank a little progress toward the next point. Do it enough and the stat ticks up.
- **Or lose it.** Any stat you **don't** engage on a given turn slips back toward 1 by a small amount each turn. Train a stat that turn and you're safe: active play never costs you the stat you just worked.
- **Energy is stamina, not a skill.** It earns progress from *every* action, so it only avoids decay when you do **enough in a turn** (about two actions' worth). Coast and it bleeds down.
- **Business Acumen scales with how well your corp runs.** A money-losing corp barely teaches you; a highly profitable one trains it up to twice as fast.
- **Debate is on its own clock.** It has no idle-per-turn decay. Instead it drops **−1 every 72 hours** if you stop practicing, so it rewards staying in the ring.

## Election debates

When you're a candidate in an election, an opponent can **challenge you to a debate** (a coin-flip chance each event pass). You then have **12 hours** to pick **one strategy** before it auto-resolves. Each strategy leans on a different stat and scores \`your stat × a base reward + a luck roll\`; the two sides' picks are compared to swing favorability. The base reward is the same for all three, so your **strongest stat** usually points to your best choice.

| Strategy | Stat used | Risk / reward |
| --- | --- | --- |
| **Attack opponent** | Debate | Swingiest: a wide luck roll gives the highest ceiling, but it can backfire and read as bullying. |
| **Remain above the fray** | Charisma | A safe floor with limited upside: stays presidential. |
| **Tout accomplishments** | Statecraft | Scales with your **real record** (offices held, bills passed). Strong if your résumé is real, a backfire if it's thin. |

So Debate isn't the only stat that wins debates: a charismatic candidate leads with *Above the fray*, and a strong résumé makes *Tout* the play, without ever going on the attack.

## Building your character

At creation you distribute a **28-point budget** across the seven stats. Every stat starts at a floor of **1**, which spends 7 points and leaves you **21 free points** to place. You can't dump everything into one stat (the cap is 10), so a build is a set of trade-offs:

- A **campaign machine** leans Charisma + Fundraising + Energy.
- A **legislator** leans Statecraft + Debate to dominate the floor and the debate stage.
- A **mogul** leans Business Acumen + Intellect to run corporations and polls cheaply.

Whatever you pick at creation is only a starting point: play steers your stats from there, so a build you neglect won't stay strong.

## Strategic takeaways

- **Specialize.** Because effectiveness swings ±18% and decay punishes neglect, a few strong stats beat seven mediocre ones.
- **Train what you use.** Your day-to-day actions quietly level the matching stat: fundraisers get better at fundraising, whips get better at statecraft.
- **Keep Energy fed.** It's the only stat that buys you *more actions*; let it slide and everything else gets harder.
- **Don't ghost a debate.** Letting the 12-hour timer run resolves it without your input, so pick strategies that match your strong stats and your record.

## Related systems

- **[Player Random Events](/wiki/player-events)**: the event system that delivers debate challenges
- **[Election Mechanics](/wiki/election-mechanics)**: where debates and election efficacy pay off
- **[Crisis Interaction](/wiki/crisis-interaction)**: a separate optional layer
- **[Core Systems](/wiki/core-systems)**: turn structure and the action economy Energy expands
`;
