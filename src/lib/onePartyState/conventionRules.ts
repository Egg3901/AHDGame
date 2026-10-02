/**
 * Constitutional convention rules shared by the engine, the draft route, and
 * the leader diagnostics the draft form is built from, so the form offers
 * exactly what `submitConventionDraft` accepts.
 */
import { COUNTRY_CONFIGS, type CountryId, type GovernmentType } from "@/lib/constants/countries";

/** Turns between announcing a convention and its draft deadline. */
export const CONVENTION_DRAFT_PHASE_TURNS = 48;

/** Turns after the draft deadline a draft may set the snap election for. */
export const CONVENTION_ELECTION_DELAYS = [12, 24, 48] as const;
export type ConventionElectionDelay = (typeof CONVENTION_ELECTION_DELAYS)[number];

/** Largest legacy seat reservation (percent) a draft may grant the former ruling party. */
export const CONVENTION_LEGACY_RESERVATION_MAX = 35;

/**
 * Government types a convention may adopt. `collapseTargetAllowlist` when the
 * country lists one, otherwise its single `collapseTargetSystem`.
 */
export function conventionTargetAllowlist(countryId: CountryId): GovernmentType[] {
  const cfg = COUNTRY_CONFIGS[countryId];
  if (!cfg) return [];
  return (
    cfg.collapseTargetAllowlist ?? (cfg.collapseTargetSystem ? [cfg.collapseTargetSystem] : [])
  );
}

/** Reservation and election delay a convention starts with until a draft sets them. */
export function conventionDraftDefaults(countryId: CountryId): {
  legacyReservation: number;
  electionDelayTurns: number;
} {
  const cfg = COUNTRY_CONFIGS[countryId];
  return {
    legacyReservation: cfg?.legacyReservationDefault ?? 20,
    electionDelayTurns: cfg?.electionDelayDefault ?? 24,
  };
}
