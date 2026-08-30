import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getRegion } from "@/lib/military/regions";
import { archiveOpensTurn, isArchiveOpen } from "@/lib/military/conflictLifecycle";
import { yearOfTurn, type CalendarClock } from "@/lib/utils/gameDate";

/**
 * A resolved war as the Historical Conflicts list renders it.
 *
 * Every field here is PUBLIC-tier data: the outcome, the dates, the side labels and
 * the cumulative casualty figure are what the record page shows any visitor,
 * belligerent or not, before the fog lifts. Nothing about either order of battle
 * belongs on this row, so the list leaks nothing the record would withhold.
 */
export interface HistoricalConflictRow {
  id: string;
  /** Public number: the record lives at /world/conflicts/<conflictId>. */
  conflictId: number;
  name: string;
  type: string;
  region: string;
  /** "1960 to 1962"; a legacy war with no end turn is dated by its start alone. */
  years: string;
  sideA: string;
  sideB: string;
  outcome: { label: string; side: "A" | "B" | null };
  deaths: string;
  /** Whether the full record is open, and if not, when it opens. */
  archive: { open: true } | { open: false; opensTurn: number; opensYear: number };
}

export interface HistoryViewOptions {
  startingYear: number;
  /** Cumulative casualties across this conflict's resolved battles. */
  casualties: number;
  currentTurn: number;
  /** Founding-phase calendar offset. Absent on a normal world (identity). */
  preIterationTurns?: number;
  preIterationActive?: boolean;
}

function outcomeOf(doc: ConflictDoc): HistoricalConflictRow["outcome"] {
  const winner = doc.outcome?.winner;
  if (winner === "A") return { label: `${doc.sideA.label} victory`, side: "A" };
  if (winner === "B") return { label: `${doc.sideB.label} victory`, side: "B" };
  if (winner === "stalemate") return { label: "Stalemate", side: null };
  return { label: "Concluded", side: null };
}

export function toHistoricalConflictRow(
  doc: ConflictDoc,
  opts: HistoryViewOptions
): HistoricalConflictRow {
  const clock: CalendarClock | undefined =
    opts.preIterationTurns != null || opts.preIterationActive
      ? { preIterationTurns: opts.preIterationTurns, preIterationActive: opts.preIterationActive }
      : undefined;
  const startYear = yearOfTurn(doc.startTurn, opts.startingYear, clock);
  const years =
    doc.endTurn != null
      ? `${startYear} to ${yearOfTurn(doc.endTurn, opts.startingYear, clock)}`
      : String(startYear);

  // `isArchiveOpen` is already true when there is no opening turn (a legacy war
  // with no `endTurn`), so the non-null assertion below is what the branch means.
  const opensTurn = archiveOpensTurn(doc);
  const archive: HistoricalConflictRow["archive"] =
    isArchiveOpen(doc, opts.currentTurn) || opensTurn === null
      ? { open: true }
      : { open: false, opensTurn, opensYear: yearOfTurn(opensTurn, opts.startingYear, clock) };

  return {
    id: doc._id,
    conflictId: doc.conflictId,
    name: doc.name,
    type: doc.type,
    region: getRegion(doc.region)?.name ?? doc.region,
    years,
    sideA: doc.sideA.label,
    sideB: doc.sideB.label,
    outcome: outcomeOf(doc),
    deaths:
      opts.casualties > 0
        ? `${opts.casualties.toLocaleString("en-US")} casualties`
        : "No engagements",
    archive,
  };
}
