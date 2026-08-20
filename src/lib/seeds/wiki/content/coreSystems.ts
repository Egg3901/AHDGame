export const coreSystemsContent = `# Core Systems

Time, money, and actions are the three resources that bind every decision in A House Divided. This page is the reference for how they flow.

## Time: turns, days, and years

- **1 turn = 1 real hour = 1 game week.**
- **24 turns = 1 real day = 24 game weeks.**
- **48 turns = 2 real days ≈ 1 game year** (the game uses a compressed 48-week year that cleanly maps electoral cycles onto real-world time).

The turn processor fires once per hour, on the hour. Every turn advances the world: actions refresh, elections tick toward resolution, bills age, NPPs act, markets settle, and metrics update. There are no overnight breaks: the simulation is continuous and there are no resets.

## Term cycles

Term lengths below are stated in **real time** (hours/days you wait between elections), followed by the game-time equivalent. Only US values are listed here; non-US terms are covered in each country hub.

| Office | Term (real) | Term (game years) |
| --- | --- | --- |
| US House | 4 real days | 2 game years |
| US Senate | 12 real days | 6 game years (3 staggered classes) |
| US Governor | varies by state | typically 4 game years |
| US President | 8 real days | 4 game years |

**Staggering matters.** Senate Class 1, 2, and 3 elections fire at different times so one-third of the Senate is up for election every ~4 real days. This keeps Senate activity continuous.

For UK MP and Prime Minister timing see [United Kingdom](/wiki/united-kingdom). For the German Bundestag and Chancellor see [Germany](/wiki/germany). For the Japanese Diet see [Japan](/wiki/japan).

## The action economy

Actions are your activity budget. Everything you do (campaigning, voting, wiring money to an ally) costs actions.

### Earning actions

Each turn you receive:

- **4 base actions**: everyone gets this.
- **Office bonus**: stacked on top of base:
  - House / State Senate / Bundestag member / Sangiin member / MP: **+1**
  - Senate / Vice President / state governor analogue: **+2**
  - Governor: **+2**
  - President: **+4**
  - Central Bank Chair: **+3** (stacks on any office bonus you also hold)
- **Party bonus**: a variable share of your party's action pool, allocated by Party Influence × platform-alignment closeness.
- **Starting grant**: a one-time 25 actions at character creation.

Actions accumulate up to a **cap of 200**. Above 100 you pay a **−4 hoarding penalty per turn** applied before the refresh. For characters with only the base 4 actions, this creates a soft cap around **100-104**; office holders with higher refresh still grow toward the hard cap, just slowed by 4 per turn.

### Spending actions

Action costs for core activities (full list on [Stats & Actions](/wiki/stats-actions)):

| Action | AP Cost | Fund Cost | Effect |
| --- | --- | --- | --- |
| Campaign | 1-5 (tiered by PI) | Scaled by state GDP | +1 Political Influence |
| Fundraise | 3 | none | Earns ₳50k + ₳2k × donor level |
| Quick Poll | 2 | ₳25k | topline + best/worst 5 groups |
| Run Advertisements | 5-9 (tiered by favorability) | Scaled by state GDP | +1-3 Favorability (diminishing above 70%) |
| Full Demographic Poll | 6 | ₳75k | complete breakdown |
| Build Donor Network | 4-20 (tiered by level) | Scaled by state GDP | donor level +1 |
| Support | 6 | none | +1% target Favorability (±12 net swing cap per target per turn) |
| Attack | 6 | none | −1% target Favorability; +2% own Infamy (±12 net swing cap per target per turn) |
| Barnstorm | 5 | ₳100k | +1-2% target Political Influence |
| Presidential Travel | 5 | none | Sets travel state during general; +1%/turn Favorability while there |

**Out-of-state multipliers** (1.0× home / 1.25× neighbour / 1.5× non-neighbour) apply to interpersonal actions (Support, Attack, Barnstorm), not to Campaign or Advertise.

## Money: two pools

Two money pools, separate and non-convertible:

- **Campaign Funds**: Political war chest. Used for ads, polls, donor base, NPP influence, party taxes, and personal campaign donations.
- **Cash on Hand**: Personal liquid cash. Only used for wire transfers from the Portfolio page.

Fund generation per turn (Campaign Funds):

- **Base rate**: a small fixed amount per turn.
- **Donor bonus**: scaled by donor level and state population tier (small state +₳100/level, medium +₳200/level, large +₳400/level, mega +₳800/level).
- **Office bonus**: House +₳5k, State Senate +₳3k, Senate +₳15k, VP +₳25k, Governor +₳15k, President +₳50k.

Cash on Hand comes from passive income streams (corporation dividends, bond coupons, share sales) and a 50% slice of any Personal Campaign Donation you make (the other 50% moves to Campaign Funds).

## The turn processing order (engineer's note)

Each hour the processor runs roughly a dozen top-level adapters that together call over 100 phase steps, organized into 14 groups. Most phases within a group run in parallel; some groups (notably election resolution) are strictly sequential. You don't need to know the order to play well, but if you're wondering why your campaign action from 03:59 shows up "on the next turn," this is why.

| Group | What happens | Ordering |
| --- | --- | --- |
| 1. Resources | Action refresh, fund generation, corporation production | Parallel |
| 1a. Finance | Bond coupons, NPP funds, commodity prices, portfolios | Sequential after corps |
| 2. Demographics | Turnout decay, GOTV, party org maintenance | Sequential |
| 3. Party elections | State/national/committee party races, cleanup | Parallel then cleanup |
| 4. NPP behavior | NPPs enter elections, vote on bills, back leadership | Sequential (shared context) |
| 5. Bills & cabinets | Bill lifecycle, cabinet nominations | Parallel |
| 6. Campaigns | Campaign-manager turn, NPP actions every 4 turns | Sequential |
| 7. Election resolution | Primary → accumulation → timer → snapshot → general → leadership vacate | **Strict order** |
| 8. UK government | PM formation, confidence motions | After elections |
| 9. Election coverage | Spawn next cycles, leadership elections, stale cleanup | Parallel |
| 10. Fiscal year | October processing (turn 36 of 48) | Conditional |
| 11. Effects & metrics | Policy effects, demographics, approval decay, unowned sector growth | Parallel |
| 12. National aggregation | National metrics, inflation, central bank chair | After state effects |
| 13. History | Metric/approval/interest-rate snapshots | Parallel |
| 14. Persistence | Increment turn, save log, emit SSE | **Critical, not retryable** |

## Cabinet system (US and parliamentary executives)

Presidents and Prime Ministers appoint cabinets. In the US:

- President nominates any character to one of **15 principal officer roles** (Secretary of State, Treasury, Defense, Attorney General, Interior, Agriculture, Commerce, Labor, HHS, HUD, Transportation, Energy, Education, Veterans Affairs, Homeland Security).
- Senators vote For / Against / Abstain in a 24-hour window; simple majority confirms.
- Confirmed members appear on the cabinet page and gain whatever role-specific benefits exist.
- President can fire any confirmed member.

In parliamentary systems (UK / DE / JP) the executive composition follows the country's real-world conventions. See the country hubs.

## Campaign manager system

Every player candidacy has a dedicated **Campaign page** at \`/campaign/[id]\`:

- **Owner view**: Full management: budget, operations, manager assignment.
- **Party view**: Intelligence snapshot: strategy, polling, spending.
- **Public view**: Basic summary only.

The campaign manager page is where you spend a separate campaign budget on Fundraising, Ground Game, Media Spending, and Opposition Research: each is a branch tree, not a flat level ladder, so how you invest within a tree matters as much as how much. It's also where you track activity logs and view NPP endorsements. Details: [Campaign Manager](/wiki/campaign-manager) and [Campaign Strategy](/wiki/campaign-strategy).

## Perpetual elections

No seat sits vacant. When a House/Senate/Governor/Bundestag/Sangiin cycle resolves, the next cycle spawns **immediately**. Empty seats are filled by NPPs during their election window: they'll beat you if you don't contest.

## Related

- [The Game Loop](/wiki/the-game-loop): A player's hour-by-hour rhythm.
- [Stats & Actions](/wiki/stats-actions): Full reference with formulas.
- [Election Mechanics](/wiki/election-mechanics): How primaries and generals resolve.
- [NPP System](/wiki/npp-system): How autonomous politicians behave.
- [Cabinet](/wiki/cabinet): Presidential nominations and Senate confirmation.
`;
