import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { computeEffectivePower } from "@/lib/constants/military";

/**
 * The national combat-power pool committable across theaters — the sum of every
 * live unit's effective power (posture × tech × veterancy × equipment).
 */
export function theaterPool(units: MilitaryUnit[]): number {
  return units.reduce((total, unit) => total + computeEffectivePower(unit), 0);
}
