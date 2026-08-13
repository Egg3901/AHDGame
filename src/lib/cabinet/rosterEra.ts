/**
 * Cabinet roster era resolution — pure functions, no DB.
 *
 * A seat is active for `yearEnabled <= year < yearRetired`. `year === null`
 * means era-awareness is unavailable (resolveGameYear null contract): the full
 * roster with canonical names is returned — exactly the pre-gating behavior.
 */
import type { CabinetPositionDef } from "@/lib/constants/cabinetMechanics";
import type { CabinetPositionMechanics } from "@/lib/constants/cabinetMechanicsTypes";

/** Sentinel "always existed" year (predates the ERA_DOMAIN, never filters). */
export const PERPETUAL_YEAR = 1775;

export function isSeatActive(
  position: CabinetPositionDef,
  year: number | null,
  /** Seats forced active by legislation (gameState.manuallyEnabledSeats). */
  enabledSeats?: ReadonlySet<string>
): boolean {
  // A create_department bill brings a seat into existence regardless of its era.
  if (enabledSeats?.has(position.id)) return true;
  if (year === null) return true;
  if (year < (position.yearEnabled ?? PERPETUAL_YEAR)) return false;
  if (position.yearRetired !== undefined && year >= position.yearRetired) return false;
  return true;
}

function resolveBands(
  canonical: string,
  bands: ReadonlyArray<{ from: number; name: string }> | undefined,
  year: number | null
): string {
  if (year === null || !bands?.length) return canonical;
  let resolved = canonical;
  for (const band of bands) {
    if (band.from <= year) resolved = band.name;
  }
  return resolved;
}

export function resolveSeatName(
  position: CabinetPositionDef,
  year: number | null,
  enabledSeats?: ReadonlySet<string>
): string {
  // Legislation-driven rename (e.g. HEW -> HHS once Education is split off)
  // takes precedence over the year bands.
  const split = position.renameOnDepartmentSplit;
  if (split && enabledSeats?.has(split.whenSeatEnabled)) return split.name;
  return resolveBands(position.name, position.namesByYear, year);
}

export function resolveDepartment(
  mechanics: CabinetPositionMechanics,
  year: number | null
): string {
  return resolveBands(mechanics.department, mechanics.departmentByYear, year);
}

/** Active seats with year-correct names substituted; original array order kept. */
export function resolveCabinetRoster(
  positions: ReadonlyArray<CabinetPositionDef>,
  year: number | null,
  enabledSeats?: ReadonlySet<string>
): CabinetPositionDef[] {
  return positions
    .filter((position) => isSeatActive(position, year, enabledSeats))
    .map((position) => ({ ...position, name: resolveSeatName(position, year, enabledSeats) }));
}
