import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictType } from "@/lib/db/types/conflict";

/**
 * Global cold-war tension: one 0-100 number the whole world shares, with a
 * short ledger of what moved it.
 *
 * Discrete events (a nuclear test, an escalation rung, a stand-down) apply
 * spikes through `applyTensionEvent`. Each turn, the tension phase relaxes the
 * value toward a floor set by the world's standing pressure: the Vietnam
 * rung, active crises, how many warheads exist, and active shooting wars.
 * Discrete relief cannot cross that floor, so a hot world never reads calm.
 * The dials layer (lib/coldwar/dials.ts) turns the reading into consequences:
 * DEFCON, procurement demand, detente goodwill.
 */

export const COLD_WAR_TENSION_COLLECTION = "coldWarTension";
export const COLD_WAR_TENSION_ID = "current";

export const TENSION_BASELINE = 12;
export const NUCLEAR_WAR_MINIMUM_TENSION = 60;
export const WAR_ACCLIMATION_GRACE_TURNS = 12;
export const WAR_ACCLIMATION_MAX_REDUCTION = 0.4;
export const WAR_ACCLIMATION_TURNS_TO_MAX = 40;
export const WAR_ACCLIMATION_FULL_INTENSITY = 70;
export const WAR_ACCLIMATION_HOT_INTENSITY = 85;
export const NUCLEAR_WAR_RESIDUAL_PRESSURE = 30;
/** Fraction of the gap to the floor closed each turn. */
export const TENSION_RELAXATION = 0.08;
const LEDGER_CAP = 24;

export type TensionEventKind =
  "nuclear-test" | "buildup" | "escalation" | "crisis" | "detente" | "decay";

export interface TensionEvent {
  turn: number;
  kind: TensionEventKind;
  label: string;
  delta: number;
  at: Date;
}

export interface ColdWarTensionState {
  value: number;
  /** Last standing-pressure floor computed by the turn phase. */
  pressureFloor: number;
  updatedTurn: number;
  events: TensionEvent[];
  updatedAt: Date;
}

export type TensionBand = "DETENTE" | "CALM" | "ELEVATED" | "CRISIS" | "BRINK";

export function tensionBand(value: number): TensionBand {
  if (value < 15) return "DETENTE";
  if (value < 35) return "CALM";
  if (value < 60) return "ELEVATED";
  if (value < 80) return "CRISIS";
  return "BRINK";
}

