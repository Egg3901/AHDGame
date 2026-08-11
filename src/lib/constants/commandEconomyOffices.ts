/**
 * Command Economy v2 (P2) — office wiring and lever ranges for the three
 * player economic seats (SOE Director, Gosplan Planner, Gosbank Chair).
 *
 * The Gosplan and Gosbank seats are ordinary cabinet positions already created
 * and filled by the RU / CN cabinet + Supreme Soviet work (see `ruCabinet.ts`,
 * `cnCabinet.ts`). This module only maps each command country to the cabinet
 * `positionId` that OPERATES each economic panel, so the write endpoints can
 * check the caller holds the seat. SOE directors are appointed per enterprise
 * onto `SoeState.directorId` (there is no fixed cabinet seat per SOE).
 *
 * Everything here is inert unless `commandEconomyEnabled` is on and the country
 * runs a planned economy — market worlds never reach these code paths.
 */

import type { CountryId } from "@/lib/constants/countries";

/** The cabinet seats that operate the planning and state-credit panels. */
export interface CommandEconomyOffices {
  /** Cabinet positionId of the Gosplan / state-planning chair. */
  plannerCabinetId: string;
  /** Cabinet positionId of the Gosbank / state-bank chair. */
  bankCabinetId: string;
}

/**
 * Per-country office map. Only the command countries that carry the multi-SOE
 * split (see `COMMAND_ECONOMY_SOE_SECTORS`) appear here.
 *
 * RU: Gosplan = "Chairman of Gosplan"; Gosbank = the Council's Gosbank liaison.
 * CN: planning sat with the economic Vice Premier (NDRC oversight); state
 *     credit = the State Council's PBoC liaison.
 * DD: slot ids mirror RU one-for-one (see `ddCabinet.ts`) — the planner seat is
 *     the Staatliche Plankommission chair (the GDR's Gosplan) and the bank seat
 *     is the Council's Staatsbank der DDR liaison (Deutsche Notenbank before
 *     the 1968 rename; the seat NAME carries the year band).
 */
export const COMMAND_ECONOMY_OFFICES: Partial<Record<CountryId, CommandEconomyOffices>> = {
  RU: { plannerCabinetId: "chairman_of_gosplan", bankCabinetId: "gosbank_liaison" },
  CN: { plannerCabinetId: "vice_premier", bankCabinetId: "pboc_governor" },
  DD: { plannerCabinetId: "chairman_of_gosplan", bankCabinetId: "gosbank_liaison" },
};

/** The office map for a country, or null when it is not a multi-SOE command country. */
export function commandEconomyOffices(
  countryId: string | null | undefined
): CommandEconomyOffices | null {
  if (!countryId) return null;
  return COMMAND_ECONOMY_OFFICES[countryId as CountryId] ?? null;
}

// ── Lever ranges (server-side clamps; mirrored by the panel sliders) ─────────

/** Gosbank credit aggressiveness: 0 restrained … 1 flood. */
export const CREDIT_AGGRESSIVENESS_RANGE = { min: 0, max: 1 } as const;
/** Gosbank budget softness: 0 hard (let weak SOEs fold) … 1 soft (bail all). */
export const BUDGET_SOFTNESS_RANGE = { min: 0, max: 1 } as const;
/** Director labour-vs-quality tradeoff: 0 quantity … 1 quality. */
export const LABOR_QUALITY_RANGE = { min: 0, max: 1 } as const;
/** Internal repression: 0 none … 1 heavy. */
export const INTERNAL_REPRESSION_RANGE = { min: 0, max: 1 } as const;

/**
 * A player-set plan target may not exceed this multiple of the SOE's current
 * productive capacity — a wholly unattainable quota is meaningless and would
 * peg fulfillment at zero. Below-capacity ("safe") targets are always allowed.
 */
export const MAX_PLAN_TARGET_CAPACITY_MULTIPLE = 3;

/** Clamp a number into [min, max]; non-finite → min. */
export function clampRange(v: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(v)) return range.min;
  return Math.min(range.max, Math.max(range.min, v));
}
