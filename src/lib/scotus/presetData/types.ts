import type {
  HistoricalJusticeOccupant,
  DocketCaseAxis,
  DocketCaseEffect,
} from "@/lib/db/types/scotus";

/**
 * Content-authoring shape for one preset's SCOTUS data (#3598 core mechanics;
 * actual content authored by #3599 [1953], #3600 [1979], #3601 [1991], #3602
 * [2019-default]). `seedScotus` (src/lib/scotus/seedScotus.ts) consumes this
 * shape directly to write `supremeCourtSeats`/`docketCases` rows.
 */

/** One of the Court's 9 seats for a given preset's Original Roster. */
export interface ScotusPresetSeatSeed {
  seatNumber: number; // 1-9
  /**
   * The real historical succession chain for this seat, chronological,
   * starting from whoever was seated at the preset's start year. `seedScotus`
   * seats only `historicalOccupants[0]`. Later entries are reference data and
   * are never auto-appointed; the first occupant's departure opens a vacancy.
   */
  historicalOccupants: HistoricalJusticeOccupant[];
}

export interface ScotusPresetDocketCaseSeed {
  caseKey: string;
  title: string;
  axis: DocketCaseAxis;
  historicalMajorityDirection: 1 | -1;
  decisionYear: number;
  /** See `DocketCase.historicalOutcomeLocked` — race/equal-protection cases only. */
  historicalOutcomeLocked?: boolean;
  /** Authored only for cases where a divergent ruling needs a concrete law-equivalent effect. */
  effect?: DocketCaseEffect;
  /** See `DocketCase.historicalSummary` (src/lib/db/types/scotus.ts) — plain-language wire copy for the real holding. */
  historicalSummary?: string;
  /** See `DocketCase.alternateSummary` — plain-language wire copy for the alternate ruling. */
  alternateSummary?: string;
  /** See `DocketCase.demographicSignal` — structured hook for the (separately owned) demographic-realignment mechanism. */
  demographicSignal?: { affirmedSignal: string; divergedSignal: string };
}

export interface ScotusRosterProvenance {
  /** A reviewed current roster carried forward to a future preset date. */
  mode: "reviewed-current-roster-fallback";
  /** ISO date on which the source roster was reviewed. */
  asOf: string;
  /** Future preset date for which the reviewed roster is the explicit fallback. */
  projectedFor: string;
  /** Public source used to review the membership and vacancies. */
  source: string;
  /** Limits on treating the projection as a historical observation. */
  limitation: string;
}

export type ScotusDocketProvenance =
  | {
      mode: "authored-history";
      /** Last calendar year covered by the curated historical docket. */
      throughYear: number;
      source: string;
    }
  | {
      /**
       * Explicit fallback for a preset whose opening date is beyond the last
       * completed historical term. The curated docket deliberately starts
       * empty; ordinary play still receives the procedural surprise docket.
       */
      mode: "procedural-only-fallback";
      reviewedAt: string;
      source: string;
      limitation: string;
    };

export interface ScotusPresetProvenance {
  roster: ScotusRosterProvenance;
  docket: ScotusDocketProvenance;
}

export interface ScotusPresetSeed {
  seats: ScotusPresetSeatSeed[];
  docket: ScotusPresetDocketCaseSeed[];
  /**
   * Required when a preset intentionally relies on a reviewed fallback. Older
   * authored historical presets predate this metadata and remain compatible.
   */
  provenance?: ScotusPresetProvenance;
}
