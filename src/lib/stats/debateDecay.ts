import { DEBATE_DECAY_INTERVAL_MS, STAT_MIN } from "./statsConstants";

export interface DebateDecayResult {
  debate: number;
  anchor: Date;
}

/**
 * Apply the real-time Debate decay: −1 point per full 72h window since the
 * anchor. Clamps the stat at the floor but always advances the anchor by every
 * elapsed window, so a character sitting at the floor doesn't accumulate a
 * "debt" of decay that would crash a later raise.
 *
 * With no anchor (e.g. a freshly migrated character), the anchor is seeded to
 * `now` and no decay is applied.
 */
export function applyDebateDecay(
  debate: number,
  anchor: Date | undefined,
  now: Date
): DebateDecayResult {
  if (!anchor) {
    return { debate, anchor: now };
  }

  const elapsed = now.getTime() - anchor.getTime();
  const windows = Math.floor(elapsed / DEBATE_DECAY_INTERVAL_MS);
  if (windows <= 0) {
    return { debate, anchor };
  }

  const decayed = Math.max(STAT_MIN, debate - windows);
  const advancedAnchor = new Date(anchor.getTime() + windows * DEBATE_DECAY_INTERVAL_MS);
  return { debate: decayed, anchor: advancedAnchor };
}
