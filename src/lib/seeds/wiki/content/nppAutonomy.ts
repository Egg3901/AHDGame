export const nppAutonomyContent = `# NPP Autonomy

**NPP autonomy** is the graduated system that makes Non-Player Politicians act more like full political actors: sponsoring bills, forming governments, staffing ministries, and running campaigns without waiting for player nudges. It replaces the old binary on/off flag with levels **off → v0 → v1 → v2 → v3 → v4 → v5 → v6**. The game's seeded default is **v4**.

The level says which activities NPPs may perform in a world. How the shipped code performs them is the **NPP engine version**, recorded with every change in the [NPP changelog](/changelog/npp) along with the roadmap.

For baseline NPP behavior (bill cross-pressure, elections, influence actions), see [NPPs Overview](/wiki/npps-overview), [NPP Behavior](/wiki/npp-behavior), and [NPP Elections](/wiki/npp-elections).

## Autonomy levels

| Level | What NPPs gain |
| --- | --- |
| **off** | Legacy behavior only: reactive cross-pressure voting and elections |
| **v0** | Autonomous party organization votes; fills stalled executive seats in non-player countries (central bank chair, stalled prime minister) |
| **v1** | Autonomous bill sponsorship and voting, executive formation, ministerial governance, and governing agendas: NPP-led cabinets behave coherently |
| **v2** | **Comingle tier**: caretaker ministers, caretaker CEOs for vacant corporations, and NPP corporate attacks. Also the floor at which autonomy acts at all in player-enabled countries |
| **v3** | Economic and financial autonomy (savings, union bargaining, campaign finance) plus NPP entry into presidential primaries as challengers |
| **v4** | Widest reach (the seeded default): global-scope economic actions and deeper autonomous bill sponsorship |
| **v5** | Persistent governing goals: a government keeps up to five standing goals, grades them, and lets the results steer its next agenda. Singleplayer and worldsim beta |
| **v6** | NPP engine 6: the same activities and resources as v5, with the engine 6 decision and cost changes listed in the NPP changelog. Default for new singleplayer and simulation worlds |

Levels are cumulative: v2 includes everything in v0 and v1, and v6 includes everything below it.

## Player vs non-player countries

Autonomy applies differently by country type:

- **Non-player countries**: the configured global level applies as-is (v0 to v6).
- **Player-enabled countries**: autonomy **only activates at v2 and above** (the comingle tiers). Below v2 it resolves to off, so humans stay primary in countries people actually play.

This rail prevents autonomous NPP governments from overriding player-led countries until admins enable the comingle tiers.

## What changes at each tier

### v0: seating and org votes

- NPPs cast autonomous party organization votes.
- Stalled executive seats in non-player countries get filled (central bank chair, stalled prime minister).

### v1: legislation and government formation

- NPPs autonomously sponsor and vote on bills aligned with party and agenda pressure.
- NPP prime ministers and presidents form cabinets from their party bench.
- **Ministerial governance**: portfolio holders pursue agenda-aligned actions.
- **Governing agendas**: coherent policy programs replace one-off bill spam.

### v2: comingle

- **Caretaker ministers and CEOs**: NPPs staff vacant ministries and NPP-run corporations where no player holds the seat. Under a full-flags world they also set wages, sign same-country supply agreements, prospect short deposits, and park idle treasury in high-coupon bonds.
- NPP corporate attacks against rival firms.
- This is the floor at which any autonomy runs in player-enabled countries.

### v3: economic and financial depth

- NPP savings, union bargaining, and campaign finance loops run like player accounts.
- NPPs enter presidential primaries as challengers, in autonomy-active countries that are not player-enabled.

### v4: widest reach (seeded default)

- Economic actions extend to global scope.
- Deeper autonomous bill sponsorship.

### v5: persistent goals (beta)

- A government holds a bounded set of standing goals across agenda recomputes instead of starting over each time.
- Each goal is graded as achieved, revised or failed. Failed domains lose weight in the next agenda; domains showing progress keep it.
- Ministers hold a committed tier unless it stops advancing the goal. Bill sponsorship leans toward bills that serve an active goal.
- NPPs age, retire and are replaced by successors.
- Adds no new lever and no resources. Validated in singleplayer and worldsim, not yet in live multiplayer.

### v6: NPP engine 6

- Changes how well NPPs pursue the v5 activities and what they cost to run each turn, never what they may do or how much money and action points they receive.
- Includes better candidate placement and career moves, rallies in their own races, vote counting before sponsoring, government whips on goal bills, an opposition that picks its battles, central banks that answer and defend currency moves, and votes shaped by business interests, which voters can see and mark down.
- New singleplayer and simulation worlds start on v6, and the live multiplayer world has also moved to v6. Other existing worlds keep the level they were set to.
- Every engine version and the planned ones are listed in the [NPP changelog](/changelog/npp).

## Admin controls

Admins advance autonomy globally:

- \`POST /api/admin/npp-autonomy/toggle\`: master on/off (legacy entry point; sets v0 when enabled).
- Per-country overrides on the feature-gates route set effective level where supported.

Advance levels gradually: each tier adds CPU work and changes political equilibrium.

## Related

- [NPPs Overview](/wiki/npps-overview): What NPPs are and why they matter
- [NPP Behavior](/wiki/npp-behavior): Cross-pressure bill voting (always active)
- [NPP Elections](/wiki/npp-elections): Primary and general entry rules
- [Government Formation](/wiki/government-formation): Parliamentary executive seating
- [Voting & Whips](/wiki/voting-and-whips): Whip directives vs autonomous votes
`;
