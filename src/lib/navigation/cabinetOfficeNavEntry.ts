import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";

/** Minimal cabinet-member row shape from the unified `cabinetMembers`
 * collection (all countries — US Senate-confirmation and parliamentary/OPS
 * direct-appointment alike). */
export interface CabinetMemberRow {
  positionId: string;
  countryId: string;
}

export interface CabinetOfficeNavEntry {
  positionId: string;
  positionName: string;
  countryCode: string;
}

/**
 * Resolve the viewer's cabinet seat into the nav-entry shape consumed by the
 * navbar surfaces (Nation dropdown, mobile menu, state dropdown). Returns null
 * when the viewer holds no seat or the stored position id is not in the
 * country's configured position list (stale row after a config change).
 */
export function resolveCabinetOfficeNavEntry(
  member: CabinetMemberRow | null | undefined
): CabinetOfficeNavEntry | null {
  if (!member) return null;
  const position = getCabinetPositions(member.countryId).find((p) => p.id === member.positionId);
  if (!position) return null;
  return {
    positionId: member.positionId,
    positionName: position.name,
    countryCode: member.countryId.toLowerCase(),
  };
}
