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
| Primary declared | Campaign heavily > targeted ads > NPP endorsement requests |
| General, opening | Campaign + ads in weak demographics > NPP endorsements > Full Poll |
| General, middle | Maintain PI + Favorability > Opposition Research on leading opponent |
| Final 4 turns | Closing-sprint campaign + canvassing + ads |
| Incumbent between cycles | Maintain PI + fundraise for war chest + build party influence |

## The campaign page (upgrades and budget)

Once you're a candidate, your **campaign page** (\`/campaign/[id]\`) gives you a **separate budget** with upgrades. This is distinct from your personal Campaign Funds.

### Fundraising levels (10 tiers)

Your campaign has a fundraising level 0-10 that generates passive income per turn:

| Level | Income/turn | Upgrade cost | Actions |
| --- | --- | --- | --- |
| 0 | ₳20,000 | n/a | n/a |
| 1 | ₳35,000 | ₳50,000 | 10 |
| 2 | ₳60,000 | ₳120,000 | 15 |
| 3 | ₳100,000 | ₳250,000 | 20 |
| 4 | ₳150,000 | ₳500,000 | 25 |
| 5 | ₳200,000 | ₳900,000 | 30 |
| 6 | ₳350,000 | ₳1,500,000 | 40 |
| 7 | ₳600,000 | ₳2,500,000 | 50 |
| 8 | ₳1,000,000 | ₳4,000,000 | 60 |
| 9 | ₳2,500,000 | ₳6,500,000 | 75 |
| 10 | ₳5,000,000 | ₳10,000,000 | 90 |

**General phase multiplier:** Upgrade costs are **1.5× higher** once the election enters the general phase. Front-load upgrades during primaries.

### Strategic upgrades (4 dimensions)

Each upgrade tier has up to 5 levels (or 10 for Fundraising):

| Upgrade | Levels | Effect per level | Maintenance/turn |
| --- | --- | --- | --- |
| **Fundraising** | 10 | Passive income per turn (see table above) | n/a |
| **Media Spending** | 5 | +0.5% Favorability per level per turn (passive) | Yes (steep) |
| **Ground Game** | 5 | +3% turnout in swing states per level | Yes |
| **Opposition Research** | 5 | −0.5%/turn Favorability drain to one target | n/a |

**Maintenance** is deducted from campaign funds each turn. If projected funds can't cover next turn's maintenance, levels **auto-downgrade**: Media first, then Ground Game. No refund.

### Opposition Research

Lets you drain an opponent's Favorability passively. Retargeting has a 6-hour cooldown.

- Level 1: −0.5%/turn to target
- Level 5: −2.5%/turn to target

In the final 4 turns the effect **doubles** (2× campaign-season multiplier). A Level 3 Opposition Research in the closing sprint is effectively −3%/turn on the target, which over 4 turns is −12 Favorability, often race-deciding.

### Campaign actions

Your campaign generates its own per-turn action pool:

- **Base:** Every campaign earns at least 1 action/turn.
- **Endorsements:** NPP and player endorsements (presidential only) add actions via \`1 + floor(sqrt(endorsements) × 3)\`. 9 endorsements ≈ 10 actions/turn.

Campaign actions are spent **only** on upgrades, not on regular character actions.

## Party organization

Party organization (0-100) in your state gives a vote-pool multiplier:

- **Formula:** \`1.0 + (stateOrg / 100) × 0.6\`
- **Range:** 1.0× at org=0, **1.6× at org=100**
- **No penalty:** low org gives baseline 1.0×

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

- Get Donor Base to Level 3 (₳75k + ₳100k = ₳175k investment, 12 actions), for permanent compounding income.
- Hit Favorability 65 via 3 to 5 ads.
- Push Political Influence to 40+ through daily Campaign actions.
- Join a party; invest ~2 weeks real-time to push Party Influence up.
- Watch opponent candidacy declarations. If an NPP declares in the next primary, prepare accordingly.

### Primary phase

- Campaign aggressively in-state: every +1 PI converts to ~0.25 primary score points.
- Keep Favorability 70+: each point is worth 0.35 primary score points.
- Request NPP endorsements (align with party).
- Don't attack primary rivals.

### Early general

- Front-load upgrades (no 1.5× multiplier on primary-phase upgrades).
- Full Demographic Poll to diagnose weak groups.
- Target ads and canvassing to weak groups.
- NPP endorsements are worth more in general than primary.

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
