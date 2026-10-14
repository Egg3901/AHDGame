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

## Contest achievements and career rankings

[Contests](/contests) has two main tabs: **Contests** and **All time leaderboard**. The Contests tab contains this week's races and your historical results. The All time leaderboard tab contains career rankings and contest champions. Finished results keep the names and scores recorded at settlement. Your personal record follows your account across characters and iterations, including rounds where you did not win. Cash totals count paid prizes; Supporter awards are separate.

Contest achievements come from settled awarded placings:

| Achievement | Requirement |
| --- | --- |
| On the Podium | Earn an awarded contest placing |
| First Across the Line | Win your first contest |
| Returning Champion | Win three rounds |
| Three in a Row | Win three consecutive weekly rounds of the same contest in one iteration |
| All-Round Champion | Win three different contest categories |
| Champion Through the Ages | Win in two different iterations |

Career rankings give politics, business, enacted legislation, contest performance and earned gameplay achievements up to 1,000 points each. Influence, legislation, contests and achievements have diminishing returns. Only offices actually held count. Business includes all cash and savings currency pockets, shares, bonds and funds, less outstanding personal loans. Borrowing cash or moving it between currency accounts creates no business credit. Drafts, failed bills, staff law overrides, special achievements, paid perks and manual achievement grants earn no points. Infamy subtracts up to 500 points; the total cannot fall below zero.

The ranking uses your strongest political and business career, adds enacted laws and contest wins across all your characters, and counts account achievements once. Retiring extra characters does not add their scores together. Your display identity defaults to your current character, or the latest retired character when none is active. You may choose a different recorded character; the ranking also names the career supplying the score. New retirement snapshots save enacted laws and converted balances before a world reset clears them. Historical information that was already erased cannot be reconstructed.

## Strategic notes

- **Achievements are flavor, not power.** Earning them does not grant mechanical bonuses. They are a record of accomplishment, not a progression system.
- **Some achievements are character-specific.** The optional \`characterId\` field means some achievements can only be earned by a specific kind of character (e.g., winning a presidential election).
- **They persist across resets.** Because they are keyed by \`userId\`, achievements survive character retirement and new character creation.

## Related systems

- **[Player Progression](/wiki/player-progression)**: How characters advance over time
- **[Endgame Goals](/wiki/endgame-goals)**: Long-term goals that may align with achievements
- **[Reading the Game](/wiki/reading-the-game)**: How to track your own progress
`;
