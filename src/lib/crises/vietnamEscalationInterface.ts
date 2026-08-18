/**
 * Small, stable interface onto the Vietnam War escalation level, so the 1960s
 * protest crises (anti-war marches especially) can scale their spawn weight
 * and severity to how deep the US commitment has gotten.
 *
 * TODO(Track A / feat/1.2-vietnam-escalation): wire the real implementation
 * in here once escalation tracking lands. Replace the body of
 * `getVietnamEscalationLevel` with a read of whatever state that branch adds
 * (troop levels, an escalation stage enum, etc.) and normalize it to the
 * 0-1 range documented below. Until then this returns a safe default of 0
 * (no escalation), so the anti-war protest template spawns at its floor
 * weight rather than erroring or over-firing.
 */

/**
 * Current Vietnam War escalation, normalized to 0 (no US involvement) through
 * 1 (peak commitment, e.g. Tet-era troop levels). Callers should treat this as
 * a continuous dial, not a stage index.
 */
export function getVietnamEscalationLevel(): number {
  return 0;
}
