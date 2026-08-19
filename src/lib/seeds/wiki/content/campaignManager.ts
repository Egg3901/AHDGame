export const campaignManagerContent = `# Campaign Manager

Eligible candidacies get a dedicated **campaign page** at \`/campaign/[id]\`. This is where your candidate's campaign lives: budget, upgrades, operations, activity log, endorsements, and manager assignments. It's separate from your character's profile and has its own action and money pools.

**Eligibility:** US president, senate, governor, house, and state senate races all run the Campaign Manager. Non-US races (UK / JP / DE / IE) currently fall back to a lighter election-detail page, because their country-specific campaign-finance models (UK statutory expense limits, JP mixed FPTP/PR, DE party-list, IE STV) need a separate audit and adaptation pass before the Manager turns on.

This page describes what the campaign page does and how to use it. For upgrade tables, maintenance math, and tactical priorities see [Campaign Strategy](/wiki/campaign-strategy).

## Access tiers

The campaign page shows different amounts of information depending on who's viewing:

| Viewer | What they see |
| --- | --- |
| **Campaign owner** (candidate) | Full management UI: budget, upgrades, activity log, manager, endorsements, fog-of-war settings |
| **Party members** (same party, not the candidate) | Intelligence view: strategy, polling, spending (fog ±1 level) |
| **Public** (anyone else) | Basic summary: candidate name, office, party, active status (fog ±3 levels) |

Fog of war is automatic. Opponents can see your upgrade levels, but only through a ±3-level uncertainty band.

## The sections

### Overview

- Candidate name, party, office, election details.
- Current fundraising level and passive income/turn.
- Active upgrade tiers.
- Current endorsement count (NPP + player for presidential).
- Campaign funds balance and per-turn net income.
- Estimated vote share (live poll-style projection).

### Budget

- Income vs spending over time (chart).
- Per-turn net calculation.
- Category breakdown: which upgrade maintenance / party tax / ad spend is taking what percentage of your spend.
- Negative-funds warning if you've overspent.
- Auto-downgrade warning if projected maintenance > projected income.

### Strategic Ops

Four **branch trees**, each with its own card, replacing the old flat-level upgrade model:

- **Fundraising**: starter passive income, then branches (Grassroots, Bundlers, Direct Mail) that add more.
- **Media Spending**: starter passive Favorability gain, then Broadcast and Television branches that add more, plus a Rapid Response branch.
- **Ground Game**: starter turnout bonus in your race's competitive areas (swing states for president, swing counties for senate / gov, swing precincts for house / state senate), then Field Offices, Get-Out-The-Vote, and Volunteer Corps branches.
- **Opposition Research**: starter drain to one target, then Dossier, Scandal Leak, and Counter-Intel branches that add or amplify drain. Retargetable.

Each card shows the starter node and its branches, next-branch cost (both money and campaign actions), and current per-turn effect.

**General-phase cost multiplier:** All upgrade costs are **1.5× higher** once the election enters the general phase. Front-load upgrades in the primary.

### Activity log

Chronological record of campaign events:

- Upgrade purchases
- Auto-downgrades (with reason)
- Endorsements received
- Manager assignments
- Major stat changes
- Ad campaigns and canvassing events

Used for campaign-owner review and for party/public intelligence.

### Endorsements

- List of NPPs and players who've endorsed the candidate.
- Contribution to campaign actions (via the \`1 + floor(sqrt(endorsements) × 3)\` formula).
- Endorsement history: when and by whom.

Player endorsements only count toward the action bonus in **presidential** races. NPP endorsements count in all races.

### Manager (admin-assignable)

An admin can assign a manager to a campaign. The manager has:

- Read access to the full campaign page (same as the candidate).
- Ability to trigger upgrades, allocate campaign actions, and change opposition research targets.
- Cannot withdraw the candidate.

This is designed for multi-player coordination: a campaign manager can run the operational details while the candidate focuses on character actions.

## Campaign actions (separate from character actions)

Your campaign generates its own per-turn action pool:

- **Base floor:** At least 1 campaign action/turn.
- **Endorsement bonus:** \`1 + floor(sqrt(endorsements) × 3)\` additional campaign actions per turn.
  - 0 endorsements → 1/turn
  - 4 endorsements → 7/turn
  - 9 endorsements → 10/turn
  - 16 endorsements → 13/turn
  - 25 endorsements → 16/turn

Campaign actions are consumed by **upgrades only** (not regular actions like Campaign or Fundraise).

## Budget math

Campaign funds flow:

\`\`\`
+ Fundraising tier passive income       (each turn)
+ Donations (personal cash donations)
+ Party chair donations from treasury

− Ground Game maintenance (if purchased)
− Media Spending maintenance (if purchased)
− New upgrade purchases (when made)
− Ad campaigns (when initiated)
\`\`\`

Net balance updates each turn. The Budget tab visualises this over time.

### Insolvency and auto-downgrade

If \`projected_funds (= funds + income) < maintenance\`:

1. The turn processor drops levels until maintenance is affordable.
2. **Priority.** The tier with the higher marginal (most recent level) maintenance drops first.
3. **Tie-breaker.** Media Spending drops before Ground Game.
4. **Passive effects** still fire this turn using pre-downgrade levels (one last gasp).
5. **Maintenance** is deducted using post-downgrade levels.
6. **No refund.** Money paid for the level is gone.
7. An \`activityHistory\` entry logs the downgrade with \`reason: "insolvency"\`.

Existing negative funds are **not healed**: the campaign keeps the debt, but stops bleeding.

## Fog of war details

Opponent-visible upgrade levels are fuzzed each turn:

- **Public:** Random offset in ±3. If you're at level 5, public sees anywhere from 2 to 8.
- **Party members:** Random offset in ±1. If you're at level 5, party sees 4, 5, or 6.

Update frequency: every turn during Group 6 (campaign processing).

Your own display is always accurate.

## Candidate-only operations

Actions only the candidate (or their admin-assigned manager) can perform:

- Purchase upgrades
- Change Opposition Research target (6-hour cooldown between retargets)
- Withdraw candidacy (manager cannot)
- Accept or reject donations via party chair (automatic acceptance)

## Donations

Anyone can donate:

- **Player-to-candidate donations.** Personal Cash on Hand converted to campaign funds at 100% (to the campaign, not to a character's Campaign Funds). All donations are logged publicly.
- **Party-chair donations.** National or regional chair can disburse from the party treasury to any candidate in their party.
- **Party-treasurer donations.** Treasurer has equivalent authority to chair for party-fund disbursements.

Donations show up in the Budget tab and Activity Log with attribution.

## Strategic use of the campaign page

### In the build phase

- Start the Fundraising tree early for the passive income boost. Primary-phase costs are lower than general-phase.

### Entering a primary

- Decide on initial strategy: ads-heavy (Media Spending tree), turnout-heavy (Ground Game tree), or damage-opponent (Opposition Research tree).
- Most candidates pick one emphasis plus Fundraising.

### Early general

- Push the Fundraising tree further if you can.
- Invest in Media or Ground Game branches depending on race.
- Start Opposition Research on the leading opponent.

### Closing sprint (final 4 turns)

- Everything doubles. Don't start new branches (expensive, no time for effect): run existing trees at full tilt.
- Use campaign actions from endorsement bonuses.
- Retarget Opposition Research at the leading opponent if your original target isn't the current frontrunner.

## Common mistakes

- **Upgrading in general instead of primary.** You pay more. Front-load.
- **Buying high-maintenance branches you can't afford.** Auto-downgrade kicks in, you lose the investment.
- **Ignoring Opposition Research retarget cooldown.** Plan retargets ahead of time.
- **Not checking fog-adjusted opponent investment.** A fogged opponent estimate could be well off. Don't over-react.
- **Forgetting endorsement action bonuses.** If you have 9 NPP endorsements, your campaign has 10 actions/turn, worth real upgrade velocity.

## Related

- [Campaign Strategy](/wiki/campaign-strategy): Upgrade tables, phase-by-phase allocation, all the numbers.
- [Fundraising & Ads](/wiki/fundraising-ads): Personal Campaign Funds and ad mechanics.
- [Election Mechanics](/wiki/election-mechanics): Where campaign-page effects enter vote math.
- [Parties](/wiki/parties): Party chair donations and treasury disbursement.
- [NPP System](/wiki/npp-system): Requesting NPP endorsements.
`;
