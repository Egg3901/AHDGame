export const playerEventsContent = `# Player random events

The Player Random Events (PREE) system is an optional gameplay layer that offers event-driven choices to players each turn. The system is gated behind a single admin setting: when it's off, no new events are offered, but events already in progress still expire and resolve normally.

## Feature flag

Admins can turn PREE on or off for the whole game at any time. When it's off, no new events are offered, but any events already pending continue to exist until they expire or are resolved. When it's on, the per-turn driver offers one event to every eligible character.

## Per-turn driver

Each turn, the system runs through the full event-offer cycle:

1. Resolve any pending event that has passed its deadline, notifying the owning player.
2. Check whether PREE is turned on. If not, the turn stops here.
3. If debate stats are enabled, process election debates first: roll debate challenges and resolve any overdue debates before offering normal events. A character locked into a debate this turn is excluded from the normal event offer, since debates take priority.
4. Load all approved event templates.
5. Go through every player character in batches. For each one:
   - Skip if they already have a pending event.
   - Skip if they're on cooldown, either from a recent event of the same kind or from any event at all.
   - Narrow down the eligible templates based on who the character is.
   - Roll a weighted pick among the eligible templates.
   - Offer the event and notify the player.

The system tracks how many events were swept, offered, and skipped each turn.

## Eligibility checks

Not every character receives every event. Each character is classified at offer time:

| Trait | What it means |
| --- | --- |
| Politician | The character holds office or is running in an active election |
| CEO | The character runs a corporation |
| In an election | The character has an active candidacy |

### Eligibility tags

Each event declares who it's for:

- "Everyone" events go to any character.
- "Politician" events only go to officeholders and active candidates.
- "CEO" events only go to characters running a corporation.
- "In an election" events only go to characters with an active candidacy.

So a CEO-only event only ever reaches someone running a corporation, and a politician-only event only ever reaches officeholders and candidates.

## Cooldowns

Each character has a cooldown clock that governs when they're next eligible for an event offer:

| Cooldown | Scope | Effect |
| --- | --- | --- |
| Global | Per character | Blocks all event offers until it expires |
| Per kind | Per character, per event type | Blocks offers of that specific event type until it expires |

Cooldowns are checked before eligibility. A character on global cooldown gets no offers no matter how many eligible events exist.

## Event definitions and handlers

Each event type has two parts: the display copy and eligibility rules, which admins approve before an event can be offered, and the outcome logic that decides what actually happens once a player picks an option. A test suite checks that every event's copy and its outcome logic stay in sync.

### Era gating

Every event can optionally declare an earliest and/or latest in-game year it's allowed to fire. This keeps anachronistic events out of early eras (no "your campaign went viral" in 1953) and powers two content families:

- Decade events, which only fire within their own decade (1950s through 1990s), in any preset, as the world plays through the years.
- Era-flavored country events (US/UK/RU/DD era packs), like coronation street parties only in 1953 UK, or Trabant deliveries in the DDR.

Admin manual triggers bypass the year gate on purpose, as a testing escape hatch. Only the automatic per-turn offer and the world-events scheduler enforce it.

### Broadcast events (shared historic moments)

Some events are shared historic moments delivered to every eligible character at once, either across the whole game or within a single country, tied to a specific year window: the moon landing, the Kennedy assassination, the fall of the Berlin Wall, the Chernobyl disaster, and the turn of the millennium.

- Each broadcast fires at most once per world, and at most one broadcast fires per turn.
- Broadcast events never enter the normal random pool; they're delivered on their own schedule.
- A broadcast bypasses the normal spacing cooldown and takes priority over any pending event: the pending event auto-resolves on its default option (the same as if it had timed out) so the historic moment always lands.

### Example event kinds

| Kind | Who gets it | Description |
| --- | --- | --- |
| Lottery win | Everyone | A windfall event: lottery annuity paid out over time |
| Staffer scandal | Politicians | A staffer's scandal damages the politician's reputation |
| Campaign viral | Politicians | A campaign moment goes viral, boosting favorability |
| Corrupt donor | Politicians | A donor offers tainted money, accept or refuse |
| CEO whistleblower | CEOs | A whistleblower threatens a corporation |
| Tax audit | CEOs | A tax audit targets a corporation |
| Old friend venture | Everyone | An old friend pitches a business venture |
| Memoir offer | Politicians | A publisher offers a memoir deal |

Each event presents the player with a choice (typically 2 to 4 options) and resolves with an outcome drawn at random, weighted by the option chosen.

## Active event tracking

A character can have at most one pending event at a time. The system checks for an existing pending event before offering a new one; if there's already one waiting, the character is skipped.

This prevents event spam: a character who hasn't resolved their current event won't receive another until they do. If the event expires before the player responds, it auto-resolves (typically with a default or negative outcome) and the character becomes eligible again on the next cooldown cycle.

## Integration with RPG stats

The random events system works alongside the [RPG Stats](/wiki/rpg-stats) system. When both are enabled:

1. The system checks whether RPG stats are turned on at the start of the turn.
2. If so, it processes election debates before offering normal events.
3. A character locked into a debate this turn is excluded from the standard event offer, since debates take priority.
4. If RPG stats are off, the debate step is skipped and all eligible characters receive normal event offers.

This means debates and random events share the same "one event per character per turn" slot.

## Strategic implications

| Setting | Impact |
| --- | --- |
| Off | No random events; characters only experience crises and election cycles. Predictable, less dynamic. |
| On | Characters face periodic choices with real consequences: windfalls, scandals, opportunities. Adds texture and unpredictability to the game loop. |

This is a game-admin setting, not a per-player choice. Once it's on, it applies to every player character in the game.

## Related systems

- **[Random Events browser](/wiki/random-events)**: browse approved player-event templates and their eligibility.
- **[RPG Stats & Debates](/wiki/rpg-stats)**: debates take priority over normal random events when both are on.
- **[Crisis Interaction](/wiki/crisis-interaction)**: a separate setting, independent of this system.
- **[World Events](/wiki/world-events)**: scheduled and broadcast historical events that affect the wider simulation.
- **[Core Systems](/wiki/core-systems)**: turn structure, action economy.
`;
