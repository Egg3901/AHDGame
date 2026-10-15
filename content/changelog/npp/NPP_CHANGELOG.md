# NPP engine changelog

Non-player politicians (NPPs) fill offices, run in elections, govern, legislate,
invest and run companies wherever players do not. This page tracks the NPP
engine on its own version line, next to the [game changelog](/changelog).

Two settings decide what an NPP does in a world:

- **Autonomy level** (off, v0 to v6) is chosen per world and says which
  activities NPPs may perform there.
- **Engine version** is the shipped code and says how NPPs perform those
  activities. Every world on the same build runs the same engine version.

Engine majors follow the autonomy tiers. Engine 6 is the current overhaul, and
its behavior runs only in worlds set to autonomy v6. A world below v6 keeps the
engine 5 behavior.

Version rules: a **minor** version changes an NPP decision (what an NPP chooses,
when, or how well). A **patch** changes no decision (a fix restoring intended
behavior, or a cost-only change). A **major** adds an autonomy tier.

Engine 6 follows two fixed constraints:

- NPPs get smarter, not stronger. No engine 6 version raises NPP action points,
  income, starting money or election weight.
- The existing NPP election modifiers and NPP income rates stay as they are
  while the decision changes land. Once simulation shows how much stronger the
  changes make NPPs, the income NPPs receive without acting is stepped down to
  keep overall NPP strength level with engine 5.

## Roadmap

Planned work in stages, in order. Each stage ships as one or more engine 6
minor versions behind autonomy v6, and each version is compared against v5 in
seeded world simulations, with matched starts and more than one era, before it
is listed as shipped. A shipped version appears below the roadmap with its own
number.

### Stage 1: running for office

- **Race choice by chance of winning.** NPPs file where their party's strength
  gives them a real chance. (Strongest NPPs in senior races shipped in 6.1.0;
  weak parties putting them in winnable local races shipped in 6.12.0.)
- **Campaigning tied to a race.** Campaign and advertising actions spend on the
  race the NPP is running in, weighted toward close races, instead of raising
  general influence and favorability. (Rallies in the NPP's own race shipped in
  6.2.0.)
- **Consolidation.** A clearly trailing NPP withdraws before the primary
  rather than splitting the vote. It does not endorse: NPP endorsements stay
  something players request. (Shipped in 6.4.0.)
- **Presidential challengers** in non-player countries, inside the existing
  limit on how often a player's race can be challenged. (Shipped in 6.3.0.)

- **Career ladders.** Ambitious, strong incumbents step up to open senior
  races (shipped in 6.9.0).

### Stage 2: governing

- **Bills that can pass.** Before sponsoring, an NPP counts likely votes and
  does not introduce a bill that is short. (Shipped in 6.5.0, counting party,
  district, donor and opposition pressure; whips and caucuses come later.)
- **Whipping its own program.** A governing party whips co-partisans on the
  bills that serve its standing goals (shipped in 6.7.0). Opposition
  coordinates only against a government it can defeat (shipped in 6.11.0).
- **Ministers judged on their goal.** Cabinet posts go to NPPs ranked on fit
  with the head of government, competence and the brief; ministers are judged
  on the standing goal their brief serves (shipped in 6.15.0).
- **Fewer writes.** Ministerial orders and settings are written in batches
  per country (shipped in 6.14.3).

- **Currency defence.** Central banks answer sharp currency moves with rates
  (6.6.0) and reserve-backed trading bands (6.13.0).

### Stage 3: corporations

- **Investing on value.** NPP share and bond purchases compare price with
  fundamentals and sell on the same test, instead of fixed-probability rolls
  (shipped in 6.16.0).
- **CEO choice by record.** NPP-run companies choose CEOs from NPPs with a
  track record running companies in the same sector (shipped in 6.17.0).
- **Consequences across politics and business.** NPP officeholders weigh their
  holdings in votes (6.8.0), the conflict is shown on their profile (6.13.1),
  and voters mark down a vote their holdings decided (6.14.0).
- **Batched purchases.** The share-buying sweep was the largest single NPP
  cost in a turn (18.0 seconds and 1,465 database round trips on live turn
  168). Markets now settle in parallel with one pool read per sweep (6.16.1).
  The bond sweep is still one purchase at a time.

### Stage 4: cost

- NPP governing passes run countries in bounded parallel lanes instead of one
  after another (shipped in 6.14.2).
