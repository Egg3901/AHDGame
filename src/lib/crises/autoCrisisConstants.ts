/**
 * Tuning constants for the automatic economic/political crisis triggers and the
 * shared cooldown ledger. Natural-disaster cadence lives in
 * `autoDisasterConstants.ts`; this file governs Tiers A/B/C (condition + random)
 * and the per-template disaster cooldown.
 *
 * Metric scales (confirmed against the reference seed presets):
 *   gdpGrowth / unemploymentRate / inflationRate / powerGridReliability: percent
 *   approval: 0–100. fxDepreciation: percent drop over a window.
 */

/** Default per-template cooldown when a template/config omits one. */
export const DEFAULT_CRISIS_COOLDOWN_TURNS = 144;

/** Per-template cooldown for the regional disaster pool when a template omits
 *  `disasterCooldownTurns`. Stops the same disaster type recurring in a country
 *  too soon (separate from the per-country disaster cadence). */
export const DEFAULT_DISASTER_COOLDOWN_TURNS = 144;

/** Hard cap on auto-crises (excluding regional disasters) created in one turn,
 *  so a bad metric snapshot can't spawn a pile-up across every template. */
export const MAX_AUTO_CRISES_PER_TURN = 1;

/** Deterministic [0,1) roll from (turn, templateKey, scopeKey). Used instead of
 *  Math.random() so turn processing stays reproducible and a re-run of the same
 *  turn cannot double-spawn. FNV-1a over the joined key. */
export function deterministicRoll(turn: number, templateKey: string, scopeKey: string): number {
  const str = `${turn}|${templateKey}|${scopeKey}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
}
