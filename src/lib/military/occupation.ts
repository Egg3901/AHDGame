import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import { blocOf, type BlocLookup } from "@/lib/military/bloc";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { OCCUPATION } from "./config";

/**
 * Territorial math for a conflict. Pure — no DB, no React.
 *
 * `ConflictDoc.control` is the share of the HOST country's territory held by side B:
 * 0 = side A holds all of it, 100 = side B holds all of it. A conflict starts at the
 * host's own pole when the host is a belligerent, and split when it is not.
 *
 * Spec: docs/superpowers/specs/2026-07-26-occupation-territory-design.md
 */

export type Side = "A" | "B";

/**
 * Which side a country fights on here: explicit roster membership first, then a
 * UNIQUE match between the country's bloc and the sides' backers. Null when neither
 * resolves — the caller fights the battle normally but moves no ground.
 *
 * `blocs` is the era's live roll (`loadMilitaryBlocs`), passed in rather than looked up
 * so this stays pure. It used to be a global read against a static 9-entry table whose
 * unknown-country fallback was the US row, which quietly enrolled every Warsaw Pact
 * member it had never heard of into NATO. A `nonAligned` country matches no backer and
 * so lands on neither side, which is the honest answer.
 */
export function sideOf(
  c: Pick<ConflictDoc, "sideA" | "sideB">,
  countryId: string,
  blocs: BlocLookup
): Side | null {
  const id = countryId as CountryId;
  if (c.sideA.countries.includes(id)) return "A";
  if (c.sideB.countries.includes(id)) return "B";
  // The faction itself, by exact id. This is the PERMISSIVE resolver — it already
  // places unrostered bloc members by backer — so the clause grants placement to the
  // named faction and to nobody else. Without it a proxy war's target resolves to no
  // side, the offensive is built with `side: null`, and the walkover branch skips
  // `joinSide` and `applyOccupation` together: control never moves, silently.
  if (c.sideA.factionEntity === countryId) return "A";
  if (c.sideB.factionEntity === countryId) return "B";
  const bloc = blocOf(blocs, countryId);
  const a = c.sideA.backer === bloc;
  const b = c.sideB.backer === bloc;
  if (a && !b) return "A";
  if (b && !a) return "B";
  return null;
}

/**
 * Are these two countries DECLARED belligerents against each other here?
 *
 * Roster membership only — deliberately NOT `sideOf`. `sideOf` falls back to a bloc
 * match against the sides' backers, which is right for "whose ground does this unit
 * take" but wrong for "are these two at war": it would call any two bloc rivals
 * opposed in every war their patrons back. A country pulled toward a side by affinity
 * has not declared war on anyone.
 *
 * (#4001 made that fallback honest — a nonAligned country now matches no backer
 * instead of silently falling into the US row. That removed the loudest failure mode,
 * not the reason for this helper: bloc affinity still is not a declaration.)
 *
 * Used for the one-war-per-pair rule and for revalidating a peace offer.
 */
export function opposedBelligerents(
  c: Pick<ConflictDoc, "sideA" | "sideB">,
  x: string,
  y: string
): boolean {
  const a = c.sideA.countries as string[];
  const b = c.sideB.countries as string[];
  return (a.includes(x) && b.includes(y)) || (b.includes(x) && a.includes(y));
}

/**
 * Which side holds the host country: the side fighting on its own soil. Undefined when
 * the host belongs to neither, which is every proxy war (its host is a world entity
 * that is never a belligerent) and any ground neither side owns.
 *
 * Rosters are CountryId[]; the host may be a world entity that is not one. Widen the
 * COMPARISON rather than the roster. Optional chaining because a trimmed or legacy
 * document may carry no rosters at all.
 */
export function hostSideOf(
  hostCountry: WorldEntityId,
  sideA: Pick<ConflictSide, "countries"> | undefined,
  sideB: Pick<ConflictSide, "countries"> | undefined
): Side | undefined {
  if ((sideA?.countries as string[] | undefined)?.includes(hostCountry)) return "A";
  if ((sideB?.countries as string[] | undefined)?.includes(hostCountry)) return "B";
  return undefined;
}

/** The `control` a conflict is born at — the host's own side holds all of its soil. */
export function initialControl(
  hostCountry: WorldEntityId,
  sideA: ConflictSide,
  sideB: ConflictSide
): number {
  const host = hostSideOf(hostCountry, sideA, sideB);
  return host === "A" ? 0 : host === "B" ? 100 : 50;
}

/** A side's share (0–1) of the host country's territory. */
export function shareOf(control: number, side: Side): number {
  return side === "B" ? control / 100 : 1 - control / 100;
}

/**
 * How far the front has travelled from its starting line toward the pole it is
 * heading for, 0–1. Measured from the START, not from the middle of the track: an
 * interstate war OPENS with the defender holding all of its own soil, so an
 * absolute-share reading would call every invasion "deep" before the first shot.
 */
export function frontProgress(control: number, controlStart: number): number {
  const span = control < controlStart ? controlStart : 100 - controlStart;
  return span > 0 ? Math.abs(control - controlStart) / span : 0;
}

/**
 * How far the front has moved in ONE side's favour, 0..1.
 *
 * `frontProgress` above is direction-agnostic: it measures the distance travelled
 * from the starting line whichever way the line went. That is the right answer to
 * "how deep is this war", and the wrong answer to "am I winning", which is the
 * question a side asks before demanding anything of the other. A side the line has
 * moved AGAINST reads zero here rather than reading its opponent's gains as its own.
 *
 * Measured from the starting line for the same reason `frontProgress` is: an
 * interstate war opens with the defender holding all of its own soil, so an
 * absolute-share reading would call every invasion deep before the first shot.
 */
