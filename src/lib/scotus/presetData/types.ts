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
   * seats `historicalOccupants[0]` immediately; `scotusTenureTurn` auto-advances
   * through the rest as each departure date is reached, for as long as the
   * seat has not diverged.
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

export interface ScotusPresetSeed {
  seats: ScotusPresetSeatSeed[];
  docket: ScotusPresetDocketCaseSeed[];
}
