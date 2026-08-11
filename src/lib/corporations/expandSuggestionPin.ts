/**
 * Keep the deep-linked state visible in the expand-modal top-N even when it
 * is not among the highest-ranked markets. "Build here" from Maryland Defense
 * must still surface Maryland — not silently fall back to California.
 */
export function pinStateInTopSuggestions<T extends { stateId: string }>(
  ranked: T[],
  pinStateId: string | null | undefined,
  limit = 5
): T[] {
  if (!pinStateId) return ranked.slice(0, limit);
  const pinned = ranked.find((s) => s.stateId === pinStateId);
  if (!pinned) return ranked.slice(0, limit);
  const rest = ranked.filter((s) => s.stateId !== pinStateId).slice(0, Math.max(0, limit - 1));
  return [pinned, ...rest];
}
