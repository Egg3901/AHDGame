export const statsActionsContent = `# Stats & Actions

The complete reference for every stat a character carries and every action they can spend. For big-picture framing see [Core Systems](/wiki/core-systems); this page is the canonical look-up.

## Core stats

### Political Influence (PI)

- **Scale:** 0 to 100, per state
- **Start:** 0
- **Grows by:** Campaign action (+1 base per action, diminishing above 50, floored at +0.1)
- **Decays by:** 0.75% of current value per turn (floor 0)
- **Drives:** Vote reach in state races, primary scores in state races
- **Scope:** Single value; home-state focus in current implementation

PI is the most important stat in the early game. Because decay is relative (not flat), low-PI characters lose less per turn than high-PI characters, but you need to sustain it to win competitive races.

### National Political Influence (NPI)

- **Scale:** Uncapped; starts at 0
- **Grows by:** +state PI ÷ 100 per turn (automatic, no action required), **plus a position bonus** per turn depending on held office (President/PM/Chancellor +2.5, VP +2.0, other seated offices, Governor, Senator, Representative, cabinet, etc., +1.0, none +0)
- **Drives:** Presidential races **exclusively**: both reach and appeal
- **General-election scaling:** Sqrt curve, capped at 1.0 once NPI reaches 100. NPI 25 → 0.5×; NPI 50 → ~0.71×; NPI 85 → ~0.92×; NPI 99 → ~0.995×; NPI ≥ 100 → 1.0× (cap)
- **Presidential-primary scaling:** A separate diminishing-return curve, \`1 − exp(−NPI/45)\`, approaches 1.0 without a hard cap

Above NPI=100 there is no further general-election reach bonus, although the presidential-primary curve continues to increase by progressively smaller amounts. NPI=99 vs NPI=85 is a meaningful general-election spread (~7 percentage points of reach), which it wasn't under the old log curve. NPI is still a long game; only serious presidential contenders should optimise for it. You build NPI by sustaining high state PI over many turns: it accumulates passively. Holding national office accelerates the build.

### Favorability

- **Scale:** 0 to 100
- **Start:** 50 (neutral)
- **Grows by:** Ads (+1 to 3, diminishing above 70%)
- **Decays by:** Attack damage from opponents, Infamy passive drain (above 20%), natural decay only when above 60
- **Drives:** Appeal multiplier in vote formulas across every race type

Favorability is stable at 60 or below. Above 60 it slowly decays if you stop running ads. Above 70 ad diminishing returns kick in hard: each ad gives fewer points the higher you already are.

### Infamy

- **Scale:** 0 to 100
- **Start:** 0
- **Grows by:** Attack actions (+2% each), NPP "lower" boost action (+2%)
- **Effects:**
  - 0 to 20%: no penalty
  - 20%+: drains (infamy − 20) × 0.05% Favorability per turn
  - Attack failure chance = Infamy × 10 per 1000 roll
- **Decays by:** 5% of current value per turn

Infamy is a budget, not a punishment. Spending 2 to 4 attacks against a competitor costs you some Infamy but it decays fast. Sustained attacking (20+ actions) accumulates real damage to your own Favorability.

### Policy Positions

- **Scale:** −5 to +5 per axis (economic, social)
- **Set:** At character creation
- **Changed by:** Voting on bills. Each bill moves you at most 0.25 per axis: an Aye pulls you toward the bill's average position (never past it), a Nay pushes you 0.25 away, and re-voting is measured from where you stood before that bill, so flipping cannot stack. The vote buttons show the exact move before you click.
- **Used for:**
  - Primary score alignment to your party's official position
  - Demographic group appeal (each group has preferred economic/social positions)
  - Party Influence amplification (closeness boosts your party-pool share)

Over a long career of floor votes you will drift. If your drift diverges far from your party, expect lower primary scores and reduced party-pool bonuses.

### Campaign Funds

- **Start:** ₳250,000 (or local-currency equivalent)
- **Grows by:** Fundraise action; per-turn fund generation (base + donor bonus + office bonus)
- **Spent on:** Ads, polls, donor base, NPP influence, party taxes, personal campaign donations
- **Separate from:** Cash on Hand

Fund generation per turn:

| Source | Amount |
| --- | --- |
| Base rate | small fixed amount |
| Donor bonus | donor level × per-tier rate (state population tier) |
| Office bonus | House +₳5k · State Sen +₳3k · Senate +₳15k · VP +₳25k · Gov +₳15k · Pres +₳50k |

### Cash on Hand

- **Start:** ₳0
- **Grows by:** Passive income (corp dividends, bond coupons, share sales); 50% of any Personal Campaign Donation you make
- **Spent on:** Wire transfers only (Portfolio → Wire)
- **Cross-country transfers blocked**

### Donor Base Level

- **Scale:** Uncapped (starts at 1)
- **Grows by:** Build Donor Network action
- **Cost per level:** ₳3,000 + ₳1,500 × current level, scaled by state GDP per capita (0.85 to 2.0×). At national-average GDP, level 1→2 costs ~₳4.5k and level 74→75 costs ~₳114k.
- **Income per turn per level:** depends on state population tier
  - Small state (<2M): +₳100/level
  - Medium (2 to 8M): +₳200/level
  - Large (8 to 20M): +₳400/level
  - Mega (>20M): +₳800/level

### Actions

- **Base per turn:** 4
- **Office bonus:** House/State Sen +1 · Senate/VP +2 · Gov +2 · Pres +4 · Central Bank Chair +3
- **Party bonus:** variable per turn, distributed from party pool by your Party Influence × platform alignment
- **Cap:** 200
- **Hoarding penalty:** −4/turn above 100
- **Starting grant:** 25 one-time

### Party Influence

- **Scale:** 0 to 100 (only applies to party members)
- **Grows by:** Passive accrual while active in a party; scaled by invested party operations
- **Decays by:** Inactivity within the party; leaving-and-rejoining resets to 0
- **Drives:** Your share of the party's bonus action pool each turn
- **Amplified by:** Policy closeness to the party's official economic/social position

Visible on your profile's Party Standing section and in the party-members table.

## Standard campaign actions

| Action | Actions | Funds | Effect |
| --- | --- | --- | --- |
| Campaign | 1 to 5 (tiered by PI) | Scaled by state GDP | +1 Political Influence |
| Fundraise | 3 | Earns ₳50k + ₳2k × donor level | Requires donor base > 0 |
| Run Advertisements | 5 to 9 (tiered by favorability) | Scaled by state GDP | +1 to 3 Favorability (diminishing above 70) |
| Build Donor Network | 4 to 20 (tiered by level) | Scaled by state GDP | +1 Donor Base Level |
| Quick Poll | 2 | −₳25,000 | Topline appeal + best/worst 5 groups |
| Full Demographic Poll | 6 | −₳75,000 | Complete breakdown by demographic category |
| Post news (player feed) | 0 | None | Free /news article; 12h cooldown per author |
| Sponsored news post | 5 | −₳100,000 **personal cash** | Paid /news placement; 30min cooldown |
| Personal Campaign Donation | 2 | Converts chosen Cash on Hand | 50% → Campaign Funds; Infamy scales with size |
| Rest | 0 | None | No effect; used to reset per-turn cooldowns |

### Out-of-state cost multipliers

Apply to interpersonal actions (Support, Attack, Barnstorm) when targeting a politician outside your home state:

- Home state: 1.0×
- Neighbouring state: 1.25×
- Non-neighbour: 1.5×

## Interpersonal actions

Target another player character or NPP from their profile page. Cross-country actions are blocked.

| Action | Actions | Funds | Effect on target | Effect on you |
| --- | --- | --- | --- | --- |
| Support | 6 | None | +1% Favorability (±12 net swing cap per target per turn) | None |
| Attack | 6 | None | −1% Favorability (fails if roll < Infamy × 10; ±12 net swing cap per target per turn) | +2% Infamy (always) |
| Barnstorm | 5 | −₳100,000 | +1% PI (+2% if your home state matches target's) | None |

- Out-of-state cost multipliers apply to Support and Attack.
- Barnstorm ignores out-of-state multipliers (flat 5 actions).
- Failed attacks still cost you 2 Infamy.
- You can't Support or Attack yourself.

## Presidential travel (US general election only)

Available to active presidential candidates during the general phase.

| Action | Cost | Effect |
| --- | --- | --- |
| Travel | 3 to 10 actions (scaled by state electoral votes: ≤5 EV = 3, ≤10 = 5, ≤20 = 7, >20 = 10) | Sets your travel state, unlocks canvassing there, and adds +1% Favorability per turn while you remain in-state |

- Only US states as destinations; one at a time.
- Switching states costs another 3 to 10 actions (same EV scale).
- Travel state shows as a badge on the electoral map and candidate row.
- Travel expires on withdrawal or election end.

## NPP direct actions

From an NPP profile (\`/npp/[id]\`), these are deterministic capital actions gated by your relationship score with the NPP (−100 to +100), not random-chance rolls:

| Action | Actions | Funds | Effect |
| --- | --- | --- | --- |
| Request Endorsement | 6 | None | NPP publicly endorses your current candidacy, if the relationship gate (based on the NPP's policy fit with you) is cleared |
| Private Meeting | 3 | None | +5 relationship |
| Boost Favorability | 5 | ₳10,000 | +3 NPP favorability, +2 relationship |
| Reduce Favorability | 5 | ₳10,000 | -3 NPP favorability, -2 relationship |
| Boost Influence | 6 | ₳20,000 | +2 NPP political influence, +2 relationship |
| Reduce Influence | 6 | ₳20,000 | -2 NPP political influence, -2 relationship |

There is no "Request Withdrawal", "Request Opposition", or "Request Leadership Support" action; the six above are the full set.

Details: [NPPs Overview](/wiki/npps-overview).

## Party-level actions

Party Chairs and Vice Chairs draw from the **party action pool** to run influence operations on NPPs (in-state for regional chairs, nationally for the National Chair). The pool refills each turn from member contributions. See [Political Parties](/wiki/political-parties) and [Party Organization](/wiki/party-organization).

## Per-turn resource flow (at a glance)

At the top of each hour, in this order:

1. Hoarding penalty applies if > 100 actions.
2. Base 4 actions refresh.
3. Office bonus actions refresh.
4. Party bonus actions distribute from pool.
5. Fund generation credits (base + donor + office).
6. Political Influence decays 0.75%.
7. Infamy decays 5%.
8. Favorability decays if above 60.
9. NPI accrues +state PI / 100.

Then bills, NPP behavior, elections, and all other systems run.

## Related

- [Core Systems](/wiki/core-systems): Time, actions, money in context.
- [Election Mechanics](/wiki/election-mechanics): How stats feed into vote calculations.
- [Reference: Formulas](/wiki/reference-formulas): Exact math for reach, appeal, primary scores.
- [NPPs Overview](/wiki/npps-overview): NPP concepts and links to detailed NPP guides.
- [Political Parties](/wiki/political-parties): Party influence and action pool mechanics.
`;
