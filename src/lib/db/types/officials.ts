import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type SenateClass = 1 | 2 | 3;

export interface ElectedOfficial {
  _id: ObjectId;
  countryId?: CountryId;
  officeType:
    | "senate"
    | "house"
    | "stateSenate"
    | "governor"
    | "president"
    | "vicePresident"
    | "commons"
    | "regionalCouncil"
    | "primeMinister"
    | (string & {});
  state?: string;
  senateClass?: SenateClass;
  /** Staggered multi-seat chamber class (e.g. JP Sangiin 1/2). Distinct from senateClass,
   * which is single-seat US Senate. Needed to scope deletion/sweep when one class
   * resolves so the other class's officials aren't wiped. */
  chamberClass?: 1 | 2;
  district?: number;
  constituency?: string;
  constituencyId?: string;
  seatsHeld?: number;
  characterId: ObjectId | null;
  characterName?: string;
  party?: string;
  isNPP?: boolean;
  nppId?: ObjectId;
  electedAt?: Date;
  termEnds?: Date;
  /** True if appointed (Senate only), false if elected */
  isAppointment?: boolean;
  /** Character ID of appointing governor (if isAppointment is true) */
  appointedBy?: ObjectId;
  /**
   * How this seat was won.
   * "direct" — Constituency/single-member seat (Wahlkreis for DE, all seats for FPTP countries)
   * "list"   — List seat won via Zweitstimme / Landesliste (DE AMS only today)
   * Absent/undefined for legacy records; treat as "direct".
   */
  seatSource?: "direct" | "list";
  /**
   * Vice-president self-serve action pool (player suggestion #67). Present only
   * on the `vicePresident` office doc. Refilled to `VP_ACTION_CAP` once per
   * Eastern-time day by the turn engine (see vicePresidentActionReset.ts) and
   * spent one-per-action by the VP action endpoint. Absent on non-VP offices
   * and on legacy VP docs (backfilled lazily on first action).
   */
  vpActionsRemaining?: number;
  /** Eastern-time calendar day (`YYYY-MM-DD`) the VP action pool last reset. */
  lastVpActionResetDay?: string;
  createdAt: Date;
  updatedAt: Date;
}
