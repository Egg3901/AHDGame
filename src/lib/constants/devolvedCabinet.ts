/**
 * Shared scaffolding for the seceded devolved nations' cabinets (Scotland,
 * Wales). They mirror Westminster's portfolio set with localized titles, so the
 * gameplay mechanics + ministerial orders are REUSED from the UK config
 * (re-keyed to each seat's localized id) — those are metric-driven and
 * country-agnostic, only the names/departments differ. The Scotland/Wales
 * Secretary territorial seats and the UK-only First Secretary of State are
 * dropped (meaningless for a sovereign Scotland/Wales); Justice and Home Affairs
 * are merged into one seat.
 */
import { UK_CABINET_MECHANICS } from "./ukCabinetMechanics";
import { UK_MINISTERIAL_ORDERS } from "./ukCabinetOrders";
import type { CabinetPositionMechanics, MinisterialOrderConfig } from "./cabinetMechanicsTypes";
import type { CabinetPositionDef } from "./cabinetMechanics";

/**
 * Localized devolved-cabinet id → the UK position whose mechanics + orders it
 * reuses. `justiceSecretary` (Justice & Home Affairs) inherits the Home Office
 * mechanics — the broader public-safety remit — not the narrower Justice one.
 */
export const DEVOLVED_TO_UK_CABINET: Record<string, string> = {
  deputyFirstMinister: "deputy_prime_minister",
  financeSecretary: "chancellor",
  externalAffairsSecretary: "foreign_secretary",
  justiceSecretary: "home_secretary",
  defenceSecretary: "defence_secretary",
  healthSecretary: "health_secretary",
  educationSecretary: "education_secretary",
  economySecretary: "business_secretary",
  communitiesSecretary: "levelling_secretary",
  transportSecretary: "transport_secretary",
  netZeroSecretary: "environment_secretary",
  socialJusticeSecretary: "work_secretary",
};

/** One localized cabinet seat: a stable id (shared SCO/WAL) + nation-specific
 *  display name and department. */
export interface DevolvedSeat {
  id: keyof typeof DEVOLVED_TO_UK_CABINET | string;
  name: string;
  department: string;
}

/** Positions list (order follows the seat array), in the shared shape. All
 *  devolved seats are perpetual — the nations only exist post-secession, so
 *  the roster never era-filters. */
export function devolvedCabinetPositions(seats: DevolvedSeat[]): CabinetPositionDef[] {
  return seats.map((s, i) => ({ id: s.id, name: s.name, order: i, yearEnabled: 1775 }));
}

/** Mechanics re-keyed from UK to each localized seat, with a localized
 *  department label. Seats whose UK source is missing are skipped. */
export function devolvedCabinetMechanics(
  seats: DevolvedSeat[]
): Record<string, CabinetPositionMechanics> {
  const out: Record<string, CabinetPositionMechanics> = {};
  for (const s of seats) {
    const uk = UK_CABINET_MECHANICS[DEVOLVED_TO_UK_CABINET[s.id]];
    if (!uk) continue;
    // Drop the UK departmentByYear bands — they would override the localized
    // department label at resolve time (rosterEra.resolveDepartment).
    const { departmentByYear: _ukBands, ...ukRest } = uk;
    out[s.id] = { ...ukRest, positionId: s.id, department: s.department };
  }
  return out;
}

/** Ministerial orders re-keyed from UK to each localized seat. */
export function devolvedCabinetOrders(
  seats: DevolvedSeat[]
): Record<string, MinisterialOrderConfig[]> {
  const out: Record<string, MinisterialOrderConfig[]> = {};
  for (const s of seats) {
    out[s.id] = UK_MINISTERIAL_ORDERS[DEVOLVED_TO_UK_CABINET[s.id]] ?? [];
  }
  return out;
}