- Every engine 6 phase gets a per-turn round-trip budget, reported with the
  turn.

### Stage 5: strength accounting

- Compare v5 and v6 worlds on NPP win rate against players, NPP wealth, and
  returns on NPP-run companies.
- Step down the income NPPs receive without acting until those measures match
  engine 5. The election modifiers are not changed.

### Stage 6: default for new worlds

- Autonomy v6 becomes the default for new singleplayer and simulation worlds
  (shipped in 6.14.1). Running worlds never change level on their own. The
  live multiplayer world moved to v6 with game 1.16.

## 6.19.0 (game 1.16.0, 2026-10-15)

Stage 3 (corporations).

- **NPP-run plants shrink to the market they serve (v6).** A plant that sells
  everything it makes but is held far below its size by weak demand kept
  paying payroll and upkeep on the idle rest, because sold-out plants were
  treated as recovering. When an NPP-run plant's output stays under 60% of its
  size for 24 turns, it now retires part of the idle capacity each turn,
  keeping room to grow back by half. On live turn 202, loss-making NPP sectors
  ran at 38-46% of capacity while selling 92-100% of what they made. Player
  plants are unchanged.

## 6.18.0 (game 1.16.0, 2026-10-15)

Stage 3 (corporations).

- **R&D is never cut to zero (v6).** NPP-run companies with thin margins or
  short cash kept no R&D budget, so their technology score decayed every turn,
  their product quality fell with it, and lower sales pushed margins lower
  still. They now keep a small maintenance R&D budget, which is enough to hold
  technology near par. On live turn 199, NPP companies losing money averaged
  quality 43 against 70 for those above a 20% margin. Player companies at the
  same thin margins kept quality above 70.
- **Losing companies change course sooner (v6).** A company's strategy used
  to count as working whenever it did better than when it was adopted, so a
  company that started expanding while losing money kept expanding as long as
  it lost a little less, and was only re-judged every 48 turns. A strategy that
  still loses money no longer counts as working, and a loss-making company is
  re-judged after 8 turns. On live turn 199, 101 of the 120 loss-making NPP
  companies were still on the expand strategy.
- **Fix: a caretaker seat left empty is filled again.** A player company
  handed to a caretaker that was later marked as having no CEO stayed that
  way: the vacancy step skipped it because it was already caretaken. It now
  gets a caretaker again the next turn, and the owner's arrangement stays.

## 6.17.1 (game 1.16.0, 2026-10-15)

- **Fix: a successor takes every seat a dead NPP held (v5).** When an NPP
  dies, the NPP that replaces it now also takes its cabinet posts, its place
  as national leader, and any player company it was running as caretaker. The
  owner's caretaker arrangement stays in force. Before, those seats kept
  pointing at the dead NPP.
- **Fix: consolidation respects a party chair's slate (v6).** A trailing NPP
  is no longer withdrawn from a primary its party chair slated it to, or from
  any race the chair is managing for the party.

## 6.17.0 (game 1.16.0, 2026-10-14)

Stage 3 (corporations).

- **CEOs chosen by track record (v6).** NPPs now keep a record of how the
  companies they ran did, per industry: time in charge and the company's
  operating margin against other companies in the same country and industry.
  When an NPP-run company needs a CEO, it prefers a free NPP with a good record
  in its industry. A record counts only after half a game year and only if the
  NPP beat its peers. With no such candidate, the old rule applies. A CEO a
  player names is never overridden. The record is kept in every world, so a
  world switched to v6 already has history.
- **Fix: a dead NPP no longer stays CEO.** When an NPP dies (autonomy v5 and
  above), its NPP-run companies now get a new CEO the next turn instead of
  keeping the dead one.

## 6.16.1 (game 1.16.0, 2026-10-14)

- **Faster share buying (v6).** At v6 the NPP share-buying sweep runs each
  currency's market separately and in parallel, and reads each market's pool
  once per sweep instead of once per purchase. Tests confirm every purchase
  still balances to the cent and the result matches buying one at a time.
  Decisions are unchanged.

## 6.16.0 (game 1.16.0, 2026-10-14)

Stage 3 (corporations).

- **Investing on opportunity (v6).** NPPs used to decide whether to buy shares
  or bonds with a fixed roll before looking at the market, then picked what to
  buy. Now they look first: the better the best deal on offer (a share price
  below what the company is worth, or a bond yield above the minimum), the more
  likely they are to buy. Shares well above what the company is worth are more
  likely to be sold. Across the market the total amount of buying and selling
  stays about the same as before; it just goes where the value is.

