import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { shareOf, type Side } from "@/lib/military/occupation";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

/**
 * War-related national approval modifiers.
 *
 * Pure scoring only — no database, no React. The provider that reads conflicts
 * and personnel lives alongside these functions; everything here takes numbers
 * and returns numbers so the behaviour can be pinned by tests rather than by
 * prose. That split is deliberate: this design's defects have consistently been
 * in state written on one path and read on another, and in arithmetic argued
 * rather than executed.
 *
 * Plan: the War Approval Modifiers artifact (rev. 9).
 */

/** Round to one decimal. Chips render `effect` raw, so a repeating fraction would print in full. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Approval cost of a war's duration, measured from the turn THIS country
 * entered rather than from the turn the war began.
 *
 * +1 while the war is fresh and the public is behind it, falling one point per
 * in-game year to a floor of -25 after 26 years (about 52 real days, since a
 * turn is an hour of wall clock).
 *
 * The floor is deliberately far outside the "max +/-2" scale in the
 * approvalModifiers header: a war a nation has carried for twenty-six years is
 * meant to be politically ruinous. This is a settled product decision that has
 * twice been revised down and twice been reinstated — do not "correct" it.
 *
 * Continuous rather than stepped, so the block never moves faster than about
 * 0.02 per turn and damping never has to fight it.
 */
export const WAR_EXHAUSTION_FLOOR = -25;

export function warExhaustion(turnsSinceEntry: number): number {
  return round1(clamp(1 - turnsSinceEntry / TURNS_PER_YEAR, WAR_EXHAUSTION_FLOOR, 1));
}

/** How far war effort can swing in either direction. */
export const WAR_EFFORT_BOUND = 2;
const POSITION_WEIGHT = 1.4;
const MOMENTUM_WEIGHT = 0.6;
/** Turns at which the front is "expected" to have reached its half-way expectation. */
const EXPECTATION_TURNS = 4 * TURNS_PER_YEAR;
const EXPECTATION_CAP = 0.5;
/** Momentum is displacement over this many turns; a stale sample is scaled to it. */
const MOMENTUM_WINDOW = 24;
/** Held-share points of movement inside the window that count as full momentum. */
const MOMENTUM_SPAN = 25;

export interface WarEffortInput {
  /** The conflict's live `control` — side B's share of the host, 0-100. */
  control: number;
  /** `control` as it stood when THIS country entered, not when the war began. */
  entryControl: number;
  side: Side;
  /** Turns since this country entered, which is also its expectation clock. */
  turnsSinceEntry: number;
  /** Current turn; only needed to age the trailing sample. */
  turn?: number;
  /** Trailing control reading, refreshed when a battle resolves. */
  sample?: { turn: number; control: number };
}

/**
 * How well a country's war is going, as approval.
 *
 * Two terms. `position` is signed movement of the front from the country's own
 * entry baseline, normalised by the room available in the direction actually
 * travelled. `momentum` is recent displacement expressed as a rate, so it lifts
 * a live advance and fades to nothing when the front stalls — which is what
 * makes the score plateau at whatever the current ground warrants rather than
 * needing a decaying bonus bolted on.
 *
 * Both are scored against an EXPECTATION rather than against the side's own
 * pole, and that is the load-bearing idea. Territory alone bounds an attacker
 * to [0, +1] and a defender to [-1, 0], because a single-host `control` track
 * holds one pot of ground and the defender opens holding all of it — so war
 * effort would be a one-way subsidy for aggression, and a government could
 * never gain approval for winning a civil war. Expectation is positive for a
 * side that starts with nothing (it is supposed to advance), negative for one
 * holding everything, and exactly zero at a 50/50 proxy front where stalemate
 * IS the expectation. One continuous formula, no branching on conflict type.
 *
 * Consequently a defender who holds the line scores positive, a stalled
 * invasion scores negative, and a proxy war pays both patrons symmetrically.
 */
