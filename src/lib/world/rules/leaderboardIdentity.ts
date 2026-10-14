/** One display identity per account, independent of whichever career supplies its score. */
export function leaderboardDisplayCharacterId(
  lives: readonly { characterId: string; isActive: boolean; retiredAtMs: number | null }[],
  preference: string | null
): string | null {
  const selected =
    preference && preference !== "current"
      ? lives.find((life) => life.characterId === preference)
      : undefined;
  if (selected) return selected.characterId;
  return (
    lives.reduce<(typeof lives)[number] | null>((latest, life) => {
      if (!latest) return life;
      if (life.isActive !== latest.isActive) return life.isActive ? life : latest;
      const delta = (life.retiredAtMs ?? 0) - (latest.retiredAtMs ?? 0);
      return delta > 0 || (delta === 0 && life.characterId > latest.characterId) ? life : latest;
    }, null)?.characterId ?? null
  );
}
