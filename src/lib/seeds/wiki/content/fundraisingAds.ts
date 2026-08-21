export const fundraisingAdsContent = `# Fundraising & Ads

Money is the oxygen of a campaign. This page covers how you earn it, how you spend it efficiently, and where it's wasted. For upgrade-tier math (Ground Game, Opposition Research, Media Spending) see [Campaign Strategy](/wiki/campaign-strategy).

## Your two money pools

Non-interchangeable:

- **Campaign Funds:** what you spend on ads, polls, donor base, NPP influence, party taxes, personal campaign donations. Starts at ₳250,000. All the actions in this page drain this pool.
- **Cash on Hand:** personal liquid cash. Only spent on wire transfers (Portfolio page) or converted into Campaign Funds at 50% via the Personal Campaign Donation action. Starts at ₳0.

If you see "−₳100,000" next to an action, it's Campaign Funds unless the action explicitly says "personal cash."

## Fund generation per turn

Every turn your Campaign Funds grow by a sum of three components:

| Component | Amount |
| --- | --- |
|| Base rate | ₳5,000 to ₳40,000/turn by state population tier |
|| Donor bonus | \`donorLevel × per-tier-rate\` (by home state population) |
|| Office bonus | Tier-based fixed amount while in office |

### Donor base income by state population tier

| Tier | Threshold | Per level per turn |
| --- | --- | --- |
| Small | < 2M | +₳100 |
| Medium | 2 to 8M | +₳200 |
| Large | 8 to 20M | +₳400 |
| Mega | > 20M | +₳800 |

A Level 5 donor base in Pennsylvania (medium tier) yields ₳1,000/turn passively; the same level 5 in California (mega tier) yields ₳4,000/turn.

### Office fund bonuses

| Office | Per turn |
| --- | --- |
| US House | +₳5,000 |
| US State Senate | +₳3,000 |
| US Senate | +₳15,000 |
| US Vice President | +₳25,000 |
| US Governor | +₳15,000 |
| US President | +₳50,000 |
| UK MP / DE MdB / JP Sangiin/Shūgiin | equivalent tier |
| UK / DE / JP Prime Minister / Chancellor | equivalent top tier |

## Fundraise action

- **Cost:** 3 actions, free (no money up front)
- **Returns:** \`(₳50,000 + ₳2,000 × donor base level) × (1 + stateInfluence/100)\`
- **Requires:** Donor base level ≥ 1 (every character starts at 1)

At level 1 with 0% state influence: +₳52,000 per fundraise. At level 5 with 50% influence: +₳90,000. At level 10 with 100% influence: +₳140,000.

The state influence multiplier ranges from **1.0× at 0%** to **2.0× at 100%**, so high-PI characters raise dramatically more per action.

Fundraise is most efficient when your donor base is high. A level 3 donor base fundraise (₳56k return, 3 actions) is ~18.7k per action; a level 1 fundraise is ~17.3k per action.

## Build Donor Network

- **Cost:** 4 to 20 actions (tiered by current level) and \`₳3,000 + ₳1,500 × current level\` scaled by state GDP per capita (0.85 to 2.0×). At national-average GDP, level 1→2 costs ~₳4.5k.
- **Effect:** Donor base level +1
- **Recovery window:** ROI depends on state tier

In a medium-tier state (+₳200/turn per level), level 1→2 at ~₳4.5k generates +₳200/turn extra passive income. Breakeven: ~23 turns (~1 real day). The level also improves fundraise yield by ₳2k permanently, so breakeven on that part is ~2 fundraises.

In a mega-tier state (+₳800/turn per level), the math shortens further: ~6 turns to break even on passive income alone.

## Ads (Run Advertisements)

- **Cost:** 5 to 9 actions (tiered by favorability), fund cost scaled by state GDP (~₳100k at national average)
- **Effect:** +1 to +3 Favorability, with **diminishing returns above 70**.

Practical yields:

| Current Favorability | Expected delta per ad |
| --- | --- |
| 50 | +2 to +3 |
| 60 | +2 |
| 70 | +1 to +2 |
| 75 | +1 |
| 80+ | +1 (floored, never rounds to 0) |

Above 75 Favorability, each ad delivers less and less, but the gain is floored at +1: an ad is never fully wasted, just poor value.

### Out-of-state cost multipliers

Interpersonal actions (Support, Attack, Barnstorm) cost more when targeting a politician outside your home state:

- Home state: 1.0×
- Neighbouring state: 1.25×
- Non-neighbour: 1.5×

Campaign and Advertise action costs are scaled by state GDP per capita, not by adjacency.

### Ad targeting

When you run an ad, you choose a demographic group (or "broad" for untargeted). Targeted ads give slightly higher effective Favorability gain on that group than untargeted. In competitive generals with a known Full Poll, target the 2 to 3 weakest groups and leave the others alone.

## Campaign action

- **Cost:** 1 to 5 actions (tiered by PI), fund cost scaled by state GDP
- **Effect:** +1 Political Influence

The workhorse. Every character runs dozens of Campaign actions per week.

- Political Influence decays at 0.75% of current value per turn. A single Campaign action per turn is more than enough to offset decay at low PI; at PI=80 you need +1 per turn to grow, which means ~1 Campaign action per turn just to maintain.
- At PI=100 (max), you can stop Campaigning without much loss because decay of 0.75 rolls you back to ~99 and you barely notice.

## Party tax

When you're in a party, a percentage of your fundraising and per-turn fund generation goes to the party treasury:

- Set by party leadership (Chair and Treasurer).
- Ranges 0% to 33%.
- Applied to **gross** income: \`fundraise earnings × (1 − taxRate)\` arrives in your Campaign Funds.
- National parties and regional parties can have different rates: your contribution goes to the relevant treasury.

A 20% party tax on a ₳100k fundraise yields ₳80k to you, ₳20k to the party treasury. High-tax parties run more coordinated NPP operations but cost members more; low-tax parties let members retain more but spend less party-wide.

## Campaign page budget (upgrades and maintenance)

Once you're a candidate, your **campaign page** gets its own budget pool with passive income, upgrades (Ground Game, Media Spending, Opposition Research), and maintenance costs. These are distinct from your personal Campaign Funds.

- Passive income by fundraising level: ₳20k to ₳5M/turn, 10 levels, upgrade-gated.
- Maintenance on Ground Game / Media Spending tiers deducts each turn.
- If the campaign can't cover next turn's maintenance, levels auto-downgrade (Media first, Ground Game second).
- Insolvent campaigns survive with passive income rebuilding funds, but pay downgraded effects.

Full breakdown: [Campaign Strategy](/wiki/campaign-strategy) → Strategic Upgrades.

## Personal Campaign Donation

- **Cost:** 2 actions + amount of Cash on Hand you choose
- **Effect:** 50% of amount arrives in Campaign Funds; 50% stays as Cash on Hand for the recipient if they differ
- **Infamy:** Scales with size of donation

Used mostly for wealthy characters with significant Cash on Hand wanting to convert to Campaign Funds, or to fund another player's campaign. It triggers an Infamy tick: small donations add little, large ones (5-figure+) can accumulate.

## Fundraising priority hierarchy

For a new player:

1. **Spend starting actions on first Build Donor Network** to Level 2. Immediate ROI on passive income and fundraise yield.
2. **Fundraise regularly** at Level 2+ to refill Campaign Funds.
3. **Ads only when Favorability is below your target** (60 minimum, 70 optimal for most races). Don't ad-spam above 75.
4. **Build Donor Network** when you can afford it: each level compounds permanently.
5. **Upgrade your Campaign page fundraising level** once you're a candidate.
6. **Party Tax consideration:** if your party is high-tax (25%+), factor it into fundraise math. A ₳100k fundraise at 25% tax gives you ₳75k net.

## Related

- [Stats & Actions](/wiki/stats-actions): Full action cost reference.
- [Campaign Strategy](/wiki/campaign-strategy): Campaign page upgrades with maintenance math.
- [Campaign Manager](/wiki/campaign-manager): The /campaign/[id] page.
- [Demographics & Targeting](/wiki/demographics-targeting): Where to aim ads.
- [Political Parties](/wiki/political-parties): Party tax, treasury operations.
- [Canvassing](/wiki/canvassing): Turnout-boosting alternative to ads.
`;
