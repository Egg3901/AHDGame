import type { ConflictDoc } from "@/lib/db/types/conflict";
import { occupationOf } from "@/lib/military/occupation";
import { anchorOf } from "@/lib/maps/countryAnchors";
import { getRegion } from "@/lib/military/regions";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn, type CalendarClock } from "@/lib/utils/gameDate";
import { projectLonLat } from "./regionOverlayBridge";
import type { Conflict, Severity } from "./conflicts";

/**
 * A live conflict document as the Global Conflicts board renders it.
 *
 * The board predates dynamic conflicts and was written around a static Cold War
 * flashpoint set, so two of its fields are NULLABLE here: `lean` (a west↔east
 * position, meaningless for a war neither superpower backs) and `x`/`y` (a map
 * position, unavailable for a host with no anchor). Both degrade rather than guess.
 *
 * Spec: docs/superpowers/specs/2026-07-26-live-conflicts-hub-design.md
 */

/**
 * The in-game year a turn falls in.
 *
 * Routes through `calendarTurn` so a founding-phase offset (`preIterationTurns`)
 * does not push the year a year ahead of the status bar. Without a clock this is
 * the identity on the raw turn, which is what every existing test asserts.
 */
export function yearOfTurn(turn: number, startingYear: number, clock?: CalendarClock): number {
  const cal = calendarTurn(turn, clock);
  return startingYear + Math.floor(Math.max(0, cal - 1) / TURNS_PER_YEAR);
}

/** The board's severity rung. A winding-down war reads as that whatever its weight. */
function severityOf(doc: ConflictDoc): Severity {
  // A war awaiting terms has stopped: its front reached a pole and every unit went
  // back to reserve. Left to fall through, its stored `severity` would put a
  // finished war on the board as CRITICAL. It shares the winding-down rung rather
  // than getting its own, because the board's four rungs are about how hot a war is
  // and this one is cold; the record page names the exact state for anyone who opens
  // it.
  if (doc.status === "winding_down" || doc.status === "terms_pending") return "WINDING DOWN";
  return doc.severity === "HIGH" ? "CRITICAL" : doc.severity === "MEDIUM" ? "MAJOR" : "ACTIVE";
}

export interface ConflictViewOptions {
  /** The game's starting year, for dating a conflict from its start turn. */
  startingYear: number;
  /** Cumulative casualties across this conflict's resolved battles. */
  casualties: number;
  /** Founding-phase calendar offset. Absent on a normal world (identity). */
  preIterationTurns?: number;
  /** Pin every date to the era start while the founding phase is still running. */
  preIterationActive?: boolean;
}

export function toConflictView(doc: ConflictDoc, opts: ConflictViewOptions): Conflict {
  const occ = occupationOf(doc);

  // Sides, ordered so the board's blue/red treatment lands on the right one. With no
  // backer at all there is no west or east: document order is kept and the board
  // renders both neutrally.
  const aIsWest = doc.sideA.backer === "west";
  const bIsWest = doc.sideB.backer === "west";
  const backed = doc.sideA.backer != null || doc.sideB.backer != null;
  const [westSide, eastSide] = bIsWest ? [doc.sideB, doc.sideA] : [doc.sideA, doc.sideB];

  // `lean` reads 0 = fully West-held … 100 = fully East-held, so it is the EASTERN
  // side's share of the host — which is `control` when side B is the eastern one.
  const lean = !backed ? null : aIsWest ? doc.control : 100 - doc.control;

  const anchor = anchorOf(doc.hostCountry);
  let x: number | null = null;
  let y: number | null = null;
  if (anchor) {
    const [px, py] = projectLonLat(anchor[0], anchor[1]);
    x = (px / 1000) * 100;
    y = (py / 394.4) * 100;
  }

  const clock: CalendarClock | undefined =
    opts.preIterationTurns != null || opts.preIterationActive
      ? {
          preIterationTurns: opts.preIterationTurns,
          preIterationActive: opts.preIterationActive,
        }
      : undefined;
  const startYear = yearOfTurn(doc.startTurn, opts.startingYear, clock);
  const years =
    doc.endTurn != null
      ? `${startYear} – ${yearOfTurn(doc.endTurn, opts.startingYear, clock)}`
      : `${startYear} – present`;

  const occupier = occ.occupier === "A" ? doc.sideA : occ.occupier === "B" ? doc.sideB : null;
  // The raw id is deliberate here and pinned by a test: the hub board's cards are a
  // code-first surface ("NATO holds 30% of CN"), unlike the conflict RECORD page, whose
  // prose resolves the host through `entityName`. A proxy host reads as SVN, which is
  // the same idiom every other card uses.
  const status = occupier
    ? `${occupier.label} holds ${occ.occupier === "A" ? occ.pctA : occ.pctB}% of ${doc.hostCountry}`
    : `Contested — ${doc.sideA.label} ${occ.pctA}% / ${doc.sideB.label} ${occ.pctB}%`;

  return {
    id: doc._id,
    conflictId: doc.conflictId,
    name: doc.name,
    type: doc.type,
    region: getRegion(doc.region)?.name ?? doc.region,
    years,
    x,
    y,
    lean,
    west: westSide.label,
    east: eastSide.label,
    sev: severityOf(doc),
    intensity: doc.intensity,
    status,
    deaths:
      opts.casualties > 0
        ? `${opts.casualties.toLocaleString("en-US")} casualties`
        : "No engagements",
    escalating: doc.status === "escalating",
  };
}
