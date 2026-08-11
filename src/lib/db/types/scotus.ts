import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WhippedFromVoteMap } from "./legislation";
import type { IterationStampFields } from "./gameState";

/**
 * SCOTUS core mechanics (#3598, spec #3581).
 *
 * Justice is stored on its own document — mirroring how central-bank-chair
 * lives on `centralBanks.chairCharacterId` rather than `character.currentOffice`
 * (see `src/lib/db/types/centralBank.ts` + `scripts/migrations/decouple-chair-from-currentoffice.ts`)
 * — so holding a Justice seat never blocks, and is never blocked by, any other
 * office a character holds. Do NOT add a "justice" member to `OfficeType` or set
 * `character.currentOffice` on confirmation/vacancy.
 */

/** One real historical justice's tenure on a given seat, authored by the per-preset content tickets (#3599-#3602). */
export interface HistoricalJusticeOccupant {
  /** Stable key for this historical figure within the preset's roster data (e.g. "warren-1953"). */
  key: string;
  name: string;
  /** Opaque party identifier, same convention as `Character.party` / `NPP.party`. */
  party?: string;
  /**
   * Authored lean scores on the shared [-5, +5] scale. Real historical justices have
   * no Character/NPP PolicyPositions to derive from, so content authors these directly
   * (e.g. from real voting record), unlike NPP/player justices whose leans are computed
   * via `computeJusticeIdeology`.
   */
  economicLean: number;
  socialLean: number;
  /** Calendar year this occupant took the seat (first entry per seat = the preset's start year). */
  seatedYear: number;
  /** Calendar year this occupant left the bench, or null if still serving as of the preset's docket cutoff ("present"). */
  departureYear: number | null;
  departureReason: "death" | "retirement" | null;
}

/**
 * One of the Court's 9 seats. Persists for the life of a game; `historicalOccupants`
 * is the Original Roster succession chain for this seat (authored by content tickets),
 * consumed automatically by `scotusTenureTurn` while `isDivergent` is false.
 */
export interface SupremeCourtSeat extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId; // "US" only, per #3581 scope
  seatNumber: number; // 1-9

  // ── Current occupant (never mirrored onto character.currentOffice) ─────────
  /**
   * "historical" = a scripted Original Roster occupant with no backing
   * Character/NPP document (real historical figures aren't spawned as game
   * entities) — `justiceCharacterId`/`justiceNppId` are both null in that case.
   * "character"/"npp" are only ever set via the nomination/confirmation flow.
   */
  justiceMode: "character" | "npp" | "historical" | null;
  justiceCharacterId: ObjectId | null;
  justiceNppId: ObjectId | null;
  justiceName: string | null;
  justiceParty: string | null;
  economicLean: number | null;
  socialLean: number | null;
  seatedAt: Date | null;
  seatedAtTurn: number | null;

  /**
   * False while the seat is still replaying the real historical succession
   * (Original Roster). Flips true forever at the Divergence Point — the first
   * turn the seat is filled via the in-game nomination/confirmation flow
   * instead of the next scripted `historicalOccupants` entry.
   */
  isDivergent: boolean;
  /** Index into `historicalOccupants` of the occupant currently/most-recently scripted for this seat. */
  historicalOccupantIndex: number;
  historicalOccupants: HistoricalJusticeOccupant[];

  // ── Divergent-tenure hazard clock (age-agnostic, see ahd-scotus-adr-age-agnostic-tenure-clock) ──
  /** Turn after which the flat per-turn hazard starts rolling for the current divergent occupant. */
  divergentHazardStartsTurn: number | null;

  // ── Judicial self-serve action pool (mirrors VP_ACTION_CAP machinery) ──────
  justiceActionsRemaining?: number;
  lastJusticeActionResetDay?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ScotusNominationStatus = "active" | "confirmed" | "rejected" | "withdrawn";

/**
 * Mirrors `CabinetNomination` (src/lib/db/types/cabinet.ts) field-for-field where the
 * Senate-vote lifecycle is concerned — reuses `computeCabinetNominationTally` and
 * `didPass` as-is. Diverges from `CabinetNomination` only where cabinet nominations
 * don't support the SCOTUS requirement of an NPP "legal scholar" nominee: a
 * `nomineeMode` discriminator replaces the player-only `nomineeCharacterId`.
 */
export interface ScotusNomination extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId;
  seatNumber: number;

  nomineeMode: "character" | "npp";
  nomineeCharacterId: ObjectId | null;
  nomineeNppId: ObjectId | null;
  nomineeName: string;
  nomineeParty?: string;

  proposedByPresidentId: ObjectId;
  proposedByPresidentName: string;
  status: ScotusNominationStatus;

  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  whippedFromVote?: WhippedFromVoteMap;

  votingStartedAt?: Date;
  votingEndsAt?: Date;
  /** Game-clock turn on which voting closes. Server resolution uses this (turn-number first, same as cabinet). */
  votingEndsOnTurn?: number;

  confirmedAt?: Date;
  rejectedAt?: Date;
  proposedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DocketCaseAxis = "economic" | "social";
export type DocketCaseOutcome = "affirmed" | "diverged";

/**
 * The law-equivalent effect a diverged case applies. Shaped like a minimal
 * `PolicyProvision` (src/lib/db/types/legislation.ts) referencing an EXISTING
 * `legislationTypes`/`policyOptions` entry — this is what lets a diverged ruling
 * flow through `onBillEnacted`/`recordEnactedLaw` completely unmodified.
 * Content tickets (#3599-#3602) author this per case that could plausibly diverge;
 * affirmed cases never read it.
 */
