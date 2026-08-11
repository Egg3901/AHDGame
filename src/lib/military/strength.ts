import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { getUnitArchetype } from "@/lib/constants/military";

/**
 * The loose shape both the domain model (`MilitaryUnit`, `domain: UnitDomain`) and the
 * cabinet DTO (`MilitaryUnitView`, `domain: string`) satisfy. An unrecognised domain
 * simply finds no archetype and falls through the null path below.
 */
interface StrengthInput {
  domain: string;
  type: string;
  personnel: number;
}

/**
 * A unit's strength against its archetype establishment, for display. Personnel scales
 * combat power linearly, so a hollow formation must be visible at a glance.
 *
 * Null for an unknown archetype — the power model treats that as "assume full strength",
 * so the UI shows the raw headcount rather than a fabricated ratio.
 */
export function strengthOf(
  unit: StrengthInput
): { personnel: number; establishment: number; ratio: number } | null {
  const establishment = getUnitArchetype(unit.domain as UnitDomain, unit.type)?.personnel;
  if (!establishment || establishment <= 0) return null;
  return {
    personnel: unit.personnel,
    establishment,
    ratio: Math.max(0, Math.min(1, unit.personnel / establishment)),
  };
}

/** Strength as a rounded percentage, or null when the archetype is unknown. */
export function strengthPct(unit: StrengthInput): number | null {
  const s = strengthOf(unit);
  return s ? Math.round(s.ratio * 100) : null;
}
