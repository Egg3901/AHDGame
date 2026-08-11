import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type ReferendumStatus =
  | "requested"
  | "declined"
  | "granted"
  | "campaigning"
  | "polling"
  | "actuating"
  | "completed"
  | "settled"
  | "cancelled";

export type ReferendumKind = "independence" | "reunification";

/** One declared party stance in a referendum (Sub-project D). Independent of
 *  campaign spend — a public position, not a poll mover. */
export interface ReferendumPartyPosition {
  /** sequentialId-string of the declaring party. */
  partyId: string;
  side: "yes" | "no";
  declaredByCharacterId: ObjectId;
  declaredTurn: number;
}

/**
 * One document per active/historical independence/reunification referendum.
 * Scoped to a UK devolved region (SCO/WAL/NIR). Collection: "referendums".
 *
 * The lifecycle is driven by `processReferendumLifecycle` each turn; see
 * `docs/superpowers/specs/2026-06-16-independence-process-design.md` for the
 * state machine and rationale.
 */
export interface Referendum {
  _id?: ObjectId;
  /** The country the region currently belongs to ("UK"). */
  countryId: CountryId;
  /** "SCO" | "WAL" | "NIR". */
  regionId: string;
  kind: ReferendumKind;
  /** null = secession (new country); "IE" = NIR reunification (transfer). */
  targetCountryId: CountryId | null;
  status: ReferendumStatus;

  requestedTurn: number;
  /** Turn the PM granted the referendum (opening the campaign). */
  grantedTurn: number | null;
  campaignOpenTurn: number | null;
  campaignCloseTurn: number | null;

  /**
   * Denormalized current Yes share (0–100) for display, refreshed best-effort
   * each campaigning turn and on each ground-game spend. NOT authoritative: the
   * value the vote resolves on is always recomputed from the cohort model via
   * `referendumYesShare` (see resolveYesShare.ts), so a raced display update
   * cannot change the outcome.
   */
  yesShare: number;
  /** Immutable campaign baseline (independenceDesire when the referendum opened).
   *  The cohort baseline is re-centered to it, and it is the fallback Yes share
   *  for any referendum without a cohort baseline. */
  campaignBaseYesShare: number;
  /** Legacy uniform PS-spend ledger (per side). Dormant since ground game became
   *  the sole spend channel — no longer written, but still folded in as a uniform
   *  lean shift by `referendumYesShare` for any pre-cutover referendum. */
  campaignSpendUnits: { yes: number; no: number };

  /** Turn the post-pass conversion window closes (auto-converts at/after this).
   *  Set when a referendum passes into `actuating`; null otherwise. */
  conversionDeadlineTurn: number | null;
  /** For reunification: the two concurrent consent bills that must BOTH pass
   *  within the conversion window for the transfer to take effect — a Westminster
   *  Commons bill (UK releases NI) and a Dáil bill (Ireland admits NI). */
  westminsterBillId: ObjectId | null;
  dailBillId: ObjectId | null;
  /** Set once each consent bill's vote outcome has been posted to Discord, so
   *  the per-turn lifecycle announces each Commons/Dáil result only once. */
  westminsterBillAnnounced?: boolean;
  dailBillAnnounced?: boolean;

  /** Per-turn canonical Yes-share readings across the campaign window, oldest
   *  first. Seeded at campaign open, appended each campaigning turn, and read by
   *  the tracking-poll chart, hub sparkline, and momentum indicator. */
  pollHistory?: { turn: number; yesShare: number }[];

  /** Public party stances declared by Chairs/Vice during the campaign. One
   *  entry per party; declaring replaces, withdrawing removes. */
  partyPositions?: ReferendumPartyPosition[];

  /** Per-cohort snapshot taken at campaign open; the cohort model's fixed
   *  baseline (Sub-project C). yesShare is the turnout-weighted aggregate. */
  cohortBaseline?: { groupId: string; share: number; turnout: number; yesLean: number }[];
  /** Accumulated ground-game effects per cohort, stored as RAW signed units; the
   *  per-cohort soft cap (tanh) is applied at read time by `aggregateYesShare`. */
  cohortModifiers?: { groupId: string; turnoutMod: number; leanMod: number }[];
  /** Ground-game spend ledger per cohort (audit + UI). */
  groundGameUnits?: {
    groupId: string;
    mobilizeUnits: number;
    persuadeYes: number;
    persuadeNo: number;
  }[];

  result: {
    finalYesShare: number;
    turnout: number;
    passed: boolean;
    resolvedTurn: number;
  } | null;

  /** Set on decline/settled — gates the next request via the eligibility check. */
  cooldownReadyAtTurn: number | null;

  createdAt: Date;
  updatedAt: Date;
}