export function warEffort(input: WarEffortInput): number {
  const { control, entryControl, side, turnsSinceEntry, turn, sample } = input;

  const held = shareOf(control, side) * 100;
  const start = shareOf(entryControl, side) * 100;

  const gain = held - start;
  const span = gain >= 0 ? 100 - start : start;
  const position = span > 0 ? gain / span : 0;

  const pace = Math.min(EXPECTATION_CAP, turnsSinceEntry / EXPECTATION_TURNS);
  const expected = (0.5 - start / 100) * 2 * pace;

  let momentum = 0;
  if (sample && turn !== undefined) {
    const elapsed = turn - sample.turn;
    if (elapsed > 0) {
      const sampleHeld = shareOf(sample.control, side) * 100;
      const rate = (held - sampleHeld) / (MOMENTUM_SPAN * (elapsed / MOMENTUM_WINDOW));
      momentum = clamp(rate, -1, 1);
    }
  }

  const raw = POSITION_WEIGHT * (position - expected) + MOMENTUM_WEIGHT * momentum;
  return round1(clamp(raw, -WAR_EFFORT_BOUND, WAR_EFFORT_BOUND));
}

/** How far alliance contribution can swing in either direction. */
export const ALLIANCE_CONTRIBUTION_BOUND = 1;
/** Turns after entry during which a country cannot be penalised for absence. */
export const ALLIANCE_GRACE_TURNS = 6;

export interface AllianceContributionInput {
  /** Personnel this country has deployed to this conflict's theatre. */
  mine: number;
  /** Theatre personnel for every country on this side, INCLUDING this one. */
  peers: number[];
  /** Turns since this country was pulled into the war. */
  turnsSinceEntry: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Whether a country dragged into a war by a mutual-defence treaty is actually
 * fighting it, scored against what its co-belligerents are fielding.
 *
 * The denominator is the MEDIAN peer, not the mean. Theatre personnel is
 * heavily tailed — the principal carries most of it — so a mean sits far above
 * the typical member and reads an ordinary small ally as a shirker, which put
 * the modal outcome near the floor. Against the median, pulling your weight is
 * neutral, falling short is negative, and only genuine over-contribution pays.
 *
 * Returns `null` when the modifier should not appear at all: within the grace
 * window a country cannot be penalised for forces that could not yet have
 * arrived, though a bonus earned there still applies.
 */
export function allianceContribution(input: AllianceContributionInput): number | null {
  const { mine, peers, turnsSinceEntry } = input;

  const fair = median(peers);
  const ratio = fair > 0 ? mine / fair : 0;
  const value = round1(clamp(ratio - 1, -ALLIANCE_CONTRIBUTION_BOUND, ALLIANCE_CONTRIBUTION_BOUND));

  if (turnsSinceEntry < ALLIANCE_GRACE_TURNS && value < 0) return null;
  return value;
}

export interface WarPart {
  id: string;
  label: string;
  effect: number;
}

/**
 * Step the country's stored war total toward this turn's raw total.
 *
 * `prev` is seeded to 0 rather than left undefined on purpose. `dampApprovalStep`
 * adopts its target outright when there is no previous value, and conflicts that
 * predate this feature carry no per-country entry record — so an original
 * belligerent in a long-running war would bill from `conflict.startTurn` and land
 * its whole accumulated exhaustion in one undamped turn the day this ships.
 *
 * At peace the caller passes a raw of 0, so the same step retires the block
 * gradually instead of letting it vanish between one turn and the next.
 *
 * Deliberately a local implementation rather than an import of `dampApprovalStep`:
 * `governmentApproval.ts` imports this module, so reaching back into it for the
 * helper would close a module cycle.
 */
export const WAR_TOTAL_MAX_STEP = 2;

export function stepWarTotal(
  prev: number | undefined,
  raw: number,
  maxStep: number = WAR_TOTAL_MAX_STEP
): number {
  const from = Number.isFinite(prev) ? (prev as number) : 0;
  const delta = raw - from;
  if (Math.abs(delta) <= maxStep) return round1(raw);
  return round1(from + Math.sign(delta) * maxStep);
}

/**
 * The war block as a single approval chip.
 *
 * One chip, not three. Attributing a damped total back across separate parts
 * inverts whenever the total and the raw sum have opposite signs, and drops
 * every chip during peace retirement while the rating is still moving — both of
 * which reintroduce "the chips do not add up to the number" inside the mechanism
 * meant to prevent it. A single chip whose effect IS the applied total cannot
 * disagree with the rating; the parts ride along undamped for the tooltip.
 */
export function buildWarModifier(applied: number, parts: WarPart[]): ActiveModifier | null {
  const effect = round1(applied);
  if (effect === 0 || !Number.isFinite(effect)) return null;
  return {
    id: "war",
    label: "War",
    effect,
    marginEffect: 0,
    source: "war",
    breakdown: parts.filter((part) => part.effect !== 0),
  };
}
