import { NATIONAL_DOCTRINE_EFFECTS, MISSING_SYNERGY } from "./config";

// Thin doctrine surface for the command detail panel. The full national-doctrine
// tree (doctrineData.js) lands with the Secretary of Defense Office slice; this
// slice only reflects the active effects + missing-synergy hint.

export function nationalDoctrineEffects(): { val: string; label: string }[] {
  return NATIONAL_DOCTRINE_EFFECTS;
}

export function missingSynergy(): string {
  return MISSING_SYNERGY;
}
