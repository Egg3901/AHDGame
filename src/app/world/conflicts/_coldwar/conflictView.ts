import type { ConflictDoc } from "@/lib/db/types/conflict";
import { occupationOf } from "@/lib/military/occupation";
import { anchorOf } from "@/lib/maps/countryAnchors";
import { getRegion } from "@/lib/military/regions";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
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

/** The in-game year a turn falls in. Mirrors gameTime's calendar derivation. */
export function yearOfTurn(turn: number, startingYear: number): number {
  return startingYear + Math.floor(Math.max(0, turn - 1) / TURNS_PER_YEAR);
}

/** The board's severity rung. A winding-down war reads as that whatever its weight. */
function severityOf(doc: ConflictDoc): Severity {
  if (doc.status === "winding_down") return "WINDING DOWN";
  return doc.severity === "HIGH" ? "CRITICAL" : doc.severity === "MEDIUM" ? "MAJOR" : "ACTIVE";
}

export interface ConflictViewOptions {
  /** The game's starting year, for dating a conflict from its start turn. */
  startingYear: number;
  /** Cumulative casualties across this conflict's resolved battles. */
  casualties: number;
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

  const startYear = yearOfTurn(doc.startTurn, opts.startingYear);
  const years =
    doc.endTurn != null
      ? `${startYear} – ${yearOfTurn(doc.endTurn, opts.startingYear)}`
      : `${startYear} – present`;

  const occupier = occ.occupier === "A" ? doc.sideA : occ.occupier === "B" ? doc.sideB : null;
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
