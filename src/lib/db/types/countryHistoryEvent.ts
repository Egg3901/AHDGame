import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type CountryHistoryEventType =
  /** New head of state or head of government takes office. */
  | "leader_change"
  /** A federal/national-scope bill was enacted into law. */
  | "bill_enacted"
  /** International organization actions (joining/leaving, FTAs, leadership changes). */
  | "international_relations"
  /**
   * One-party-state regime escalation stage transition (Phase 3). The
   * `details` field carries `{ from, to, popularLegitimacy, partyConfidence }`.
   */
  | "regime_escalation"
  /**
   * A UK independence/reunification referendum passed. `details` carries
   * `{ regionId, kind, targetCountryId, finalYesShare, turnout }`.
   */
  | "referendum_passed"
  /** A UK independence/reunification referendum failed at the ballot box. */
  | "referendum_failed"
  /**
   * A region left one country to join another (NI → Ireland). `details` carries
   * `{ regionId, fromCountryId, toCountryId }`.
   */
  | "region_transferred"
  /**
   * A region seceded and became a new sovereign country (Scotland/Wales leave
   * the UK). `details` carries `{ regionId, fromCountryId, toCountryId }`.
   */
  | "region_seceded"
  /**
   * A decided SCOTUS Docket case whose natural consequence is demographic
   * realignment rather than a policy-metric delta (reapportionment cases:
   * Baker v. Carr, Reynolds v. Sims, Wesberry v. Sanders). `details` carries
   * `{ caseKey, signal, axis, decisionYear, outcome }` — see
   * `DocketCase.demographicSignal` (src/lib/db/types/scotus.ts) for the
   * authoring shape and `scotusDocketTurn.ts` for where this is recorded.
   * This is a READ-ONLY hook: nothing in this codebase currently consumes
   * these rows to move seat apportionment or demographic base leans — that
   * mechanism, if/when built, is owned elsewhere.
   */
  | "scotus_demographic_signal"
  /** Optional catch-all for future event types (cabinet changes, etc.). */
  | "other";

/**
 * Append-only record of notable country-level events, written by the turn
 * processor as state transitions happen. Powers the "history" table on
 * country wiki pages.
 */
export interface CountryHistoryEvent {
  _id: ObjectId;
  countryId: CountryId;
  /** Game turn when the event was recorded. */
  turn: number;
  /** Wall-clock time the event was written (usually === turn-start time). */
  timestamp: Date;
  eventType: CountryHistoryEventType;
  /** Short human-readable summary for the history table. */
  title: string;

  // ── Optional refs used by specific event types ──────────────────────────
  /** For leader_change: which office key (e.g. "president", "primeMinister"). */
  officeType?: string;
  /** For leader_change / bill_enacted: the player/character involved. */
  characterId?: ObjectId;
  characterName?: string;
  /** For leader_change / bill_enacted: party at the time of the event. */
  party?: string;
  /** For bill_enacted: reference to the bill document. */
  billId?: ObjectId;
  /** For bill_enacted: which chamber/scope the bill lived in (federal, state). */
  billScope?: string;
  /** Bag for future structured fields without schema migration. */
  details?: Record<string, unknown>;

  // ── Iteration stamp (written at record time / by the freeze helper) ──────
  /** Iteration during which the event was recorded. */
  iteration?: import("./gameState").GameIteration;
  /** Calendar year of turn 1 for that iteration's preset — for Week/Year render. */
  iterationStartingYear?: number;
}