export function progressForSide(side: Side, control: number, controlStart: number): number {
  // Side A wins as control falls toward 0; side B as it rises toward 100.
  const gained = side === "A" ? controlStart - control : control - controlStart;
  if (gained <= 0) return 0;
  return frontProgress(control, controlStart);
}

export interface ShiftInput {
  control: number;
  winner: Side;
  /** The battle's margin; magnitude is used, so either sign is accepted. */
  margin: number;
  /** True when the LOSING side broke off rather than fighting the engagement out. */
  loserRetreated: boolean;
  /**
   * Turns since the war opened, for the mobilisation ramp (see
   * `OCCUPATION.mobilizationTurns`). Omitted means no ramp: a caller that does not
   * know the war's age must not silently damp the front, and every existing test
   * that omits it keeps its exact previous result.
   */
  turnsElapsed?: number;
}

/**
 * How much of a normal advance the front is worth this early in the war.
 *
 * 1 when the age is unknown, so this can only ever slow a front the caller has
 * dated. Clamped at both ends: a negative age (clock skew, a repaired document)
 * reads as turn zero rather than reversing the front.
 */
export function mobilizationFactor(turnsElapsed?: number): number {
  // NON-FINITE IS "UNKNOWN", and the guard is not theoretical. `startTurn` is typed
  // required on `ConflictDoc`, but a document written before it existed does not have
  // one, and `currentTurn - undefined` is NaN. That NaN multiplied straight through
  // `occupationShift` into `control`, so a war on a legacy record would have had its
  // front position written as NaN and every downstream comparison against it silently
  // gone false. Caught by battleResolution.test.ts, whose fixtures omit the field.
  if (turnsElapsed == null || !Number.isFinite(turnsElapsed)) return 1;
  const t = Math.max(0, turnsElapsed);
  const { mobilizationTurns: span, mobilizationFloor: floor } = OCCUPATION;
  if (span <= 0) return 1;
  return Math.min(1, floor + (1 - floor) * (t / span));
}

/**
 * `control` after an engagement. A decisive win takes the full step; narrower wins
 * scale down; a loser who withdrew in order yields less.
 *
 * There used to be a third drag here: the step halved once the winner held
 * `deepPushDepth` of the host. Keyed on the winner, it halved the attacker's wins
 * past that mark but not the defender's, so on a near-even front the line drifted
 * back faster than it advanced: a wall, not a slowdown, on top of the supply
 * penalties that already compound with distance from the start line
 * (`derivedSupply` below, applied to throughput in `battle.ts`). It was removed;
 * the report is `scripts/sim/reports/control-drift-deep-push.md`. `deepPushDepth`
 * itself survives for the winding-down status and the peace-offer threshold, which
 * read progress from the START line, not the winner's share.
 */
export function occupationShift({
  control,
  winner,
  margin,
  loserRetreated,
  turnsElapsed,
}: ShiftInput): number {
  let shift = Math.min(1, Math.abs(margin) / OCCUPATION.decisiveMargin) * OCCUPATION.maxShift;
  if (loserRetreated) shift *= OCCUPATION.retreatYield;
  shift *= mobilizationFactor(turnsElapsed);
  const next = winner === "B" ? control + shift : control - shift;
  return Math.max(0, Math.min(100, next));
}

/**
 * One side's supply, derived from how far the front has moved FROM ITS START.
 * `gain` is that side's ground change as a fraction of the full track (−1 … 1):
 * negative is compression into a pocket, positive is overextension.
 */
export function derivedSupply(baseline: number, gain: number): number {
  const penalty =
    gain < 0 ? OCCUPATION.compressionPenalty * -gain : OCCUPATION.overextensionPenalty * gain;
  return Math.max(OCCUPATION.minSupply, Math.min(100, Math.round(baseline - penalty)));
}

export type SupplyInput = Pick<ConflictDoc, "control" | "supplyA" | "supplyB"> &
  Partial<Pick<ConflictDoc, "controlStart" | "supplyBaseA" | "supplyBaseB">>;

/**
 * Both sides' supply for the current front position. Derived rather than
 * accumulated, so a front that swings back also recovers its supply. Conflicts
 * created before the baselines existed fall back to their live values.
 */
export function derivedSupplies(c: SupplyInput): { supplyA: number; supplyB: number } {
  const gainB = (c.control - (c.controlStart ?? 50)) / 100;
  return {
    supplyA: derivedSupply(c.supplyBaseA ?? c.supplyA, -gainB),
    supplyB: derivedSupply(c.supplyBaseB ?? c.supplyB, gainB),
  };
}

export type OccupationInput = Pick<ConflictDoc, "hostCountry" | "control" | "sideA" | "sideB">;

export interface OccupationView {
  /** The country whose soil is contested. May be a non-playable world entity. */
  host: WorldEntityId;
  /** The side standing on foreign soil, or null when the host is on neither side. */
  occupier: Side | null;
  /** Percent of the host held by each side; integers summing to 100. */
  pctA: number;
  pctB: number;
}

/** The readout: who holds how much of the host, and who is the occupier. */
export function occupationOf(c: OccupationInput): OccupationView {
  const pctB = Math.round(c.control);
  // Same widening as `initialControl`: the host may not be a CountryId at all.
  const hostOnA = (c.sideA.countries as string[]).includes(c.hostCountry);
  const hostOnB = (c.sideB.countries as string[]).includes(c.hostCountry);
  return {
    host: c.hostCountry,
    occupier: hostOnA ? "B" : hostOnB ? "A" : null,
    pctA: 100 - pctB,
    pctB,
  };
}
