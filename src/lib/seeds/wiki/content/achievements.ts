export const achievementsContent = `# Achievements

Achievements are persistent, account-bound milestones that recognize meaningful player accomplishments across the game. They are **optional flavor**. They do not affect gameplay mechanics, but they provide long-term goals and a record of what you have done across all your characters.

## Account-bound, not character-bound

Achievements are keyed by **\`userId\`**, meaning they persist across all your characters and sessions. An achievement earned by one character is visible on your account forever.

Each achievement record may also include an optional **\`characterId\`** field that records which specific character earned it. This lets you trace which of your characters accomplished what, while keeping the achievement itself at the account level.

## Structure

Every achievement has:

| Field | Description |
| --- | --- |
| \`slug\` | Unique identifier for the achievement |
| **Rarity tier** | How rare the achievement is (e.g., common, rare, legendary) |
| \`characterId\` | (Optional) The character who earned it |
| Definition | Cached achievement metadata (title, description, icon) |

Achievement **definitions are cached**. The system loads them once and reuses the cached copy, so looking up achievement metadata is cheap and does not hit the database repeatedly.

## Triggers

Achievements are earned when **triggers fire from game events**. The game emits events as things happen (elections won, bills passed, economic milestones reached, etc.), and the achievement system checks whether any unearned achievement's trigger matches the event. If it does, the achievement is awarded.

## Non-throwing API

The achievement system is designed to be **non-disruptive**. The API **returns \`false\` on failure** rather than throwing an exception. This means:

- A failed achievement check never crashes a game action.
- Achievement failures are silent. You will not see error logs from the achievement system.
- The worst case is simply that an achievement is not awarded; gameplay continues normally.

This makes achievements a safe, low-risk system to extend or modify. A broken trigger cannot take down the game.

## Rarity tiers

Achievements are categorized by rarity tiers. Higher-tier achievements are harder to earn and more prestigious. The exact tiers and their names are defined in the achievement definitions cache.

## Viewing achievements

Achievements are visible on the player's profile and full achievement showcase page. The showcase groups every achievement by category, displays rarity and completion totals, and tracks progress toward eligible locked achievements. Each achievement shows:

- The achievement title and description
- The rarity tier
- (If applicable) which character earned it
- When it was earned

## Strategic notes

- **Achievements are flavor, not power.** Earning them does not grant mechanical bonuses. They are a record of accomplishment, not a progression system.
- **Some achievements are character-specific.** The optional \`characterId\` field means some achievements can only be earned by a specific kind of character (e.g., winning a presidential election).
- **They persist across resets.** Because they are keyed by \`userId\`, achievements survive character retirement and new character creation.

## Related systems

- **[Player Progression](/wiki/player-progression)**: How characters advance over time
- **[Endgame Goals](/wiki/endgame-goals)**: Long-term goals that may align with achievements
- **[Reading the Game](/wiki/reading-the-game)**: How to track your own progress
`;