## 6.15.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **Ministers judged on their goals (v6).** The head of an NPP government used
  to judge each minister only on how far its domains sat below target. When
  the government holds standing goals, a minister whose brief covers one is
  now judged on that goal instead.
  - A minister turning a failing domain around (at least 5 points of progress
    since the attempt began) is kept.
  - A minister in post when a goal on its brief failed, with no progress since,
    can be replaced even if the shortfall looks small.
  - A minister appointed after the failure is not blamed for it.
  - Minimum tenure, cooldowns and the limit on repeated reshuffles still apply.

## 6.14.3 (game 1.16.0, 2026-10-14)

- **Ministers save their work in batches.** NPP and caretaker ministers load
  their settings and orders once per country and save changes in single
  batched writes, instead of several database trips per minister. Applies at
  every autonomy level; decisions are unchanged.

## 6.14.2 (game 1.16.0, 2026-10-14)

- **Governments plan in parallel (v6).** At v6 the NPP governing phase runs up
  to four countries' domestic steps at once, then foreign policy one country
  at a time in the usual order, because one government's foreign moves shape
  the next. Below v6 it runs one country at a time as before. Decisions are
  unchanged.

## 6.14.1 (game 1.16.0, 2026-10-14)

- **V6 is the default for new local worlds.** New singleplayer and simulation
  worlds now start on autonomy v6, so they run every engine 6 change. Existing
  worlds keep their level, and the live multiplayer world stays on its own
  setting. The desktop client lists V6 and recommends it. No decision changes.

## 6.14.0 (game 1.16.0, 2026-10-14)

Stage 3 (corporations).

- **Voters notice self-interested votes (v6).** When an NPP's own companies
  decide its vote on a bill, it loses 1 favorability. "Decide" means it would
  have voted differently without them. This happens at most once per voting
  turn and never takes favorability below zero. Business interest is no
  longer free: an NPP that votes its holdings pays a small price with voters.

## 6.13.1 (game 1.16.0, 2026-10-14)

- **Business interests are visible (v6).** When an NPP's own companies pull
  its vote (6.8.0), the vote forecast on its profile now says so, naming
  whether the bill helps or hurts a company it runs or holds. Players and
  opponents can see the conflict. No decision changes.

## 6.13.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **Central banks defend a falling currency (v6).** Since 6.6.0 a central
  bank run by an NPP adjusts its interest rate when its currency moves, but in
  limited steps that a sharp fall can outrun. Its other tool, a trading band
  defended with the bank's reserves, was only ever used by player chairs.
  - Now, once a floating currency has fallen 15% or more over 24 turns, the
    NPP chair sets a band. Its top sits 5% above today's rate, which caps
    further weakening, and its bottom 10% below.
  - The bank defends the band with its own reserves under the usual rules, so
    it can never spend more than it holds.
  - The chair removes its own band once the currency's 24-turn move is back
    within 5%, after the normal wait between band changes.
  - A band set by a player is never touched, and government-held rates, pegs
    and shared currencies are left alone.

## 6.12.0 (game 1.16.0, 2026-10-14)

Stage 1 (running for office).

- **Racing where the party can win (v6).** Since 6.1.0 a party runs its
  strongest NPPs for its most senior races. Where the party is weak across the
  whole region, those regionwide races are the ones it cannot win, so that
  spent its best candidates on lost causes. Now a party whose organization in
  the region is below 75% of the leading party's runs its strongest NPPs in
  its most local races instead, where it can still win seats. The same races
  are contested either way.

## 6.11.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **The opposition picks its battles (v6).** The opposition's NPPs used to vote
  as a bloc against every government bill, even against a government with a
  large majority, where the bloc could defeat nothing and only stopped
  opposition members backing bills they agreed with. Now the bloc holds only
  while the government side (governing party plus coalition partners) has
  less than 55% of the lower chamber. Above that, opposition NPPs vote on each
  bill's merits, home region and donors like any other member. The pre-filing
  vote count from 6.5.0 uses the same rule.

## 6.10.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **Vote counts include the government whip (v6).** Since 6.5.0 a sponsor
  counts votes before filing, and since 6.7.0 an NPP government whips its own
  members on its goal bills. The count did not know about that whip, so it
  could set aside a goal bill the whip would have carried. The count now
  includes it, so the sponsor judges a goal bill the way it will actually be
  voted.

