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
 * The original closed-form exhaustion curve, kept as the SEED for the integrator
 * that replaced it. Exhaustion is now carried between wars by
 * `stepWarExhaustion`; this function is what a country already fighting when
 * that shipped starts from, so nothing jumps on the first turn.
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
 * 0.02 per turn — which is what lets the block be applied undamped.
 */
export const WAR_EXHAUSTION_FLOOR = -25;

export function warExhaustion(turnsSinceEntry: number): number {
  return round1(clamp(1 - turnsSinceEntry / TURNS_PER_YEAR, WAR_EXHAUSTION_FLOOR, 1));
}

/**
 * Exhaustion moves one point per in-game year, in BOTH directions.
 *
 * The same slope the formula above accrues at, run in reverse once the fighting
 * stops. Symmetry is the point: a war that took four years to sour takes four
 * years of peace to be forgiven.
 */
export const WAR_EXHAUSTION_RATE = 1 / TURNS_PER_YEAR;

/**
 * Storage precision for the integrator.
 *
 * Full precision would write a twenty digit float to the document every turn,
 * but rounding too hard costs accuracy that compounds: every turn loses up to
 * half a unit of the last place, and a war runs for thousands of turns. Six
 * decimals keeps the drift over a war fought to the floor near a ten-thousandth
 * of a point, which is three orders of magnitude below what a chip can show.
 */
