import type { LivingConflictDef } from "./types";
import { VIETNAM_DEF } from "./defs/vietnam";
import { PANDEMIC_DEF } from "./defs/pandemic";
import {
  BERLIN_DEF,
  CONGO_DEF,
  NUCLEAR_INCIDENT_DEF,
  OIL_DISRUPTION_DEF,
  SUEZ_AFTERMATH_DEF,
} from "./defs/globalResponseCatalog";

/** Every living-conflict definition, keyed by its stable def key. */
export const LIVING_CONFLICT_DEFS: Record<string, LivingConflictDef> = {
  [VIETNAM_DEF.key]: VIETNAM_DEF,
  [PANDEMIC_DEF.key]: PANDEMIC_DEF,
  [BERLIN_DEF.key]: BERLIN_DEF,
  [CONGO_DEF.key]: CONGO_DEF,
  [SUEZ_AFTERMATH_DEF.key]: SUEZ_AFTERMATH_DEF,
  [OIL_DISRUPTION_DEF.key]: OIL_DISRUPTION_DEF,
  [NUCLEAR_INCIDENT_DEF.key]: NUCLEAR_INCIDENT_DEF,
};

export function livingConflictDef(key: string): LivingConflictDef | null {
  return LIVING_CONFLICT_DEFS[key] ?? null;
}

export function allLivingConflictDefs(): LivingConflictDef[] {
  return Object.values(LIVING_CONFLICT_DEFS);
}
