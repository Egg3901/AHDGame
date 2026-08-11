/**
 * Eastern-bloc Council of Ministers cabinets (PL/CS/HU/RO/BG/YU) and the three
 * Soviet union republics modelled as their own countries (UKR/BLR/BAL).
 *
 * Structurally identical to the GDR/USSR command-economy council (same
 * portfolio IDs and levers). Reuse {@link DD_CABINET_POSITIONS} /
 * {@link DD_CABINET_MECHANICS}, remapping only the head-of-government seat to
 * each country's executive office key (PL First Secretary, YU President;
 * HU/RO/BG/CS keep DD's `generalSecretary`).
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";
import { DD_CABINET_POSITIONS } from "./ddCabinet";
import { PERPETUAL_YEAR } from "@/lib/cabinet/rosterEra";

/** Local mirror of CabinetPositionDef to avoid a circular import with cabinetMechanics. */
type EasternBlocCabinetPosition = {
  id: string;
  name: string;
  order: number;
  description?: string;
  isHeadOfGovernment?: boolean;
  yearEnabled?: number;
  yearRetired?: number;
  succeededBy?: string;
  namesByYear?: ReadonlyArray<{ from: number; name: string }>;
};

function withHeadOfGovernment(
  hogId: string,
  hogName: string
): ReadonlyArray<EasternBlocCabinetPosition> {
  return DD_CABINET_POSITIONS.map((position) =>
    position.id === "generalSecretary"
      ? { ...position, id: hogId, name: hogName, isHeadOfGovernment: true }
      : { ...position }
  );
}

/**
 * DD's departments are GDR-authentic (ddCabinetMechanics.ts), which is right for
 * DD and wrong for the countries that merely reuse the GDR cabinet SHAPE — a
 * Bulgarian central-bank liaison must not read "Staatsbank der DDR", and a
 * Polish interior ministry must not read "Ministry for State Security" (the
 * Stasi's title). These two seats get bloc-neutral departments; every other DD
 * department ("Ministry of Transport", "State Planning Commission", …) is
 * already generic and carries over unchanged.
 *
 * NOTE: the seat NAMES in DD_CABINET_POSITIONS have the same leak and are not
 * addressed here — that is a wider roster question than departments.
 */
const BLOC_NEUTRAL_DEPARTMENTS: Record<string, string> = {
  gosbank_liaison: "State Bank",
  minister_of_internal_affairs: "Ministry of the Interior",
};

function neutralizeBlocDepartment(mech: CabinetPositionMechanics): CabinetPositionMechanics {
  const department = BLOC_NEUTRAL_DEPARTMENTS[mech.positionId];
  if (!department) return mech;
  // Drop DD's era band along with the name: it encodes the GDR's 1968
  // Notenbank → Staatsbank rename, which did not happen in these countries.
  const { departmentByYear: _dropped, ...rest } = mech;
  return { ...rest, department };
}

function blocMechanics(
  source: Record<string, CabinetPositionMechanics>
): Record<string, CabinetPositionMechanics> {
  return Object.fromEntries(
    Object.entries(source).map(([id, mech]) => [id, neutralizeBlocDepartment(mech)])
  );
}

function withHeadOfGovernmentMechanics(hogId: string): Record<string, CabinetPositionMechanics> {
  const { generalSecretary, ...shared } = DD_CABINET_MECHANICS;
  return blocMechanics({
    [hogId]: { ...generalSecretary, positionId: hogId },
    ...shared,
  });
}

/**
 * DD's `minister_of_defence` carries `yearEnabled: 1956` — the NVA stand-up.
 * That is a GDR fact and must not propagate to the countries that merely reuse
 * the GDR cabinet SHAPE: Poland's Ministry of National Defence dates from 1945,
 * and the others likewise predate 1956. Without this, those countries field
 * 1953 armies with no minister able to command them (spec §3.2).
 */
function withPerpetualDefence(
  positions: ReadonlyArray<EasternBlocCabinetPosition>
): ReadonlyArray<EasternBlocCabinetPosition> {
  return positions.map((position) =>
    position.id === "minister_of_defence" ? { ...position, yearEnabled: PERPETUAL_YEAR } : position
  );
}

/** HU / RO / BG / CS — General Secretary head of government (DD shape). */
export const EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS =
  withPerpetualDefence(DD_CABINET_POSITIONS);
export const EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS = blocMechanics(DD_CABINET_MECHANICS);

/** Poland — PZPR First Secretary. */
export const PL_CABINET_POSITIONS = withPerpetualDefence(
  withHeadOfGovernment("firstSecretary", "First Secretary")
);
export const PL_CABINET_MECHANICS = withHeadOfGovernmentMechanics("firstSecretary");

/** Yugoslavia — President (Tito-era collective presidency head). */
export const YU_CABINET_POSITIONS = withPerpetualDefence(
  withHeadOfGovernment("president", "President")
);
export const YU_CABINET_MECHANICS = withHeadOfGovernmentMechanics("president");

/**
 * Union republics (UKR/BLR/BAL) — republican First Secretary.
 *
 * Identical to Poland's shape, and deliberately so rather than by accident: the
 * head of government seat is the republican party first secretary, the same
 * arrangement the PZPR ran, and every other portfolio is the shared council. It
 * is aliased rather than rebuilt so a change to the bloc council reaches all of
 * them at once.
 */
export const UNION_REPUBLIC_CABINET_POSITIONS = PL_CABINET_POSITIONS;
export const UNION_REPUBLIC_CABINET_MECHANICS = PL_CABINET_MECHANICS;
