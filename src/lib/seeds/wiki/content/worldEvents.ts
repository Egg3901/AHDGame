export const worldEventsContent = `# World Events

World events are scheduled, country-scope offers the turn processor makes to a head of government. They are on by default. They are not player-vs-player mail and not the random personal events on your own character.

## How an offer works

Each turn the scheduler walks active countries:

- A country that already has a pending world-event instance is skipped.
- At most **one new offer per country per turn**.
- The offer goes to that country's head of government (President, PM, Chancellor, or equivalent).

If you are not the executive, you will see the outcome in [News](/wiki/news) or country state, not as a personal decision card.

Admin-triggered events still count against the one-pending-per-country cap.

## Global host events

Two flavor events pick a **host country** on a fixed cadence instead of rolling every country:

| Event | Cadence | Offset |
| --- | --- | --- |
| Olympics | every 48 turns | 12 |
| World's Fair | every 36 turns | 30 |

The host is chosen deterministically from the current turn. If that country already has a pending event, the offer is skipped until the next cadence. There is no bidding and no escrow.

## Conflicts

A world event can start a conflict. The map still begins with **no pre-seeded wars**; every war on the board was started by a player declaration or a world event. See [Conflicts Overview](/wiki/conflicts-overview).

## Related

Player-personal random events are a different driver. See [Player Random Events](/wiki/player-events). Crisis trees are [Crisis Interaction](/wiki/crisis-interaction).
`;