function roundStored(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Slack on the "one more step reaches zero" test, to absorb stored rounding.
 *
 * Each stored turn loses up to half a unit of the last decimal place, so after a
 * few hundred turns the integrator is no longer an exact multiple of the rate
 * and can sit a hair OUTSIDE its final step — stranding it one turn short and,
 * worse, one turn short forever if the drift lands the wrong way. Three decimals
 * is far larger than any drift a war can accumulate and far smaller than the
 * tenth a chip renders, so it ends the heal on the turn it is due and is
 * invisible either side of that.
 */
const HEAL_SNAP_TOLERANCE = 1e-3;

export interface WarExhaustionStep {
  /** The stored integrator, or undefined for a country that has never fought. */
  prev: number | undefined;
  /** The conflict this country is currently fighting, or null at peace. */
  conflictId: string | null;
  /** The conflict the stored value was last accrued against. */
  prevConflictId: string | null | undefined;
  /** Turns since this country entered its current war. Ignored at peace. */
  turnsSinceEntry: number;
}

/**
 * Step the persisted exhaustion integrator one turn.
 *
 * Exhaustion is the one war term that outlives its war. The rest describe a
 * front that no longer exists the moment the fighting stops, but a public that
 * has carried four years of casualties does not forget the week the treaty is
 * signed — and a government that could end a war and immediately start another
 * with a clean slate had a free hand no cost ever caught up with.
 *
 * Four cases, in the order they are checked:
 *
 *  - **Never scored, and at war.** Seed from the original closed-form curve so a
 *    country already fighting when this shipped keeps the exact value it had.
 *    Without this the rally below would fire on an existing war and hand a
 *    nation forty turns deep a fresh +1. Self migrating: no backfill script, and
 *    a country that has never fought simply starts at zero.
 *  - **Entering a war from peace.** Rally round the flag: +1 on top of whatever
 *    residue is carried, capped at +1. A clean slate opens at +1 exactly as
 *    before; a country restarting at -3 opens at -2.
 *
 *    The test is "was this country at peace last turn", which is what a null
 *    stored conflict id means — NOT "is this a different war from the stored
 *    one". A country fighting two wars at once whose older war resolves has its
 *    principal conflict change underneath it without the fighting ever stopping,
 *    and paying a fresh rally there would hand out +1 for ending a war while
 *    still at war: a smaller version of the very exploit the cooldown closes.
 *    A country that goes straight from one war into another with no turn of
 *    peace between them likewise gets no rally, which is the harsher reading and
 *    the right one.
 *  - **Same war, or a new war entered without a break.** Down one point per
 *    in-game year, to the floor.
 *  - **At peace.** One point per in-game year toward zero, from whichever side
 *    it is carried. Peace heals a war's cost and also retires the rally a short
 *    war left behind; it never earns approval of its own in either direction.
 */
export function stepWarExhaustion(input: WarExhaustionStep): number {
  const { prev, conflictId, prevConflictId, turnsSinceEntry } = input;

  if (conflictId === null) {
    const carried = prev ?? 0;
    // Toward zero from WHICHEVER side. A war that ended inside its first year
    // leaves a positive rally behind, and that has to fade at the same pace a
    // penalty does. Adding the rate unconditionally would have carried a
    // positive further from zero and then cut it to nothing in a single turn,
    // dropping half a point of approval on the turn peace was signed.
    //
    // Landing ON zero matters beyond tidiness: "fully healed" is an equality
    // test — `guestsToRelease` and the snapshot's own bookkeeping both compare
    // against exactly zero — and rounding the stored value each turn loses a
    // fraction of the rate, so a value that merely approaches zero never gets
    // there. Anything within one turn's movement finishes now.
    if (Math.abs(carried) <= WAR_EXHAUSTION_RATE + HEAL_SNAP_TOLERANCE) return 0;
    return roundStored(carried > 0 ? carried - WAR_EXHAUSTION_RATE : carried + WAR_EXHAUSTION_RATE);
  }
  if (prev === undefined || !Number.isFinite(prev)) {
    return roundStored(warExhaustion(turnsSinceEntry));
  }
  // Null (or a document written before this field existed) means at peace, which
  // is the only state a rally can be entered from. See the block comment above.
  const wasAtPeace = prevConflictId === null || prevConflictId === undefined;
  if (wasAtPeace) {
    return roundStored(Math.min(1, prev + 1));
  }
  return roundStored(clamp(prev - WAR_EXHAUSTION_RATE, WAR_EXHAUSTION_FLOOR, 1));
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

/**
 * What is known about the country's war this turn.
 *
 *  - `live`    — fighting right now.
 *  - `peace`   — no live war; exhaustion is healing.
 *  - `unknown` — the conflict read threw, so the two cannot be told apart.
 *
 * `unknown` is not a synonym for `peace`. A failed read must not label the
 * lingering exhaustion "recovering", because that tells the player a war has
 * ended when all that actually happened is that the database had a bad moment,
 * and the war may well still be running.
 */
export type WarPhase = "live" | "peace" | "unknown";

export interface WarModifierInput {
  /** The stepped exhaustion integrator. */
  exhaustion: number;
  /** How the front is going, or null when there is no war to score. */
  effort: number | null;
  /** Alliance contribution, or null when it does not apply. */
  contribution: number | null;
  phase: WarPhase;
}

/**
 * The war block as one chip per term.
 *
 * This was a single chip carrying a damped total, because attributing a damped
 * total back across its parts inverts whenever the total and the raw sum have
 * opposite signs — "the chips do not add up to the number", inside the mechanism
 * meant to prevent exactly that. That objection is now gone rather than
 * overridden: exhaustion is a persisted integrator that cannot move faster than
 * one point per in-game year, and effort and contribution are bounded and
 * recomputed from the live front, so the block has nothing left that can jump
 * and needs no damping. With no damping there is no attribution to invert, and
 * each chip's effect IS its own contribution to the rating. They sum exactly.
 *
 * One chip per term is also what a player needs. A single line reading "War -4"
 * on a war a country is winning is actively misleading: the front is going well
 * and the public is simply tired, and those are opposite facts that a government
 * responds to in opposite ways. Three lines say which is which.
 *
 * Every chip declares `marginEffect: 0`. An unregistered id falls through to a
 * 0.75 factor in `marginEffectForModifier`, which would push a deep war penalty
 * into every region's profit margins — and splitting one chip into three
 * multiplies that trap rather than removing it.
 */
export function buildWarModifiers(input: WarModifierInput): ActiveModifier[] {
  const { exhaustion, effort, contribution, phase } = input;
  const live = phase === "live";
  const chip = (id: string, label: string, value: number): ActiveModifier => ({
    id,
    label,
    effect: round1(value),
    marginEffect: 0,
    source: "war",
  });

  const modifiers: ActiveModifier[] = [];

  // Exhaustion outlives its war, so it is the one term shown outside one. While
  // the fighting is live it shows even at zero: a country at war whose terms
  // happen to cancel must still see the war in its approval, which is the whole
  // reason the block was invisible on a nation forty two turns into the War for
  // Germany. Only a confirmed peace says "recovering" — see WarPhase.
  const exhaustionEffect = round1(exhaustion);
  if (Number.isFinite(exhaustionEffect) && (live || exhaustionEffect !== 0)) {
    modifiers.push(
      chip(
        "war_exhaustion",
        phase === "peace" ? "War exhaustion (recovering)" : "War exhaustion",
        exhaustionEffect
      )
    );
  }

  // The rest describe a front. Outside a live war there is no front to describe,
  // so they are simply absent rather than retired gradually.
  if (live && effort !== null && Number.isFinite(effort)) {
    modifiers.push(chip("war_effort", "War effort", effort));
  }
  if (live && contribution !== null && Number.isFinite(contribution)) {
    modifiers.push(chip("alliance_contribution", "Alliance contribution", contribution));
  }

  return modifiers;
}
export interface WarApprovalResult {
  modifiers: ActiveModifier[];
  /** The block total to persist as `warApprovalTotal`. Now simply the chip sum. */
  total: number;
  /** The stepped integrator to persist as `warExhaustion`, at full precision. */
  exhaustion: number;
  /** The conflict the exhaustion was accrued against, to persist alongside it. */
  conflictId: string | null;
}

/** What the caller has stored from last turn. */
export interface WarApprovalState {
  exhaustion?: number;
  conflictId?: string | null;
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
 * The war approval block for one country, stepped and ready to persist.
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
 * stored exhaustion is held exactly as it stands: a transient error must not
 * read as peace and start healing a war that is still being fought, nor as war
 * and accrue exhaustion against a front nobody could read.
 */
export async function computeWarApproval(
  db: Db,
  countryId: CountryId,
  turn: number,
  state: WarApprovalState | undefined
): Promise<WarApprovalResult> {
  const prevExhaustion = Number.isFinite(state?.exhaustion) ? state?.exhaustion : undefined;
  const prevConflictId = state?.conflictId ?? null;

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
    // At peace the exhaustion integrator keeps healing toward zero and the two
    // front terms simply stop existing. Nothing is retired gradually any more:
    // the front is gone, so there is nothing left to describe about it.
    if (!principal) {
      return settle({
        exhaustion: stepWarExhaustion({
          prev: prevExhaustion,
          conflictId: null,
          prevConflictId,
          turnsSinceEntry: 0,
        }),
        effort: null,
        contribution: null,
        phase: "peace",
        conflictId: null,
      });
    }

    const { conflict, side, entry } = principal;
    const turnsSinceEntry = Math.max(0, turn - entry.turn);

    const exhaustion = stepWarExhaustion({
      prev: prevExhaustion,
      conflictId: conflict._id,
      prevConflictId,
      turnsSinceEntry,
    });

    const effort = warEffort({
      control: conflict.control,
      entryControl: entry.control,
      side,
      turnsSinceEntry,
      turn,
      sample: conflict.controlSample,
      entryTurn: entry.turn,
    });

    let contribution: number | null = null;
    const pulledIn = conflict.treatyEntries?.some((e) => e.countryId === countryId) ?? false;
    if (pulledIn) {
      const peers = (
        side === "A" ? conflict.sideA.countries : conflict.sideB.countries
      ) as CountryId[];
      const byCountry = await theatrePersonnel(db, conflict._id, peers);
      contribution = allianceContribution({
        mine: byCountry.get(countryId) ?? 0,
        peers: peers.map((peer) => byCountry.get(peer) ?? 0),
        turnsSinceEntry,
      });
    }

    return settle({
      exhaustion,
      effort,
      contribution,
      phase: "live",
      conflictId: conflict._id,
    });
  } catch (error) {
    console.error("[warApproval] scoring failed, holding stored exhaustion:", error);
    // Hold everything exactly as stored. The front terms are dropped rather than
    // guessed: a failed read is not evidence of a front, and inventing one would
    // move the rating on the strength of an error.
    return settle({
      exhaustion: prevExhaustion ?? 0,
      effort: null,
      contribution: null,
      phase: "unknown",
      conflictId: prevConflictId,
    });
  }
}

interface SettleInput extends WarModifierInput {
  conflictId: string | null;
}

function settle(input: SettleInput): WarApprovalResult {
  // A corrupt conflict document (a non-finite `control`, say) would otherwise
  // carry NaN into governmentApprovals, where it poisons every rating
  // computation downstream until something overwrites it. Every value is
  // re-checked here rather than trusted from the clamps above.
  const exhaustion = Number.isFinite(input.exhaustion) ? input.exhaustion : 0;
  const modifiers = buildWarModifiers({ ...input, exhaustion });
  const total = modifiers.reduce((sum, modifier) => sum + modifier.effect, 0);
  return {
    modifiers,
    total: Number.isFinite(total) ? Math.round(total * 10) / 10 : 0,
    exhaustion,
    conflictId: input.conflictId,
  };
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
