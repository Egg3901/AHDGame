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

- **Race choice by chance of winning.** NPPs file where their home approval,
  party strength and incumbency give them a real chance, instead of filling the
  first open primary in a fixed office order. (Placing the strongest NPPs in the
  senior races shipped in 6.1.0.)
- **Campaigning tied to a race.** Campaign and advertising actions spend on the
  race the NPP is running in, weighted toward close races, instead of raising
  general influence and favorability. (Rallies in the NPP's own race shipped in
  6.2.0.)
- **Consolidation.** A trailing NPP withdraws before the primary and endorses
  the same-party front-runner rather than splitting the vote.
- **Presidential challengers** in non-player countries, inside the existing
  limit on how often a player's race can be challenged. (Shipped in 6.3.0.)

### Stage 2: governing

- **Bills that can pass.** Before sponsoring, an NPP counts likely votes from
  party, whips and caucuses, and does not introduce a bill that is short.
- **Whipping its own program.** A governing party whips co-partisans on the
  bills that serve its standing goals. Opposition coordinates against a bill
  only when it has the votes to defeat it.
- **Cabinet by fit.** Cabinet posts go to NPPs whose positions and record fit
  the brief, and a minister failing a standing goal is replaced.
- **Fewer writes.** Ministerial orders and settings are written in batches
  per country.

### Stage 3: corporations

- **Investing on value.** NPP share and bond purchases compare price with
  fundamentals and sell on the same test, instead of fixed-probability rolls.
- **CEO choice by record.** NPP-run companies choose CEOs from NPPs with a
  track record running companies in the same sector.
- **Consequences across politics and business.** NPP officeholders who hold or
  run companies weigh those holdings in votes and sponsorship, and opponents and
  voters can see and react to the conflict.
- **Batched purchases.** The share-buying sweep is the largest single NPP cost
  in a turn (18.0 seconds and 1,465 database round trips on live turn 168); it
  moves to one batched settlement per country.

### Stage 4: cost

- NPP governing passes run countries in bounded parallel lanes instead of one
  after another.
- Every engine 6 phase gets a per-turn round-trip budget, reported with the
  turn.

### Stage 5: strength accounting

- Compare v5 and v6 worlds on NPP win rate against players, NPP wealth, and
  returns on NPP-run companies.
- Step down the income NPPs receive without acting until those measures match
  engine 5. The election modifiers are not changed.

### Engine 7: default

- Autonomy v6 becomes the default for new singleplayer and simulation worlds,
  after the engine 6 stages are validated. Running worlds never change level on
  their own.

## 6.3.0 (unreleased)

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

## 6.2.0 (unreleased)

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

## 6.1.0 (unreleased)

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

## 6.0.0 (unreleased)

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