## 6.9.0 (game 1.16.0, 2026-10-14)

Stage 1 (running for office).

- **Career ladders (v6).** NPP incumbents used to re-file for the seat they
  held every cycle, so senior offices were filled only by NPPs without a seat.
  Now an ambitious incumbent with real standing can run for an open race for a
  more senior office in its home region instead. An open race is one with no
  candidate or defending incumbent from its party. This applies to an
  incumbent with ambition of at least 70 and political influence plus
  favorability of at least 100, holding a single seat. Its old seat is then
  filled the ordinary way. A party chair's slate assignment still takes
  precedence, and nationwide races are not part of the ladder.

## 6.8.0 (game 1.16.0, 2026-10-14)

The first stage 3 change (corporations).

- **Business interests shape votes (v6).** An NPP used to vote on a bill that
  subsidises, protects or nationalises an industry as if it owned nothing. Now
  an NPP that runs a company, or holds at least 1% of one, weighs what the bill
  does to that company's sectors.
  - It leans for subsidies and sector tariffs in its own sectors.
  - It leans against ending those subsidies, tariffs aimed at its own company,
    and nationalisation of its company or sector.
  - Running the company counts twice as much as holding shares.
  - The pull is capped below a hard party whip, so party discipline and the
    NPP's own positions still matter.
  - Players can use this: a sector bill can win over the NPPs invested in that
    sector.

## 6.7.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **Governments whip their own program (v6).** An NPP government's members
  used to back its bills only through the general lean toward their own
  party's bills. Now, when an NPP heads the government, its members get a
  soft whip on the bills the government sponsored to serve one of its standing
  goals. Each member still weighs it against their own positions, home region
  and donors, and loyal members follow it more than stubborn ones, as with any
  whip.
  - An existing whip always takes precedence.
  - It is never applied in a party with a player as chair or vice-chair.
  - It is never applied to members of other parties.

## 6.6.0 (game 1.16.0, 2026-10-14)

Stage 2 (governing).

- **Central banks answer currency moves (v6).** An autonomous central bank
  chair used to set its rate from inflation and growth alone, so a currency
  could fall sharply and the bank would not respond until the higher import
  prices showed up as inflation. Now a floating currency's move over the last
  24 turns also counts.
  - A fall of more than 5% raises the bank's target rate by 0.1 points for
    each further 1%.
  - A rise of more than 5% lowers it at half that rate.
  - The shift is capped at 3 points.
  - The bank still moves toward its target in the same limited steps, with the
    same wait between changes, and the rate history records the currency move
    as part of the reason.
  - Pegged currencies and currencies under a shared central bank are not
    affected.

## 6.5.0 (game 1.16.0, 2026-10-14)

The first stage 2 change (governing).

- **Counting votes before sponsoring (v6).** An NPP sponsor used to file its
  highest-scoring bill whether or not the chamber would pass it. Now it first
  projects the vote in the chamber the bill starts in, using the same pressures
  NPPs vote with when no whip is set: their own positions, their home region,
  their donors, the pull toward their own party's bills, and the opposition
  bloc against government bills. Player-held seats are counted as voting with
  their party. A bill that does not project more votes for than against is set
  aside and the sponsor tries its next-best bill, up to three. If none has the
  votes, it files nothing that turn and keeps its slot. Tax-rate bills, whose
  rate is set when they are filed, are not counted.

## 6.4.0 (game 1.16.0, 2026-10-14)

Stage 1 (running for office).

- **Trailing NPPs leave the primary (v6).** In the last 12 turns before a
  primary closes, an NPP whose strength (political influence plus
  favorability) is below 60% of its party's strongest candidate in that
  primary withdraws. It does not endorse anyone; NPP endorsements stay
  something players request. Incumbents defending their seat never withdraw,
  and a primary with any player candidate is never touched. A withdrawn NPP
  cannot re-file in that primary.
- **No late challengers (v6).** NPP challengers no longer enter a primary in
  those last 12 turns, so a field that has consolidated stays consolidated.

## 6.3.0 (game 1.16.0, 2026-10-14)

Stage 1 (running for office).

