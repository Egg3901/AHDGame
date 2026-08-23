export const crisisInteractionContent = `# Crisis Interaction

The **Crisis Interaction** system is an optional gameplay layer that adds template-based crisis creation, decision trees, collective contributions, and ambient interaction cards. The system is gated behind a feature flag. When disabled, only the legacy manual crisis creator is available.

## Feature flags

Two independent settings control the crisis system. Admins turn each one on or off separately:

| Setting | What it does | When off | When on |
| --- | --- | --- | --- |
| Crisis interaction toggle | Gates template-based creation, decision trees, collective contributions, and ambient interaction cards | Only the legacy manual crisis creator is available; the admin panel hides the template-based tools | Template-based creation, decision trees, and interaction cards are available |
| Auto-disaster toggle | Gates the auto-disaster spawner | No automatic disaster spawning | The auto-disaster spawner runs on its schedule |

The two settings are independent: you can have template-based crisis creation without auto-disasters, or vice versa.

## Template-based crisis creation

When crisis interaction is turned on, admins and players can create crises from **pre-defined templates** rather than crafting each crisis manually. Templates cover realistic scenarios:

- Economic shocks (recessions, inflation spikes, currency crises)
- Natural disasters (earthquakes, hurricanes, pandemics)
- Political crises (scandals, government shutdowns, diplomatic rows)
- Sector-specific disruptions (energy shocks, supply-chain breaks)

Each template defines:

| Part | Description |
| --- | --- |
| Effects | Flat or tick effects on state metrics (GDP, unemployment, inflation, etc.) |
| Duration | How long the crisis lasts, either as a flat number of turns or set per scope |
| Interaction setup | Optional decision tree, collective contribution setup, and auto-resolve behavior |

When the setting is off, the admin panel shows **only the legacy manual crisis creator**, a freeform tool with no template guidance, no decision trees, and no interaction cards.

## Decision trees

A decision tree is a branching narrative attached to a crisis. When a crisis with an interaction setup is activated, the game creates an interaction record to track it:

1. The first node in the tree becomes the active node.
2. Players (or admins) select an option from the current node.
3. The selected option may advance to the next node, debit the treasury for a collective contribution, or end the tree.
4. If auto-resolve is turned on for that crisis, the interaction resolves automatically once the crisis expires.

### Collective contributions

Some decision-tree options require a **collective contribution**: a treasury debit that funds a collective response to the crisis. The game checks the treasury balance before applying the contribution. If the treasury doesn't have enough funds, the option is blocked and the player sees a message showing how much is needed versus how much is available. Otherwise, the treasury is debited and the amount is added to the crisis's running total.

This means crisis response has a real fiscal cost: choosing the "full response" option may drain the treasury, forcing tradeoffs with other spending priorities.

## Ambient interaction cards

When crisis interaction is enabled, the **actions page renders ambient interaction cards** for active crises with interaction setups. These cards surface the current decision-tree node to the player and let them choose an option without navigating to a separate crisis page.

When the setting is off, the actions page does **not** render interaction cards. Active crises are visible only through the legacy crisis management interface.

## Auto-disaster spawner

The auto-disaster setting gates a separate subsystem: the **auto-disaster spawner**. When enabled, the spawner automatically creates disaster crises on a schedule, using the same template system as manual template-based creation.

| Setting | Behavior |
| --- | --- |
| Off | No automatic disasters, only manually created crises occur |
| On | Auto-disaster spawner runs on its schedule, creating disaster crises from templates |

Auto-disasters use the same template definitions as manual template-based creation, so the decision trees, effects, and durations are consistent. The only difference is the trigger: manual (admin or player action) versus automatic (the spawner's schedule).

## Legacy manual crisis creator

When crisis interaction is **off**, the only crisis creation path is the **legacy manual crisis creator**, a freeform tool that lets admins define effects, duration, and scope without a template. This path has:

- No decision trees
- No collective contributions
- No interaction cards
- No template guidance

The legacy creator is always available regardless of the flag state. The flag only gates the richer template-based system on top.

## Chained and multi-country crises

Release 1.3 moves authored international chains onto the persistent Global Response campaign engine. See [Global Response Crises](/wiki/global-response-crises) for campaign stages, country memory, capacity requirements, consequence tracks, global tension, and nuclear buildup.

Some historical crisis families continue across several decisions instead of ending after one node. A chain records its family and current stage, so later crises can advance, hold, or reduce the same shared situation.

Vietnam is the first full chained family. Between 1955 and 1975 it can progress from advisors through materiel support, a naval incident, an air campaign, a ground commitment, and a prolonged war. The United States and Soviet Union receive separate country-scoped decisions. One government's response does not close the other government's decision.

Each opening Vietnam decision has a 24 hour real-time deadline. If a government does not respond, the cautious first option holds its current commitment. Increasing support spends treasury funds and moves Cold War readiness, bloc cohesion, war weariness, and procurement demand. Pulling back reduces committed support before it lowers the shared stage.

At the air-campaign stage, the chain opens a real North Vietnam versus South Vietnam conflict. The superpowers remain patrons rather than direct belligerents. Dropping below that stage winds the front down; reaching level zero ends it without allowing the same chain to restart.

The active stage and decisions are visible from the Conflicts and Crises pages. Openings and stage changes also publish through the in-game news and wire plus the configured Discord news and national channels.

## Strategic implications

| Decision | Impact |
| --- | --- |
| Crisis interaction off | Crises are simple shocks: apply effects, wait them out. No player choices during the crisis. |
| Crisis interaction on | Crises become interactive: players face decision trees with fiscal tradeoffs, collective contributions, and branching outcomes. |
| Auto-disasters off | Crises only occur when someone manually creates them. |
| Auto-disasters on | Disasters occur on a schedule, forcing governments to maintain readiness even without active adversaries. |

The flags are game-admin decisions, not per-player choices. Once on, they apply to all crises in the game.

## Related systems

- **[RPG Stats & Debates](/wiki/rpg-stats)**: separate feature flag, independent of crisis interaction
- **[Player Random Events](/wiki/player-events)**: separate feature flag, independent of crisis interaction
- **[International Trade](/wiki/trade-system)**: crises can affect trade affinity and tariffs
- **[Core Systems](/wiki/core-systems)**: turn structure, action economy
`;
