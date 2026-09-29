import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import type { UnionEnforcementPosture } from "./underground";

/** Crackdown administration consumes 0.1% of annual GDP, charged each turn. */
export const CRACKDOWN_ANNUAL_GDP_SHARE = 0.001;

export function enforcementTreasuryCostPerTurn(
  gdp: number,
  banned: boolean,
  posture: UnionEnforcementPosture | undefined
): number {
  if (!banned || posture !== "crackdown" || !Number.isFinite(gdp) || gdp <= 0) return 0;
  return Math.round((gdp * CRACKDOWN_ANNUAL_GDP_SHARE) / TURNS_PER_YEAR);
}

/** Recomputed each approval snapshot, so repeal or a posture change removes the penalty. */
export function enforcementApprovalModifier(
  banned: boolean,
  posture: UnionEnforcementPosture | undefined
): ActiveModifier | null {
  if (!banned || posture !== "crackdown") return null;
  return { id: "union_crackdown", label: "Union crackdown", effect: -2 };
}

/** Public sector signal, with no exact cell strength or heat disclosed. */
export function undergroundUnrestVisible(banned: boolean, strength: number | undefined): boolean {
  return banned && typeof strength === "number" && Number.isFinite(strength) && strength >= 20;
}