- **Presidential primary challengers (v6).** NPPs could already challenge a
  same-party candidate in state and legislative primaries, but presidential
  primaries were left out. Now, in countries with no players, a presidential
  primary where a party has one candidate can draw a challenger from the same
  party. The challenger is picked from the party's five strongest available
  NPPs across the country, with ambitious NPPs more likely to run. The chance of
  a challenge and the limit of two challengers per country per turn are the
  same as in other primaries. Presidential primaries in countries with players
  are not challenged.

## 6.2.0 (game 1.16.0, 2026-10-14)

Stage 1 (running for office).

- **NPP candidates rally their own race (v6).** An NPP's campaign action used
  to raise only its general political influence. NPPs have no campaign
  organisation, so their candidate Support, the race-level momentum that
  rallies move for players, stayed at the neutral 50. Now the first campaign
  action of a cycle by an NPP that is running in a race where players can
  rally becomes a rally for that race.
  - It costs the same action points and funds as the campaign action, and
    gives up that action's influence gain.
  - It moves Support by the same amount a player rally in the same kind of
    race does, with the same split between an immediate gain and a gain spread
    over the next four turns.
  - Players can rally once a turn. An NPP rallies at most once per action
    cycle, which is once every four turns.

## 6.1.0 (game 1.16.0, 2026-10-14)

The first stage 1 change (running for office).

- **Strongest candidates in the senior races (v6).** When a party fills a
  state's open primaries with NPPs, it now runs its strongest available NPPs
  for the most senior offices. Strength is the NPP's political influence plus
  favorability. The same primaries are filled as before; only who runs where
  changes. Before, NPPs were taken in load order and the lowest office was
  filled first, so the first NPP loaded ran for state senate and the last for
  governor.
- **Nationwide executive slot (v6).** A party's nationwide executive primary
  slot goes to its strongest available NPP instead of the NPP with the lowest
  id.

## 6.0.0 (game 1.16.0, 2026-10-14)

The foundation for the overhaul.

- **Autonomy tier v6.** A new tier above v5 that switches on engine 6
  behavior. It adds no activity and no resources: a v6 world allows exactly
  what a v5 world allows.
- **Engine version.** The engine now carries its own version number, recorded
  on every turn log, and this changelog lists each version.
- **Staggered action cycle (v6).** NPPs take an action cycle once every four
  turns. Below v6 they all act on the same turn, which put the whole cost on
  one turn in four (27.6 seconds on live turn 168, mostly share and bond
  buying). At v6 each NPP has a fixed lane and a quarter of NPPs act on each
  turn. Each NPP still acts once every four turns with the action points it
  built up over that time. Selling shares, building party organisations and
  founding companies stay on the shared fourth turn.

## 5.0 (game 1.7.0, 2026-09-06)

- **Persistent governing goals (autonomy v5).** A government keeps up to five
  standing goals across agenda recomputes, grades each one as achieved, revised
  or failed, and feeds the result into its next agenda. Ministers hold a
  committed tier unless it stops advancing the goal, and bill sponsorship leans
  toward bills that serve an active goal.
- **Ageing and succession (autonomy v5).** NPPs age out and are replaced by
  successors.
- **Difficulty that changes decisions.** Local-world difficulty is split into
  resources and decisions, so a resource advantage is never presented as skill.

## 4.1 (game 1.0.0, 2026-07-20)

- **Context-aware choices (autonomy v3 and v4).** NPP actions respond to
  election timing, contested seats, government status and party finances, and
  stop spending on actions that can no longer change anything.
- **Individual variation.** Personality blends continuously, each NPP has
  stable quirks, and stubborn NPPs act more decisively than flexible ones.
- **Limits on player impact.** Caps on NPP bill sponsorship in player
  countries and on primary challengers against a player, a cooldown on NPP
  corporate attacks against the same player, and a 25% share of each market's
  float that NPP bond and share buying leaves untouched.
- **Tier fixes.** Two activities that switched off when a world moved from v3
  to v4 now stay on at every higher tier.

## 0.0 to 4.0 (game 0.4.0, 2026-07-04)

The graduated autonomy ladder replaced the old on/off switch.

- **v0:** party organisation votes, and filling stalled executive seats in
  non-player countries.
- **v1:** the governing brain: agendas, cabinets, ministerial action, fiscal
  stance and opposition.
- **v2:** caretaker ministers and CEOs, corporate rivalry, and the first tier
  active in player countries.
- **v3:** campaigning, fundraising, saving, investing and founding companies,
  in non-player countries.
- **v4:** the v3 activities in every country.
