/**
 * Per-lever cabinet setting cooldowns.
 *
 * Each policy control on a cabinet office (tier, regional target, envoy
 * country, aid priority) has its own 24-turn stamp. A shared lastChangedTurn
 * used to lock every control after any one of them changed, so a Health,
 * Education, and Welfare secretary who set Healthcare Model could not retarget
 * the Public Health Campaign until the cooldown expired.
 */

export const SETTING_CHANGE_COOLDOWN_TURNS = 24;

export const SETTING_COOLDOWN_FIELDS = [
  "tierSetting",
  "targetRegionId",
  "targetCountryId",
  "aidPriority",
] as const;

export type SettingCooldownField = (typeof SETTING_COOLDOWN_FIELDS)[number];

export const SETTING_COOLDOWN_STAMP = {
  tierSetting: "lastChangedTurn",
  targetRegionId: "lastRegionChangedTurn",
  targetCountryId: "lastTargetCountryChangedTurn",
  aidPriority: "lastAidPriorityChangedTurn",
} as const satisfies Record<SettingCooldownField, string>;

export type SettingCooldownStamp = (typeof SETTING_COOLDOWN_STAMP)[SettingCooldownField];

export interface SettingCooldownState {
  lastChangedTurn?: number;
  lastRegionChangedTurn?: number;
  lastTargetCountryChangedTurn?: number;
  lastAidPriorityChangedTurn?: number;
  lastAllocationChangedTurn?: number;
  allocationPercents?: Record<string, number>;
  tierSetting?: string;
}

/** $unset payload that clears every per-holder setting cooldown on seating. */
export const CABINET_SETTING_COOLDOWN_UNSET = {
  lastChangedTurn: "",
  lastAllocationChangedTurn: "",
  lastRegionChangedTurn: "",
  lastTargetCountryChangedTurn: "",
  lastAidPriorityChangedTurn: "",
} as const;

export function cooldownTurnsRemaining(
  lastChangedTurn: number | undefined,
  currentTurn: number,
  window = SETTING_CHANGE_COOLDOWN_TURNS
): number {
  if (lastChangedTurn === undefined) return 0;
  return Math.max(0, window - (currentTurn - lastChangedTurn));
}

export function requestedSettingCooldownFields(
  body: Partial<Record<SettingCooldownField, unknown>>
): SettingCooldownField[] {
  return SETTING_COOLDOWN_FIELDS.filter((field) => body[field] !== undefined);
}

function isLegacyAllocationOnlyLock(existing: SettingCooldownState | null | undefined): boolean {
  return (
    existing?.lastAllocationChangedTurn === undefined &&
    existing?.allocationPercents !== undefined &&
    existing?.tierSetting === undefined
  );
}

export function blockedSettingChange(
  existing: SettingCooldownState | null | undefined,
  fields: readonly SettingCooldownField[],
  currentTurn: number
): { field: SettingCooldownField; turnsRemaining: number } | null {
  for (const field of fields) {
    // Pre-split allocation writes stamped lastChangedTurn. Unblock the tier
    // lever when no tier was ever saved and only allocation data is present.
    if (field === "tierSetting" && isLegacyAllocationOnlyLock(existing)) continue;
    const remaining = cooldownTurnsRemaining(
      existing?.[SETTING_COOLDOWN_STAMP[field]],
      currentTurn
    );
    if (remaining > 0) return { field, turnsRemaining: remaining };
  }
  return null;
}

export function stampsForSettingChange(
  fields: readonly SettingCooldownField[],
  currentTurn: number
): Partial<Record<SettingCooldownStamp, number>> {
  const update: Partial<Record<SettingCooldownStamp, number>> = {};
  for (const field of fields) {
    update[SETTING_COOLDOWN_STAMP[field]] = currentTurn;
  }
  return update;
}
