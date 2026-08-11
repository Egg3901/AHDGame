export const firstCampaignWalkthroughContent = `# First Campaign Walkthrough

A concrete, week-by-week example of a new US player running their first campaign: a State Senate race in a medium-population state. The specifics differ for UK / DE / JP and for different offices, but the **rhythm** is identical: build PI, raise money, declare in the primary, sustain through the general, win.

If you're mid-character-creation, read [Create a Character](/wiki/create-a-character) first. If you know the rules and want tactics, skim [Campaign Strategy](/wiki/campaign-strategy).

## The setup

- **Character:** Alex Moreno, home state Pennsylvania (medium population, 8M tier for donor-base income).
- **Policy positions:** Economic −2, Social −1 (centre-left moderate).
- **Party:** Joined the Democratic Party on Day 1 (close alignment to policy positions).
- **Starting resources:** 25 actions (starting grant), ₳250,000 Campaign Funds, 50 Favorability, 0 Political Influence, Donor Level 1.
- **Target race:** Pennsylvania State Senate, first primary phase in ~6 real days.

## Week 1: Foundation

**Goal:** Build Political Influence to 20+, raise Favorability to 60+, upgrade Donor Base to Level 3.

Day 1 (25 starting actions + 4/turn × 24 turns ≈ 73 actions for the day if you play aggressively):

- Join the Democratic Party. Profile now shows Party Standing with Party Influence 0 (it'll accrue passively).
- Spend 10 actions on Campaign → +10% Political Influence (now at 10).
- Spend 6 actions on Build Donor Network (₳75,000 cost) → Donor Level 2.
- Spend 5 actions on Run Advertisements (₳100,000 cost) → +1 to 3 Favorability (now ~52 to 54).
- Spend 3 actions on Fundraise → earns ₳50k + ₳10k × 2 = ₳70,000.
- Save remaining actions for tomorrow.

**End of Day 1:** PI 10, Favorability ~53, Campaign Funds ~₳145k, Donor Level 2.

Day 2 to 7:

- 2 to 3 Campaign actions per log-in → PI climbs to 20, then 30. The decay (0.75%/turn) nibbles at it but Campaign outpaces decay easily at this stage.
- Fundraise once per day → +₳70k per action group, steady income.
- By Day 4, you have enough for another Build Donor Network to Level 3 (₳50k + ₳75k = ₳125k). Do it.
- By Day 5 to 6, run 1 to 2 more ads to push Favorability to 60 to 65.
- Commission a Quick Poll on Day 6 (₳25k, 2 actions) → check your standing in Pennsylvania.

**End of Week 1:** PI ~30, Favorability 62 to 68, Campaign Funds ~₳200k to 250k, Donor Level 3. Ready to declare.

## Week 2: Primary phase

**Goal:** Advance to the general election.

The primary window opens. You and any other Democratic candidates declare, including NPPs who will auto-file. The highest primary score advances. Primary score blends:

- **Alignment to party platform** (Democrat default is around economic −3, social −1; you're at −2, −1, very close, which is ideal).
- **Favorability** (you're at 62+; NPPs often sit at 50 unless they've been around for a cycle).
- **Political Influence** (you're at 30; NPP competitors usually have 10 to 40 depending on cycle history).

Tactics for the primary:

- **Sustain PI.** Keep spending 2 to 4 Campaign actions per day. PI at 40 beats PI at 30 in alignment-weighted score.
- **Request NPP endorsements.** Visit the NPP profiles of Democrats in PA with views close to yours. 5 actions + base 40% chance. Each success is a demographic appeal boost.
- **Don't attack fellow Democrats.** You'd raise your own Infamy and push Favorability down. If the field is crowded, just outperform on alignment.
- **Run one Full Demographic Poll** (₳75k, 6 actions) early in the primary to understand your weakest groups. Adjust campaigning accordingly.

**End of Primary:** You're the Democratic nominee. Republican nominee is determined in their own primary. An Independent may also be on the ballot. The general election phase opens.

## Week 3: General election, opening

**Goal:** Establish a lead before the late-turn weighting kicks in.

You now have a fixed number of turns until the general resolves. For a State Senate race, that's typically ~6 days = 144 turns. The final ~4 turns land ~25% of the vote pool weight, so the first ~120 turns determine whether you're in a winning position going into the closing sprint.

Daily routine now tighter:

- **Campaign 4 to 6 actions/day** in-state to sustain PI (you need to keep it at 40+).
- **Ads every other day** to hold Favorability at 65 to 70. Diminishing returns hit above 70; don't over-spend.
- **Support allies and accept support:** NPP and player endorsements in the general land harder than in the primary. Get them before the Republican does.
- **Watch for attacks.** If your Favorability drops 5+ points, the Republican is probably attacking you. You can counter-attack (costs Infamy and doesn't always recoup), counter-message via ads, or request NPP opposition to the attacker.
- **If you have a strong lead by Day 4 of the general**, stop spending aggressively. Bank actions and money for the final turns.

## Week 4: General election, closing sprint

**Goal:** Land the final 25% of the vote pool in your favor.

The final 4 turns are heavy. Your PI, Favorability, and demographic appeal **at the moment each turn's vote accumulates** matter disproportionately.

Tactics for the closing 4 turns:

- **Peak your Favorability right before the final turn.** A well-timed Ad run can lift you 2 to 4 points in the last 12 hours.
- **Peak your Political Influence right before the final turn.** Every Campaign action in the final 24 hours compounds into the heaviest turns.
- **Log in hourly** if you can. Each turn's vote accumulation is based on your stats at that turn's snapshot. A 2% Favorability dip at turn 141 of 144 can cost you the race.
- **Don't withdraw.** Even if you're down 8 points, a determined sprint with NPP endorsements and a last-minute ad buy can close gaps.

## Resolution

The election resolves at the configured turn. Vote totals are published, a winner is declared, and the following happens automatically:

- **Winner** takes office. You gain +1 action bonus per turn (State Senate), +₳3,000 fund generation, and are added to the list of elected officials. Your profile now shows "State Senator, Pennsylvania."
- **Loser(s):** PI largely preserved (it's in-state and you kept campaigning, so it's at 40+ even after decay). Favorability preserved. Ready to contest next cycle.

A new State Senate cycle spawns immediately. Your term runs for several game years before you're up again.

## Week 5+: In office

You're now a State Senator. New capabilities:

- **Vote on state legislation.** Each vote shifts your policy position ±0.25 in the bill's direction. Stay aware of drift.
- **Write bills** if the state supports player-proposed state legislation.
- **Office bonuses** every turn: +1 action, +₳3k funds.
- **Re-election campaign** starts implicitly: your PI and Favorability feed into your next primary score.

Think one race ahead. State Senate is a launching pad: most players use it to build up PI and Favorability before contesting a US House seat or making a long-term play for Governor.

## If you lose

Losing your first race is common and recoverable:

- **PI is preserved.** You campaigned hard for weeks; PI is 40+. That carries into the next cycle.
- **Favorability is preserved.** If you ran clean (no Infamy spikes), you're at 65+.
- **Money reset.** You've probably spent most of your ₳250k starting fund plus fundraised earnings. Your donor base is at Level 3+ which will fundraise you back to ₳200k+ in a few days.
- **Name recognition.** Other players saw you. NPP relationships built during the campaign persist.

Enter the next primary in 2 to 3 weeks real-time. You'll start it ahead of where you started the first one.

## Common mistakes

- **Declaring without doing a Quick Poll.** You walk in blind. Always poll.
- **Over-campaigning early and under-campaigning in the final turns.** PI decays. The final turns matter most. Save actions for the sprint.
- **Buying ads above Favorability 75.** Diminishing returns are severe. Above 75 you're lighting money on fire.
- **Attacking your own party's primary rivals.** Costs Infamy and reduces your general-election appeal.
- **Ignoring NPP endorsements.** A single NPP endorsement is often 2 to 3% of the relevant demographic's appeal, which is cheaper than ads for the same effect.

## Related

- [Getting Started](/wiki/getting-started): Before your first campaign.
- [Campaign Strategy](/wiki/campaign-strategy): Tactical depth.
- [Fundraising & Ads](/wiki/fundraising-ads): Money optimisation.
- [Demographics & Targeting](/wiki/demographics-targeting): Appeal formulas and targeting.
- [NPP Opponents](/wiki/npp-opponents): Competing against autonomous candidates.
- [Election Mechanics](/wiki/election-mechanics): Primary scores and vote accumulation.
`;
