export const campaignStrategyContent = `# Campaign Strategy

A practical guide to allocating actions and money across the three phases of every race: build, contest, close. For the vote math that ultimately decides elections see [Election Mechanics](/wiki/election-mechanics); this page is about **what to do in what order**.

## The three phases

Every election cycle, for every office, runs through three strategic phases from your character's perspective:

1. **Build (pre-primary):** Accumulate Political Influence, Favorability, donor base, party alignment. No election is open yet.
2. **Contest (primary + early general):** You're a declared candidate. Sustain base stats while running the specific race.
3. **Close (final 4 turns of general):** Everything compounds. The campaign season multiplier kicks in. Weighted snapshots fall.

Most players lose races by misallocating across phases: over-campaigning in the build phase and running out of gas in the close, or over-fundraising and under-contesting. This page is about getting that right.

## Core principle

Every action should move you closer to **winning your next election.** Early game: stats foundation. Mid game: positioning. Late game: turnout and closing pressure.

## Action allocation by situation

| Situation | Priority order |
| --- | --- |
| New character, no office | Campaign > Build Donor Network (to level 2) > Fundraise > Quick Poll > Ads |
| Mid-build, no election yet | Fundraise > Campaign > Build Donor Network > Barnstorm for allies |
| Primary declared | Campaign heavily > targeted ads > build alignment NPPs are likely to endorse |
| General, opening | Campaign + ads in weak demographics > Full Poll |
| General, middle | Maintain PI + Favorability > Opposition Research on leading opponent |
| Final 4 turns | Closing-sprint campaign + canvassing + ads |
| Incumbent between cycles | Maintain PI + fundraise for war chest + build party influence |

## The campaign page (Strategic Ops trees and budget)

Once you're a candidate, your **campaign page** (\`/campaign/[id]\`) gives you a **separate budget** spent on **Strategic Ops trees**. This is distinct from your personal Campaign Funds.

### Strategic Ops trees, not flat levels

Fundraising, Ground Game, Media Spending, and Opposition Research are each a small **branch tree**, not a flat 1-10 level ladder. You unlock a **starter** node (funds + actions), then invest further into up to three branches per tree (labelled a/b/c on the campaign page, e.g. Media Spending's Broadcast and Television branches, Opposition Research's Dossier, Scandal Leak, and Counter-Intel). Each branch has its own magnitude that stacks with the starter and with the other branches in the same tree, so two campaigns at "the same tree" can have very different effects depending on which branches they invested in.

Approximate per-tree effects once started:

| Tree | Starter effect | Branches add |
| --- | --- | --- |
| **Fundraising** | Passive income per turn (base ~₳35k) | Grassroots, Bundlers, Direct Mail: more passive income |
| **Media Spending** | Base passive Favorability gain per turn | Broadcast, Television: more Favorability per turn; Rapid Response: reacts to attacks |
| **Ground Game** | Base swing-area turnout bonus | Field Offices: bigger swing-area bonus; Get-Out-The-Vote: turnout bonus everywhere, not just swing areas; Volunteer Corps |
| **Opposition Research** | Base drain on one target (~-0.5%/turn) | Dossier: more drain; Scandal Leak; Counter-Intel: amplifies the drain |

**Maintenance** is deducted from campaign funds each turn. If projected funds can't cover next turn's maintenance, branches **auto-downgrade** rather than the whole tree collapsing at once. No refund.

### Opposition Research

Lets you drain an opponent's Favorability passively. Retargeting has a cooldown.

In the final 4 turns the effect **doubles** (2× campaign-season multiplier). A well-invested Opposition Research tree in the closing sprint can be worth several points of Favorability drain over the final stretch, often race-deciding.

### Campaign actions

Your campaign generates its own per-turn action pool:

- **Base:** Every campaign earns at least 4 actions/turn (the player base action rate from game config, floored at 4).
- **Endorsements:** NPP, player, governor, and executive endorsements add actions via \`baseline + floor(sqrt(endorsements) × 3)\`. At the 4-action baseline, 9 endorsements ≈ 13 actions/turn.

Campaign actions are spent **only** on upgrades, not on regular character actions.

## Party organization

Party organization in a state feeds a **normalized share** of that state's total party organization: your party's org divided by every party's org in the state. A party with no presence in a state gets 0 (no votes there); a dominant party gets a multiplier close to 1.0.

Investing in your state party's organization pays off for **every candidate in your party** who runs in that state. See [Party Building](/wiki/party-building) for the chair-side tools.

## Fog of war

Opponents don't see your exact upgrade levels: they see fogged estimates.

- **Public** (anyone): variance ±3 levels. If you're at level 5, they see 2 to 8.
- **Party members:** variance ±1 level. If you're at level 5, they see 4 to 6.

Fog updates every turn during campaign processing. Don't rely on opponent display numbers: they're noisy.

## Campaign season multiplier (final 4 turns)

The single most important time mechanic. In the final 4 turns before an election closes, these effects **automatically double**:

- Media Spending favorability boost
- Opposition Research drain
- Canvassing boost
- (Presidential) Travel favorability gain

No player action required: the multiplier activates based on the election timer.

**Strategic implication:** Hold heavy spending for the final 4 turns. A burst of ads, canvassing, and Opposition Research at this point is worth roughly 2× the equivalent spend earlier.

## Budget management

At the campaign page → Budget tab:

- Income vs spending over time
- Category breakdown (what your money went to)
- Per-turn net income

Red flags:

- **Maintenance > income.** Next turn auto-downgrade fires.
- **Funds negative.** You've overspent. You're alive but can't upgrade until income digs you out.
- **Income declining.** Usually means you upgraded fundraising late, got taxed by party, or the opposition ramped Opposition Research.

## Phase-specific tactics

### Build phase

- Build Donor Base early: base cost is $3K + $1.5K per current level (scaled by state GDP per capita), cheap at low levels and escalating toward ~$4.4M for the full 0→75 climb, for permanent compounding income.
- Hit Favorability 65 via 3 to 5 ads.
- Push Political Influence to 40+ through daily Campaign actions.
- Join a party; invest ~2 weeks real-time to push Party Influence up.
- Watch opponent candidacy declarations. If an NPP declares in the next primary, prepare accordingly.

### Primary phase

- Campaign aggressively in-state: every +1 PI converts to ~0.25 primary score points.
- Keep Favorability 70+: each point is worth 0.35 primary score points.
- NPPs endorse autonomously based on alignment, so staying close to your party's platform makes you a more attractive endorsement target.
- Don't attack primary rivals.

### Early general

- Front-load upgrades (no 1.5× multiplier on primary-phase upgrades).
- Full Demographic Poll to diagnose weak groups.
- Target ads and canvassing to weak groups.

### Final sprint (last 4 turns)

- Burst campaign actions to peak PI.
- Burst ads to peak Favorability.
- Canvass aligned demographics (2× multiplier).
- Opposition Research drains 2× on target.
- Log in hourly. Every turn matters.

## What not to do

- **Don't over-buy ads.** Diminishing returns kick in above Favorability 70 (each point over 70 reduces the ad gain by 0.1). At high favorability an ad can cost ₳180k+ for a single point: terrible value.
- **Don't canvass misaligned demographics.** At 6+ Manhattan distance you get 10% of base effect.
- **Don't maintain high Ground Game / Media Spending tiers when you can't afford maintenance.** Auto-downgrade costs you the investment with no refund.
- **Don't upgrade in general if you can upgrade in primary.** 1.5× multiplier applies to general-phase upgrades.
- **Don't attack everything that moves.** Infamy drain compounds, attack failure chance grows with your Infamy.

## Related

- [Election Mechanics](/wiki/election-mechanics): Vote math.
- [Primaries](/wiki/primaries) · [General Elections](/wiki/general-elections): Phase-specific rules.
- [Fundraising & Ads](/wiki/fundraising-ads): Money flow mechanics.
- [Canvassing](/wiki/canvassing): Turnout boosting.
- [Demographics & Targeting](/wiki/demographics-targeting): Appeal math and group composition.
- [Campaign Manager](/wiki/campaign-manager): UI walkthrough of /campaign/[id].
- [Primary vs General Tactics](/wiki/primary-general-tactics): Pivoting between phases.
- [Party Building](/wiki/party-building): Growing your party's org.
`;
