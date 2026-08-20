import type { LivingConflictDef } from "./types";
import { VIETNAM_DEF } from "./defs/vietnam";
import { PANDEMIC_DEF } from "./defs/pandemic";

/** Every living-conflict definition, keyed by its stable def key. */
export const LIVING_CONFLICT_DEFS: Record<string, LivingConflictDef> = {
  [VIETNAM_DEF.key]: VIETNAM_DEF,
  [PANDEMIC_DEF.key]: PANDEMIC_DEF,
};

export function livingConflictDef(key: string): LivingConflictDef | null {
  return LIVING_CONFLICT_DEFS[key] ?? null;
}

export function allLivingConflictDefs(): LivingConflictDef[] {
  return Object.values(LIVING_CONFLICT_DEFS);
}