export interface DocketCaseEffect {
  legislationTypeId: string;
  policyOptionId: string;
  effectDirection: -1 | 0 | 1;
  economic?: number;
  social?: number;
  /** Defaults to "federal" (national scope) — SCOTUS rulings are federal by design. */
  stateId?: string;
}

/**
 * One authored landmark case on a preset's Docket. `historicalMajorityDirection`
 * is the sign (on `axis`) the real historical majority actually sat on; see
 * ahd-scotus-adr-majority-headcount-divergence for why this is a headcount rule,
 * not an averaged court-wide ideology score.
 */
export interface DocketCase {
  _id: ObjectId;
  countryId: CountryId;
  preset: string;
  /** Stable content key, e.g. "brown-v-board-1954". Unique per preset. For surprise cases (isSurprise) this is the SurpriseCaseTemplate's templateKey instead, used game-wide (not per-preset) to track which templates have already spawned. */
  caseKey: string;
  title: string;
  axis: DocketCaseAxis;
  /**
   * Absent for procedurally-spawned surprise cases (#3607, `isSurprise`) —
   * those have no real-world ruling to affirm or diverge from, so there is
   * nothing here to author. Always present for curated historical Docket
   * cases (#3599-3602); `scotusDocketTurn.ts` only ever reads this off a
   * `status: "pending"` row, and surprise cases are inserted directly as
   * `status: "decided"` and never enter that query, so the two never collide.
   */
  historicalMajorityDirection?: 1 | -1;
  /**
   * When true, `scotusDocketTurn.ts` forces this case's `outcome` to
   * "affirmed" regardless of the sitting Court's composition — see
   * `decideCaseOutcome`'s `historicalOutcomeLocked` option
   * (`src/lib/scotus/divergence.ts`). Reserved for race/equal-protection
   * doctrine (Brown v. Board and similar): a deliberate, permanent product
   * decision, not a placeholder for a future divergence branch. Cases with
   * this set author no `effect`/`alternateSummary` (there is no alternate
   * branch to carry one).
   */
  historicalOutcomeLocked?: boolean;
  /** Calendar year the case is scripted to fire near. For surprise cases, the calendar year of the turn it actually spawned on (there's no advance scripting). */
  decisionYear: number;
  /**
   * Effect applied only if the case diverges (see DocketCaseEffect doc comment). Absent effects are only valid for cases where a divergence is not expected to occur — content-authoring safety net, not enforced here.
   * For a decided surprise case, this is whichever of the template's
   * `positiveEffect`/`negativeEffect` matched the sitting majority at spawn
   * time (absent only on the rare exact-tie no-majority case).
   */
  effect?: DocketCaseEffect;

  /**
   * Plain-language player-facing summary of the REAL historical holding and
   * its practical consequence — shown when the case affirms history, and
   * always shown in the catalogue/report regardless of outcome. Authored for
   * every curated Docket case (#3599-3602 content + the SCOTUS case-catalogue
   * expansion), not just ones with a mechanical `effect` — every decided case
   * gets a full wire post (see `src/lib/scotus/scotusNews.ts`), including the
   * six cases with no `effect` authored (Bush v. Gore, Lawrence v. Texas,
   * Heller, McDonald, Windsor, Obergefell).
   */
  historicalSummary?: string;
  /**
   * Plain-language summary of the ALTERNATE ruling — what the Court decided
   * instead, and its practical consequence — shown when the case diverges
   * from history. Paired 1:1 with `historicalSummary`.
   */
  alternateSummary?: string;
  /**
   * Structured signal for a case whose natural consequence is DEMOGRAPHIC
   * realignment (e.g. Baker v. Carr/Reynolds v. Sims/Wesberry v. Sanders
   * reapportionment) rather than a policy-metric delta `DocketCaseEffect` can
   * express. `scotusDocketTurn.ts` records whichever string matches the
   * decided outcome as a `countryHistoryEvents` row
   * (`eventType: "scotus_demographic_signal"`) — a read-only hook. This
   * system does NOT itself move seat apportionment, district maps, or
   * demographic base leans; that mechanism is owned elsewhere (era
   * checkpoints moving demographic base leans) and, if/when built, can query
   * `countryHistoryEvents` for this eventType to react to these rulings.
   * Mutually exclusive with `effect` in practice (every case authored so far
   * has one or the other, never both) but not schema-enforced.
   */
  demographicSignal?: {
    /** Recorded when the case affirms its historical outcome. */
    affirmedSignal: string;
    /** Recorded when the case diverges from its historical outcome. */
    divergedSignal: string;
  };

  status: "pending" | "decided";
  outcome?: DocketCaseOutcome;
  decidedAtTurn?: number;
  decidedAt?: Date;
  /** Seated-justice headcount snapshot at decision time, for the case-history read surface. */
  decisionSeatedFor?: number;
  decisionSeatedAgainst?: number;
  /** _id of the synthesized enactedLaws row, when outcome === "diverged" and effect was authored. */
  enactedLawId?: ObjectId;
  /**
   * True for a procedurally-spawned "surprise" Docket case (#3607) — flavor
   * content on top of the curated real-historical Docket, distinguishable
   * here (and via `enactedLaws.source: "scotus_surprise_ruling"`) so the
   * case-history read layer (`getScotusCaseHistory`) and its future UI
   * (#3605) can render/filter them apart from real historical cases.
   * Absent/false for every historical Docket case.
   */
  isSurprise?: boolean;

  createdAt: Date;
  updatedAt: Date;
}
