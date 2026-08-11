/** Metric-era profile for regional condition thresholds. */
export type ConditionPreset = "modern" | "era1991";

const ERA1991_PRESET_IDS = new Set(["1991-default"]);

/**
 * Map a game seed preset id to the condition calibration profile.
 * `modern` covers 2019-default and any future post-broadband presets.
 */
export function resolveConditionPreset(gamePreset?: string | null): ConditionPreset {
  if (gamePreset && ERA1991_PRESET_IDS.has(gamePreset)) return "era1991";
  return "modern";
}
