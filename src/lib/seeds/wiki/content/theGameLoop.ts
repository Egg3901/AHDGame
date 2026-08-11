export const theGameLoopContent = `# The game loop

A House Divided is a real-time game that rewards steady play over burst play. This page sketches a typical player's rhythm at three cadences: every turn, every day, and every election cycle. If you're trying to figure out "how much do I need to log in," this is the page.

## The shortest engagement loop

You don't have to log in every hour. The minimum viable cadence is **once or twice a day**. Actions carry over up to a cap of 200 (with a hoarding penalty above 100, so don't sit on 150+ for days), which means you can bank a morning's worth, come back at night, and spend everything in one session.

A solid once-a-day routine in ~10 minutes:

1. Skim the notifications panel: someone may have endorsed you, attacked you, or a race may have advanced.
2. If you're mid-campaign, spend enough Campaign actions to maintain or grow Political Influence in your race's state.
3. Run ads if your Favorability is below your target (60 is the stable floor; most candidates target 60 to 75).
4. Fundraise once if your donor base can sustain it.
5. Check your current bill vote queue (if in office): late-turn votes can swing bills.

## Per-turn rhythm (optional, for active players)

Every hour when the turn processor fires, several things happen to you automatically:

- Actions refresh (+4 base + office + party bonus).
- Campaign Funds generate passively from donor base and office.
- Political Influence decays 0.75%.
- NPI accrues +state PI / 100.
- Infamy decays 5%.
- Favorability decays if above 60.

Then the rest of the world advances: elections tick toward resolution, bills age, NPPs may act, markets settle. If you're logged in, refresh your dashboard to see new state; if not, the world just keeps running.

**When it's worth logging in hourly:**

- The final ~4 turns of a competitive general election (each turn in the final window weighs heavily in the vote pool).
- Immediately after a cabinet nomination drops and you're a senator with a 24-hour window to vote.
- A confidence vote is live in your parliament.
- A bill is about to close and you want the last-second campaigning / whipping / vote switching to land.

## Per-day rhythm

Most of the game's structural events tick over at day-scale. Each real day = 24 game weeks = roughly half a game year.

Every day:

- A full set of House seats moves closer to their term end (terms are measured in real days).
- Any race in its general phase is either resolving or continuing to accumulate votes.
- Bills on the floor advance or close.
- Party organisation decays slightly unless players invest in Build Org.
- Corporation production and financial markets process.

A typical **active player's daily to-do**:

1. **Morning (5 min):** Scan notifications, campaign 2 to 4 actions to refresh PI, fundraise once.
2. **Midday (3 min):** Run one ad if Favorability is under target; check if any bill needs your vote.
3. **Evening (10 min):** Do the week's heaviest spend (Build Donor Network, Full Demographic Poll, NPP endorsement request, or a string of Barnstorms for an ally).

## Per-week (24 hours) rhythm

Once a day-scale, think **positional**:

- Are my stats trending right? (PI over 60, Favorability over 65, donor level sufficient for next fundraise.)
- Is my party still aligned with my policy positions? (If I've drifted through votes, my bonus-action share is smaller.)
- Are any of my allies running in primaries I should help them win? (Barnstorms and NPP endorsements are cheap force-multipliers when you're not yet a candidate.)
- Do I need to file for an upcoming race? (Primary declaration windows are limited; miss one and you wait a full cycle.)

## The election cycle (the real game loop)

The satisfying, compounding layer of gameplay is the election cycle. It's the rhythm that most players organise their week around:

### 1. Build phase (between cycles)

Neither a primary nor a general election is open for your target office. You're accumulating: PI, Favorability, donor base, party influence, and maybe NPI if you have presidential ambitions. This is your longest phase, usually several days to weeks real-time depending on the office.

### 2. Primary phase

Primary declarations open. Your primary score is a mix of **policy alignment to your party** + **Favorability** + **Political Influence (or NPI for president)**. Highest primary score per party advances to the general.

Key moves this phase:

- Commission a Quick Poll before declaring: know what you're walking into.
- Ask allied NPPs for endorsements; each one lifts your primary score and demographic appeal.
- Spend Campaign actions in-state to squeeze out the last PI.
- Attack competitors within your party only if you're confident (their Infamy gain counts against you, not them).

### 3. General phase

You're the party nominee. The vote accumulates each turn from each demographic group. **The final ~4 turns account for roughly 25% of the total pool.** Sustained campaigning wins elections; bursty campaigning that fades at the end loses them.

Key moves this phase:

- Sustain PI in the race's state through the final turns (don't let it decay to 50 the morning of resolution).
- Keep Favorability above 65 via ads. Above 70 gets expensive.
- Targeted demographic action: if a Full Demographic Poll shows you're 12 points behind with a specific group, run ads or campaign actions that lift their segment.
- Cultivate NPP endorsements for the general: they matter more than in primaries.
- Pay attention to what opponents are doing. Attack damage from a determined rival is the hardest to recover from if you ignore it.

### 4. Resolution

At the configured turn, the election resolves. Winner takes office, earns their office action and fund bonuses, and enters the legislating workflow (if elected to a legislature). A new cycle of the same office immediately spawns; no vacant seats.

### 5. In-office phase

If elected:

- Write bills (House/Senate/MP/MdB/Sangiin members).
- Vote on bills: each provision you vote For shifts your policy position ±0.25 in the bill's direction.
- Collect office fund and action bonuses.
- Manage cabinet appointments if you're Executive.
- Face re-election at the end of your term.

If you lost the general, you go back to the Build Phase: same state, same party, lower starting PI (it'll have decayed through the cycle). Come back stronger.

## The long loop: career arc

Beyond any single cycle, your long-term loop is **moving up the office ladder**:

- Start as an independent, build a base.
- Join a party, build Party Influence.
- Win a low-tier race (State Senate, House, MP) to unlock legislating and office bonuses.
- Defend your seat while running for higher office (only one office at a time: advancement requires winning the next race before your current term locks you in).
- Aim for executive office (Governor, President, PM, Chancellor), the peak of the career arc.

See [Player Progression](/wiki/player-progression) for the full arc and each office's strategic value.

## What you can safely ignore

- Small day-to-day Favorability drift: decay is slow and easily reversed.
- Infamy under 20: no penalty.
- NPP opponents in uncompetitive primaries: they're predictable; save your actions for real fights.
- Most news posts unless you're building a public profile.

## What you cannot ignore

- **Missed primary declarations.** Miss the window, wait a full cycle.
- **Last-turn general elections.** A 2% Favorability dip the morning of resolution can lose you the seat.
- **Cabinet confirmation votes if you're a Senator.** They close in 24 hours.
- **Confidence votes in parliamentary systems.** A PM losing confidence triggers government formation.
- **Drifting too far from your party.** You'll lose primary viability and party-pool bonus actions.

## Related

- [Core Systems](/wiki/core-systems): turn structure, timing.
- [Stats & Actions](/wiki/stats-actions): full action catalogue.
- [Campaign Strategy](/wiki/campaign-strategy): tactical decision-making during campaigns.
- [Player Progression](/wiki/player-progression): multi-cycle career arc.
- [First Campaign Walkthrough](/wiki/first-campaign-walkthrough): concrete week-by-week example.
`;
