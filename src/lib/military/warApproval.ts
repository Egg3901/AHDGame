import type { Db } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CountryId } from "@/lib/constants/countries";
import { listConflictsForCountry } from "@/lib/db/collections/conflicts";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import type { ConflictDoc } from "@/lib/db/types/conflict";
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
  /**
   * Turn this country entered. The sample belongs to the CONFLICT, not to any
   * one belligerent, so a sample older than this is discarded: a country that
   * joined last week must not be credited with an advance its side made before
   * it arrived.
   */
  entryTurn?: number;
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
  const { control, entryControl, side, turnsSinceEntry, turn, sample, entryTurn } = input;

  const held = shareOf(control, side) * 100;
  const start = shareOf(entryControl, side) * 100;

  const gain = held - start;
  const span = gain >= 0 ? 100 - start : start;
  const position = span > 0 ? gain / span : 0;

  // Floored at zero: a reseed or an admin rewind can move the clock backwards,
  // and a negative age would run the expectation in reverse — crediting an
  // attacker for ground it has not taken and penalising a defender for holding.
  const pace = clamp(turnsSinceEntry / EXPECTATION_TURNS, 0, EXPECTATION_CAP);
  const expected = (0.5 - start / 100) * 2 * pace;

  let momentum = 0;
  const sampleIsOurs = sample && (entryTurn === undefined || sample.turn >= entryTurn);
  if (sample && sampleIsOurs && turn !== undefined) {
    const elapsed = turn - sample.turn;
    if (elapsed > 0) {
      const sampleHeld = shareOf(sample.control, side) * 100;
      // The divisor is flat inside the window and only grows beyond it. Scaling
      // by raw elapsed would make momentum hyper-sensitive right after a
      // refresh — a five point battle reads as full momentum one turn after the
      // sample was taken and a fifth of that twenty-four turns later, so the
      // same engagement is worth wildly different approval depending only on
      // where in the refresh cycle it happened to land. Flat inside the window
      // makes an identical advance score identically; growing outside it keeps
      // a stale sample from crediting movement it is too old to measure.
      const age = Math.max(elapsed, MOMENTUM_WINDOW);
      const rate = (held - sampleHeld) / (MOMENTUM_SPAN * (age / MOMENTUM_WINDOW));
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
  // A side where more than half the members sent nothing has a median of zero,
  // and dividing by it would score EVERY member at the floor — including the one
  // actually fighting the war. When the typical ally contributes nothing,
  // contributing anything is carrying the coalition.
  const ratio = fair > 0 ? mine / fair : mine > 0 ? 2 : 0;
  const value = round1(clamp(ratio - 1, -ALLIANCE_CONTRIBUTION_BOUND, ALLIANCE_CONTRIBUTION_BOUND));

  if (turnsSinceEntry < ALLIANCE_GRACE_TURNS && value < 0) return null;
  return value;
}

export type ControlSample = { turn: number; control: number };

/**
 * The trailing sample to persist, or `undefined` to leave the stored one alone.
 *
 * Called from `applyOccupation` — the only writer of `control` — ABOVE its early
 * return, so a turn on which the front did not move still ages the sample out.
 * Otherwise a stalled front keeps a sample that grows arbitrarily old and
 * dilutes any movement that eventually happens.
 *
 * A sample stamped in the future is replaced rather than trusted: a reseed or an
 * admin rewind can move the clock backwards, and a negative elapsed would
 * otherwise invert the momentum term.
 */
export function nextControlSample(
  current: ControlSample | undefined,
  turn: number,
  control: number
): ControlSample | undefined {
  if (!current) return { turn, control };
  const elapsed = turn - current.turn;
  if (elapsed >= MOMENTUM_WINDOW || elapsed < 0) return { turn, control };
  return undefined;
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
export function buildWarModifier(
  applied: number,
  parts: WarPart[],
  atPeace = false
): ActiveModifier | null {
  const effect = round1(applied);
  if (effect === 0 || !Number.isFinite(effect)) return null;
  return {
    id: "war",
    // The block retires at two points a turn, so a country can sit at peace for
    // up to fourteen turns still carrying it, with no live war behind it and
    // therefore no breakdown to show. Saying "War" there leaves a nation that
    // is no longer fighting anyone displaying a war penalty it cannot account
    // for. `atPeace` is passed explicitly rather than inferred from empty
    // parts, because the failure path also has no parts and a failed read is
    // not peace: that war may well still be running.
    label: atPeace ? "War (winding down)" : "War",
    effect,
    marginEffect: 0,
    source: "war",
    breakdown: parts.filter((part) => part.effect !== 0),
  };
}

export interface WarApprovalResult {
  modifiers: ActiveModifier[];
  /** The block total to persist as `warApprovalTotal`. */
  total: number;
}

/** Which side's roster holds this country, or null when it is not a belligerent. */
function rosterSideOf(conflict: ConflictDoc, countryId: CountryId): Side | null {
  if ((conflict.sideA.countries as string[]).includes(countryId)) return "A";
  if ((conflict.sideB.countries as string[]).includes(countryId)) return "B";
  return null;
}

/**
 * When this country entered, and where the front stood then.
 *
 * `joinTurns` first, because it is the only complete entry ledger — `treatyEntries`
 * records treaty-pulled allies alone, so a country that declared into an existing
 * war has no entry there. Founding belligerents appear in neither and fall back to
 * the conflict's own opening, which is correct for them.
 */
function entryOf(conflict: ConflictDoc, countryId: CountryId): { turn: number; control: number } {
  const control = conflict.controlStart ?? conflict.control;
  const joined = conflict.joinTurns?.find((entry) => entry.countryId === countryId);
  // `?? control` rather than trusting the stamp: a half-written entry would
  // otherwise put `undefined` through shareOf and make the whole block NaN.
  if (joined) return { turn: joined.turn, control: joined.control ?? control };
  const treaty = conflict.treatyEntries?.find((entry) => entry.countryId === countryId);
  if (treaty) return { turn: treaty.joinedTurn, control };
  return { turn: conflict.startTurn, control };
}

/**
 * The war approval block for one country, damped and ready to persist.
 *
 * Selects a single conflict — the one this country has personally fought longest,
 * ranked by its own entry turn so the choice agrees with the exhaustion clock.
 * One war per country is deliberate: summing exhaustion across simultaneous wars
 * would run past the settled floor, and duplicate modifier ids would stack in
 * `applyModifiers` and collide on the React key in the chip list.
 *
 * Never throws. It runs inside `runPhase("approvalSnapshot", ...)` for every
 * active country in a single `Promise.all`, so an unguarded failure would take
 * the approval snapshot down for every country rather than one. On failure the
 * previous total is held rather than zeroed, since a transient error reading as
 * "target zero" would walk the block down at the damping step and back up again.
 */
export async function computeWarApproval(
  db: Db,
  countryId: CountryId,
  turn: number,
  prevTotal: number | undefined
): Promise<WarApprovalResult> {
  const previous = Number.isFinite(prevTotal) ? (prevTotal as number) : 0;

  try {
    const live = await listConflictsForCountry(db, countryId);
    const mine = live
      // Liveness is already in the query, and is re-checked here on purpose.
      // `resolveConflict` stamps `status` and `endTurn` but never deletes the
      // document, so a war that ended keeps matching every other predicate
      // forever — and because `turn - entry` only grows, a resolved war would
      // walk a country to the exhaustion floor and hold it there permanently.
      // A silent, unrecoverable failure is worth two lines of defence.
      .filter((conflict) => conflict.status !== "resolved")
      .map((conflict) => ({ conflict, side: rosterSideOf(conflict, countryId) }))
      .filter((row): row is { conflict: ConflictDoc; side: Side } => row.side !== null)
      .map((row) => ({ ...row, entry: entryOf(row.conflict, countryId) }))
      // Longest personally fought first, then by id. The id tiebreak is not
      // cosmetic: `find()` without a sort has no guaranteed order, so two wars
      // entered on the same turn could swap places between turns and swing the
      // block from one front's score to the other's. Selection must be total.
      .sort((a, b) => a.entry.turn - b.entry.turn || a.conflict._id.localeCompare(b.conflict._id));

    const principal = mine[0];
    // No live war: target zero and let the damping step walk the block out.
    if (!principal) return settle(previous, 0, [], true);

    const { conflict, side, entry } = principal;
    const turnsSinceEntry = Math.max(0, turn - entry.turn);

    const parts: WarPart[] = [
      {
        id: "war_effort",
        label: "War effort",
        effect: warEffort({
          control: conflict.control,
          entryControl: entry.control,
          side,
          turnsSinceEntry,
          turn,
          sample: conflict.controlSample,
          entryTurn: entry.turn,
        }),
      },
      { id: "war_exhaustion", label: "War exhaustion", effect: warExhaustion(turnsSinceEntry) },
    ];

    const pulledIn = conflict.treatyEntries?.some((e) => e.countryId === countryId) ?? false;
    if (pulledIn) {
      const peers = (
        side === "A" ? conflict.sideA.countries : conflict.sideB.countries
      ) as CountryId[];
      const byCountry = await theatrePersonnel(db, conflict._id, peers);
      const contribution = allianceContribution({
        mine: byCountry.get(countryId) ?? 0,
        peers: peers.map((peer) => byCountry.get(peer) ?? 0),
        turnsSinceEntry,
      });
      if (contribution !== null) {
        parts.push({
          id: "alliance_contribution",
          label: "Alliance contribution",
          effect: contribution,
        });
      }
    }

    const raw = parts.reduce((sum, part) => sum + part.effect, 0);
    return settle(previous, raw, parts);
  } catch (error) {
    console.error("[warApproval] scoring failed, holding previous total:", error);
    return settle(previous, previous, []);
  }
}

function settle(
  previous: number,
  raw: number,
  parts: WarPart[],
  atPeace = false
): WarApprovalResult {
  // A corrupt conflict document (a non-finite `control`, say) would otherwise
  // carry NaN through the clamps, through the damping step, and into
  // governmentApprovals — where it poisons every rating computation downstream
  // until something overwrites it. Fall back to holding the previous total,
  // which is the same thing the failure path does.
  const safeRaw = Number.isFinite(raw) ? raw : previous;
  const stepped = stepWarTotal(previous, safeRaw);
  const total = Number.isFinite(stepped) ? stepped : 0;
  const finiteParts = parts.filter((part) => Number.isFinite(part.effect));
  const modifier = buildWarModifier(total, finiteParts, atPeace);
  return { modifiers: modifier ? [modifier] : [], total };
}

/** Theatre personnel per country, for the countries on one side of one conflict. */
async function theatrePersonnel(
  db: Db,
  theaterId: string,
  countries: CountryId[]
): Promise<Map<CountryId, number>> {
  const units = await getMilitaryUnitsCollection(db)
    .find(
      { theaterId, countryId: { $in: countries } },
      { projection: { countryId: 1, personnel: 1 } }
    )
    .toArray();

  const byCountry = new Map<CountryId, number>();
  for (const unit of units) {
    const personnel = Number.isFinite(unit.personnel) ? unit.personnel : 0;
    byCountry.set(unit.countryId, (byCountry.get(unit.countryId) ?? 0) + Math.max(0, personnel));
  }
  return byCountry;
}
