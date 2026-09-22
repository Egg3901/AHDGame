import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  NationalResults,
  ResultsCandidate,
  ResultsSummary,
  ResultsUnit,
} from "@/lib/elections/liveResults/types";

/**
 * Schema version of `ElectionResultSnapshot`.
 *
 * Bump when the stored shape changes. The results route serves a snapshot only
 * when its version matches, and otherwise falls back to live computation, so an
 * unreadable snapshot degrades to the pre-snapshot behaviour rather than
 * rendering a shape the build does not understand.
 */
export const ELECTION_RESULT_SNAPSHOT_VERSION = 1 as const;

/**
 * A frozen election-night result, written once when a race resolves.
 *
 * Why this exists: the live results endpoint rebuilds electoral-vote weights
 * from `loadApportionment(db, preset, gameState.currentYear)` and reads party
 * names and colours live. Both drift. Apportionment is era-gated — DC gains
 * three electoral votes from 1961, Maine splits by district from 1972,
 * Nebraska from 1992, and states are admitted over time — so a race from an
 * earlier decade, re-rendered today, shows a total and a votes-to-win line that
 * were never in force when it was decided. A party that later renames,
 * recolours or winds up rewrites its own history the same way.
 *
 * The snapshot is therefore the authority for any race the game has finished
 * with. It stores only what is settled: the per-unit results, the candidate
 * roster with the party identity as it stood, the electoral-college totals, and
 * the national aggregation.
 *
 * Fields that are per-request or per-viewer are deliberately absent and are
 * recomputed on every read: `currentTurn`, `finalHour`, `isAdmin` and
 * `lastUpdated`. Freezing those would serve one reader another reader's page.
 */
export interface ElectionResultSnapshot {
  _id: ObjectId;
  /** The race this froze. Uniquely indexed — one snapshot per election. */
  electionId: ObjectId;
  countryId: CountryId;
  electionType: string;
  cycle: number;
  /** LARP year of the race, copied from the election doc. Null on legacy rows. */
  electionYear: number | null;
  schemaVersion: typeof ELECTION_RESULT_SNAPSHOT_VERSION;
  capturedAt: Date;
  /** Game turn the capture ran on, for forensics. */
  capturedAtTurn: number;
  /** President only: total electoral votes under the map in force at the time. */
  totalEv?: number;
  /** President only: the majority threshold that actually governed the race. */
  evNeeded?: number;
  totalSeats: number;
  candidates: ResultsCandidate[];
  units: ResultsUnit[];
  national: NationalResults | null;
  summary: ResultsSummary;
}