export function clampTension(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

/** Standing inputs the per-turn step reads off the rest of the world. */
export interface TensionPressures {
  /** Vietnam (or successor ladder) escalation level, 0 when quiet. */
  escalationLevel: number;
  /** Active world crises count. */
  activeCrises: number;
  /** Total warheads across all programmes. */
  totalWarheads: number;
  /**
   * Summed intensity (0-100 each) of active wars with nuclear-armed countries
   * on opposing sides. A nuclear shooting war is the hottest thing the world
   * can hold short of launch, and must dominate the floor.
   */
  nuclearWarIntensity: number;
  /** Number of active wars with nuclear-armed countries on opposing sides. */
  nuclearWarCount: number;
  /**
   * Crisis-grade shock retained by the most alarming nuclear-opponent war
   * after limited-war acclimation. Fresh and hot wars hold the full 48-point
   * contribution; long wars that remain below hot intensity can ease only to
   * the residual danger floor.
   */
  nuclearWarMinimumPressure?: number;
  /** Summed intensity of every other active war. */
  otherWarIntensity: number;
}

/** Player-facing explanation of the standing pressure floor. */
export interface TensionPressureBreakdown {
  baseline: number;
  escalation: number;
  activeCrises: number;
  arsenal: number;
  wars: number;
  floor: number;
}

export function tensionPressureBreakdown(p: TensionPressures): TensionPressureBreakdown {
  const escalation = Math.min(30, p.escalationLevel * 4);
  const activeCrises = Math.min(12, p.activeCrises * 3);
  const arsenal = Math.min(18, Math.sqrt(Math.max(0, p.totalWarheads)) * 1.2);
  // Any nuclear-opponent war contributes at least 48: baseline 12 plus 48
  // guarantees CRISIS before the arsenal and other pressures are counted.
  // Intensity remains additive above that minimum, so every active war still
  // changes the floor. Conventional wars retain their lower weight and cap.
  const nuclearIntensity = Math.max(0, p.nuclearWarIntensity) * 0.15;
  const conventionalIntensity = Math.max(0, p.otherWarIntensity) * 0.12;
  const nuclearWarMinimum =
    p.nuclearWarCount > 0
      ? Math.max(
          NUCLEAR_WAR_RESIDUAL_PRESSURE,
          p.nuclearWarMinimumPressure ?? NUCLEAR_WAR_MINIMUM_TENSION - TENSION_BASELINE
        )
      : 0;
  const wars =
    nuclearWarMinimum > 0
      ? Math.min(70, nuclearWarMinimum + nuclearIntensity + conventionalIntensity)
      : Math.min(45, conventionalIntensity);
  return {
    baseline: TENSION_BASELINE,
    escalation: clampTension(escalation),
    activeCrises: clampTension(activeCrises),
    arsenal: clampTension(arsenal),
    wars: clampTension(wars),
    floor: clampTension(TENSION_BASELINE + escalation + activeCrises + arsenal + wars),
  };
}

/** The two sides of a war as the pressure model needs them: who and how hot. */
export interface WarPressureInput {
  sideACountries: CountryId[];
  sideBCountries: CountryId[];
  /** 0-100. */
  intensity: number;
  /** Opening turn. Absent keeps the full fresh-war pressure for old callers. */
  startTurn?: number;
}

export interface NuclearProgramPressureInput {
  _id: CountryId;
  warheads: number;
}

/** Countries with a usable live stockpile, rather than a hardcoded power list. */
export function nuclearArmedCountryIds(
  programs: NuclearProgramPressureInput[]
): ReadonlySet<CountryId> {
  return new Set(programs.filter((program) => program.warheads > 0).map((program) => program._id));
}

/** True when at least one nuclear-armed country stands on each side. */
export function isNuclearWar(
  war: Pick<WarPressureInput, "sideACountries" | "sideBCountries">,
  nuclearCountries: ReadonlySet<CountryId>
): boolean {
  return (
    war.sideACountries.some((countryId) => nuclearCountries.has(countryId)) &&
    war.sideBCountries.some((countryId) => nuclearCountries.has(countryId))
  );
}

export interface WarPressureSummary {
  nuclearWarIntensity: number;
  otherWarIntensity: number;
  activeWarCount: number;
  nuclearWarCount: number;
  nuclearWarMinimumPressure: number;
}

/**
 * Public alarm slowly normalizes around a long limited war. The reduction
 * starts after twelve turns, reaches at most 40 percent after another forty,
 * and disappears as intensity climbs from 70 toward the hot-war threshold at
 * 85. This changes pressure, never the conflict's actual combat intensity.
 */
export function warAcclimationMultiplier(
  war: Pick<WarPressureInput, "intensity" | "startTurn">,
  currentTurn?: number
): number {
  if (currentTurn == null || war.startTurn == null) return 1;
  const age = Math.max(0, currentTurn - war.startTurn);
  const acclimationTurns = age - WAR_ACCLIMATION_GRACE_TURNS;
  if (acclimationTurns <= 0) return 1;

  const intensity = Math.max(0, Math.min(100, war.intensity));
  if (intensity >= WAR_ACCLIMATION_HOT_INTENSITY) return 1;
  const coolness =
    intensity <= WAR_ACCLIMATION_FULL_INTENSITY
      ? 1
      : (WAR_ACCLIMATION_HOT_INTENSITY - intensity) /
        (WAR_ACCLIMATION_HOT_INTENSITY - WAR_ACCLIMATION_FULL_INTENSITY);
  const ageReduction =
    Math.min(1, acclimationTurns / WAR_ACCLIMATION_TURNS_TO_MAX) * WAR_ACCLIMATION_MAX_REDUCTION;
  return Math.max(1 - WAR_ACCLIMATION_MAX_REDUCTION, 1 - ageReduction * coolness);
}

/** Fold active wars into the two intensity sums the pressure floor reads. */
export function warPressures(
  wars: WarPressureInput[],
  nuclearCountries: ReadonlySet<CountryId>,
  currentTurn?: number
): WarPressureSummary {
  let nuclearWarIntensity = 0;
  let otherWarIntensity = 0;
  let nuclearWarCount = 0;
  let nuclearWarMinimumPressure = 0;
  for (const war of wars) {
    const intensity = Math.max(0, Math.min(100, war.intensity));
    const multiplier = warAcclimationMultiplier(war, currentTurn);
    const pressureIntensity = intensity * multiplier;
    if (isNuclearWar(war, nuclearCountries)) {
      nuclearWarIntensity += pressureIntensity;
      nuclearWarCount += 1;
      nuclearWarMinimumPressure = Math.max(
        nuclearWarMinimumPressure,
        Math.max(
          NUCLEAR_WAR_RESIDUAL_PRESSURE,
          (NUCLEAR_WAR_MINIMUM_TENSION - TENSION_BASELINE) * multiplier
        )
      );
    } else {
      otherWarIntensity += pressureIntensity;
    }
  }
  return {
    nuclearWarIntensity,
    otherWarIntensity,
    activeWarCount: wars.length,
    nuclearWarCount,
    nuclearWarMinimumPressure: clampTension(nuclearWarMinimumPressure),
  };
}

/** Immediate outbreak spike before the next standing-pressure turn runs. */
export function warDeclarationTensionDelta(
  war: Pick<WarPressureInput, "sideACountries" | "sideBCountries"> & { type: ConflictType },
  nuclearCountries: ReadonlySet<CountryId>
): number {
  if (isNuclearWar(war, nuclearCountries)) return 20;
  return war.type === "interstate" ? 10 : 5;
}

/**
 * The floor standing pressure holds tension at: spikes decay toward this, not
 * toward zero. An armed, embroiled world stays tense without new events.
 */
export function tensionFloor(p: TensionPressures): number {
  return tensionPressureBreakdown(p).floor;
}

/** One turn of relaxation toward the pressure floor. */
export function stepTension(value: number, p: TensionPressures): number {
  const floor = tensionFloor(p);
  if (value <= floor) return floor;
  return clampTension(Math.max(floor, value + (floor - value) * TENSION_RELAXATION));
}

export function emptyTensionState(): ColdWarTensionState {
  return {
    value: TENSION_BASELINE,
    pressureFloor: TENSION_BASELINE,
    updatedTurn: 0,
    events: [],
    updatedAt: new Date(0),
  };
}

type StoredState = ColdWarTensionState & { _id: string };

export async function getColdWarTension(db: Db): Promise<ColdWarTensionState> {
  const doc = await db
    .collection<StoredState>(COLD_WAR_TENSION_COLLECTION)
    .findOne({ _id: COLD_WAR_TENSION_ID });
  if (!doc) return emptyTensionState();
  return {
    value: clampTension(doc.value ?? TENSION_BASELINE),
    pressureFloor: clampTension(doc.pressureFloor ?? TENSION_BASELINE),
    updatedTurn: doc.updatedTurn ?? 0,
    events: doc.events ?? [],
    updatedAt: doc.updatedAt ?? new Date(0),
  };
}

async function putColdWarTension(db: Db, state: ColdWarTensionState): Promise<void> {
  await db
    .collection<StoredState>(COLD_WAR_TENSION_COLLECTION)
    .updateOne(
      { _id: COLD_WAR_TENSION_ID },
      { $set: { ...state, updatedAt: new Date() } },
      { upsert: true }
    );
}

/** Apply a discrete spike (or relief, negative delta) and record it. */
export async function applyTensionEvent(
  db: Db,
  turn: number,
  kind: TensionEventKind,
  label: string,
  delta: number,
  options: { minimumValue?: number } = {}
): Promise<ColdWarTensionState> {
  const state = await getColdWarTension(db);
  const minimumValue = clampTension(options.minimumValue ?? state.pressureFloor);
  const value = clampTension(
    delta < 0 ? Math.max(minimumValue, state.value + delta) : state.value + delta
  );
  const appliedDelta = Math.round((value - state.value) * 10) / 10;
  const next: ColdWarTensionState = {
    ...state,
    value,
    pressureFloor: options.minimumValue == null ? state.pressureFloor : minimumValue,
    events: [{ turn, kind, label, delta: appliedDelta, at: new Date() }, ...state.events].slice(
      0,
      LEDGER_CAP
    ),
  };
  await putColdWarTension(db, next);
  return next;
}

/**
 * The per-turn tension step: relax toward the standing-pressure floor.
 * Idempotent per turn: a re-run of the same turn is a no-op.
 */
export async function runTensionTurn(
  db: Db,
  turn: number,
  pressures: TensionPressures
): Promise<ColdWarTensionState> {
  const state = await getColdWarTension(db);
  if (state.updatedTurn >= turn) return state;
  const pressureFloor = tensionFloor(pressures);
  const next: ColdWarTensionState = {
    ...state,
    value: stepTension(state.value, pressures),
    pressureFloor,
    updatedTurn: turn,
  };
  await putColdWarTension(db, next);
  return next;
}
