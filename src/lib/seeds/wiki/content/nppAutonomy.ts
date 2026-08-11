export const nppAutonomyContent = `# NPP Autonomy

**NPP autonomy** is the graduated system that makes Non-Player Politicians act more like full political actors: sponsoring bills, forming governments, staffing ministries, and running campaigns without waiting for player nudges. It replaces the old binary on/off flag with levels **off → v0 → v1 → v2 → v3**.

For baseline NPP behavior (bill cross-pressure, elections, influence actions), see [NPPs Overview](/wiki/npps-overview), [NPP Behavior](/wiki/npp-behavior), and [NPP Elections](/wiki/npp-elections).

## Autonomy levels

| Level | What NPPs gain |
| --- | --- |
| **off** | Legacy behavior only: reactive voting and elections |
| **v0** | Smarter bill sponsorship and voting patterns; fills stalled non-player countries (central-bank chair, PM gaps) |
| **v1** | Executive formation, ministerial governance, governing agendas: NPP-led cabinets start behaving coherently |
| **v2** | **Comingle tier for player countries**: caretaker ministers, deeper executive/campaign autonomy where players and NPPs share a country |
| **v3** | Full economic autonomy for NPP actors (savings, campaign finance depth, expanded decision loops) |

Levels are cumulative: v2 includes everything in v0 and v1.

## Player vs non-player countries

Autonomy applies differently by country type:

- **Non-player countries**: the configured global level applies as-is (v0/v1/v2/v3).
- **Player-enabled countries**: autonomy **only activates at v2 and above** (the "comingle" tiers). Below v2, player countries stay on manual NPP behavior so humans remain primary.

This rail prevents autonomous NPP governments from overriding player-led countries until admins explicitly enable comingle tiers.

## What changes at each tier

### v0: legislative smarts

- NPPs sponsor and advance bills aligned with party/agenda pressure.
- Stalled executive seats in NPC-only countries get filled (central bank chair, prime minister, etc.).

### v1: government formation

- NPP prime ministers/presidents form cabinets from their party bench.
- **Ministerial governance**: portfolio holders pursue agenda-aligned actions.
- **Governing agendas**: coherent policy programs replace one-off bill spam.

### v2: comingle (player countries)

- **Caretaker CEOs**: NPP-run corporations where no player holds the CEO seat (when enabled).
- Expanded ministerial and campaign autonomy alongside player characters.

### v3: economic depth

- NPP **savings and finance** loops accrue like player accounts.
- Richer campaign/economy decision-making for autonomous politicians.

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
