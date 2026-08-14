/**
 * Country-agnostic cabinet mechanics barrel.
 * Routes to the correct per-country config by countryId.
 */
import type { CountryId } from "./countries";
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";
import { UK_CABINET_MECHANICS } from "./ukCabinetMechanics";
import { US_CABINET_MECHANICS } from "./usCabinetMechanics";
import { JP_CABINET_MECHANICS } from "./jpCabinetMechanics";
import { UK_CABINET_POSITIONS } from "./ukCabinet";
import { JP_CABINET_POSITIONS } from "./jpCabinet";
import { IE_CABINET_MECHANICS } from "./ieCabinetMechanics";
import { IE_CABINET_POSITIONS } from "./ieCabinet";
import { DE_CABINET_MECHANICS } from "./deCabinetMechanics";
import { DE_CABINET_POSITIONS } from "./deCabinet";
import { CN_CABINET_MECHANICS } from "./cnCabinetMechanics";
import { CN_CABINET_POSITIONS } from "./cnCabinet";
import { NG_CABINET_MECHANICS } from "./ngCabinetMechanics";
import { NG_CABINET_POSITIONS } from "./ngCabinet";
import { RU_CABINET_MECHANICS } from "./ruCabinetMechanics";
import { RU_CABINET_POSITIONS } from "./ruCabinet";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";
import { DD_CABINET_POSITIONS } from "./ddCabinet";
import {
  EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
  EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  PL_CABINET_MECHANICS,
  PL_CABINET_POSITIONS,
  YU_CABINET_MECHANICS,
  YU_CABINET_POSITIONS,
  UNION_REPUBLIC_CABINET_MECHANICS,
  UNION_REPUBLIC_CABINET_POSITIONS,
} from "./easternBlocCabinet";
import { SCO_CABINET_MECHANICS, SCO_CABINET_POSITIONS } from "./scoCabinet";
import { WAL_CABINET_MECHANICS, WAL_CABINET_POSITIONS } from "./walCabinet";
import { CABINET_POSITIONS } from "./cabinet";

export type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

/** One era display-name band; the last band with `from <= year` wins. */
export interface CabinetNameBand {
  from: number;
  name: string;
}

/** Shape of a cabinet position definition shared across all country configs. */
export interface CabinetPositionDef {
  id: string;
  name: string;
  order: number;
  description?: string;
  /**
   * True for the head-of-government seat (e.g. CN Premier, IE Taoiseach). This
   * position is auto-assigned from `governmentFormations.pmCharacterId` (seated
   * via the Appoint-Premier flow), not the cabinet appointment flow — so it is
   * never appointable/fireable as a cabinet member.
   */
  isHeadOfGovernment?: boolean;
  /**
   * First in-game year this seat exists (live year, see rosterEra.ts).
   * PERPETUAL_YEAR (1775) = always existed. Data convention: EXPLICIT on every
   * seat (enforced by cabinetYearGating.test.ts); the resolver still defaults a
   * missing value to PERPETUAL_YEAR defensively.
   */
  yearEnabled?: number;
  /** Seat inactive from this year on. Active range: yearEnabled <= y < yearRetired. */
  yearRetired?: number;
  /**
   * Successor seat id (same country). When the live year crosses `yearRetired`,
   * the cabinetYearCrossing phase moves the incumbent to this seat. Requires
   * `yearRetired`.
   */
  succeededBy?: string;
  /** Era display names. Resolution: last band with from <= year; fallback `name`. */
  namesByYear?: ReadonlyArray<CabinetNameBand>;
  /**
   * Legislation-driven rename: when the seat named in `whenSeatEnabled` has been
   * brought into existence by a create_department bill (recorded in
   * `gameState.manuallyEnabledSeats`), this seat is styled `name`. Used for
   * HEW -> HHS when the Department of Education Act carves off Education.
   * Takes precedence over `namesByYear`. See rosterEra.resolveSeatName.
   */
  renameOnDepartmentSplit?: { whenSeatEnabled: string; name: string };
}

const MECHANICS_BY_COUNTRY: Record<string, Record<string, CabinetPositionMechanics>> = {
  UK: UK_CABINET_MECHANICS,
  US: US_CABINET_MECHANICS,
  JP: JP_CABINET_MECHANICS,
  IE: IE_CABINET_MECHANICS,
  DE: DE_CABINET_MECHANICS,
  CN: CN_CABINET_MECHANICS,
  NG: NG_CABINET_MECHANICS,
  RU: RU_CABINET_MECHANICS,
  DD: DD_CABINET_MECHANICS,
  // Eastern bloc Tier-1 — DD/RU Council of Ministers shape (1953 promotion).
  PL: PL_CABINET_MECHANICS,
  CS: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
  HU: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
  RO: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
  BG: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
  YU: YU_CABINET_MECHANICS,
  // Union republics — republican First Secretary heads the council (PL shape).
  UKR: UNION_REPUBLIC_CABINET_MECHANICS,
  BLR: UNION_REPUBLIC_CABINET_MECHANICS,
  BAL: UNION_REPUBLIC_CABINET_MECHANICS,
  SCO: SCO_CABINET_MECHANICS,
  WAL: WAL_CABINET_MECHANICS,
};

const POSITIONS_BY_COUNTRY: Record<string, ReadonlyArray<CabinetPositionDef>> = {
  UK: UK_CABINET_POSITIONS,
  US: CABINET_POSITIONS,
  JP: JP_CABINET_POSITIONS,
  IE: IE_CABINET_POSITIONS,
  DE: DE_CABINET_POSITIONS,
  CN: CN_CABINET_POSITIONS,
  NG: NG_CABINET_POSITIONS,
  RU: RU_CABINET_POSITIONS,
  DD: DD_CABINET_POSITIONS,
  PL: PL_CABINET_POSITIONS,
  CS: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  HU: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  RO: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  BG: EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  YU: YU_CABINET_POSITIONS,
  UKR: UNION_REPUBLIC_CABINET_POSITIONS,
  BLR: UNION_REPUBLIC_CABINET_POSITIONS,
  BAL: UNION_REPUBLIC_CABINET_POSITIONS,
  SCO: SCO_CABINET_POSITIONS,
  WAL: WAL_CABINET_POSITIONS,
};

/** Get mechanics for a specific position in a country. Returns undefined if not found. */
export function getCabinetMechanics(
  countryId: CountryId | string,
  positionId: string
): CabinetPositionMechanics | undefined {
  return MECHANICS_BY_COUNTRY[countryId]?.[positionId];
}

/** Get all mechanics for a country. Returns empty object if country has none. */
export function getAllCabinetMechanics(
  countryId: CountryId | string
): Record<string, CabinetPositionMechanics> {
  return MECHANICS_BY_COUNTRY[countryId] ?? {};
}

export { getCabinetPositionGroup, type CabinetGroup } from "./cabinetPositionGroups";

/** Get cabinet positions list for a country. */
export function getCabinetPositions(
  countryId: CountryId | string
): ReadonlyArray<CabinetPositionDef> {
  return POSITIONS_BY_COUNTRY[countryId] ?? [];
}

/** All country ids that have a cabinet roster registered. */
export function getCabinetCountryIds(): string[] {
  return Object.keys(POSITIONS_BY_COUNTRY);
}
