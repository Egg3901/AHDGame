import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameIteration } from "./gameState";

export type OfficeKind = "executive" | "cabinet" | "leadership";

/**
 * Admin-curated office-holder entry for a past/known iteration. Generated wiki
 * office pages merge these with the auto-derived history and group both by
 * iteration. Used to populate iterations (e.g. Alpha 1, Beta 1) that predate
 * iteration stamping and have no recoverable per-event data.
 *
 * Collection: "manualOfficeHistory".
 */
export interface ManualOfficeHistoryEntry {
  _id: ObjectId;
  countryId: CountryId;
  officeKind: OfficeKind;
  /** Stable office identity: `${countryId}:${officeKind}:${officeType|positionId|leadershipRole}`. */
  officeKey: string;
  officeType?: string;
  positionId?: string;
  leadershipRole?: string;
  iteration: GameIteration;
  name: string;
  /** Party sequentialId string, matching auto entries. */
  party?: string;
  profileHref?: string | null;
  /**
   * Start tenure as in-game Week (1–52) + Year (drives the Tenure column).
   * Optional — an entry may instead/also carry a real-world `startDate`. At
   * least one of (`startWeek`+`startYear`) or `startDate` is always present.
   */
  startWeek?: number;
  startYear?: number;
  /** End tenure; omitted (or `isIncumbent`) renders "Incumbent". */
  endWeek?: number;
  endYear?: number;
  /** Real-world (wall-clock) dates the holder served (drives the Dates column). */
  startDate?: Date;
  endDate?: Date;
  isIncumbent?: boolean;
  /** Tiebreak within an iteration when start weeks collide. */
  order?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
