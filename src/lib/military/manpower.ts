import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { getUnitArchetype } from "@/lib/constants/military";
import { ATTRITION } from "./config";

/**
 * How a nation raises manpower. The ladder scales the manpower pool AND gates whether
 * conscripts may be drawn at all. Supplied here by a default table; the Conscription Act
 * legislation replaces `resolveConscriptionStance` in a later phase.
 */
export interface ConscriptionStance {
  id: string;
  label: string;
  /** Scales pool regeneration and its ceiling. */
  poolMult: number;
  /** Whether the fast/green conscript draw is available. */
  conscriptAllowed: boolean;
}

export const CONSCRIPTION_STANCES: Record<string, ConscriptionStance> = {
  volunteer: {
    id: "volunteer",
    label: "All-Volunteer Force",
    poolMult: 0.6,
    conscriptAllowed: false,
  },
  limited: { id: "limited", label: "Limited Service", poolMult: 0.8, conscriptAllowed: false },
  selective: { id: "selective", label: "Selective Service", poolMult: 1.0, conscriptAllowed: true },
  national: { id: "national", label: "National Service", poolMult: 1.4, conscriptAllowed: true },
  universal: {
    id: "universal",
    label: "Universal Conscription",
    poolMult: 2.0,
    conscriptAllowed: true,
  },
};

/** Default stance per country until the Conscription Act supplies one. */
const DEFAULT_STANCE: Record<string, string> = {
  US: "selective",
  UK: "national",
  RU: "universal",
  DD: "universal",
};

export function resolveConscriptionStance(countryId: string): ConscriptionStance {
  return CONSCRIPTION_STANCES[DEFAULT_STANCE[countryId] ?? "limited"];
}

/**
 * The defense secondary whose five levels ARE the manpower ladder, per playable nation.
 * Nations absent here have no political legislation at all (every simulated country) and
 * fall back to the default stance table above.
 */
export const RESERVE_LAW_BY_COUNTRY: Record<string, string> = {
  US: "us.sec.reserveForces",
  UK: "uk.sec.territorialReserves",
  RU: "ru.sec.reservesVoluntaryDefense",
  DD: "dd.sec.reservesVoluntaryDefense",
};

/** Reserve-law level (0 "No Reserve System" … 4 "Nation in Arms") → conscription stance. */
const RESERVE_LADDER = ["volunteer", "limited", "selective", "national", "universal"] as const;

/**
 * Kept here rather than beside the DB resolver because client surfaces (the bill-proposal
 * modal) import it — this module is pure, whereas the resolver reaches the law catalogue.
 */
export function stanceForReserveLevel(level: number): ConscriptionStance {
  const i = Math.max(0, Math.min(RESERVE_LADDER.length - 1, Math.round(level)));
  return CONSCRIPTION_STANCES[RESERVE_LADDER[i]];
}

/**
 * The manpower consequence of a reserve-law level, for the bill-proposal surface — so a
 * player sees what a level does to replacements before filing. Empty string when the
 * legislation is not that country's reserve law, so callers can concatenate blindly.
 */
export function reserveManpowerLabel(
  countryId: string,
  legislationTypeId: string,
  level: number
): string {
  if (RESERVE_LAW_BY_COUNTRY[countryId] !== legislationTypeId) return "";
  const stance = stanceForReserveLevel(level);
  return ` · manpower ×${stance.poolMult}${stance.conscriptAllowed ? "" : ", no conscription"}`;
}

export type ReinforceMode = "off" | "trained" | "conscript";

export interface ReinforceResult {
  personnel: number;
  /** Clamped to the legal veterancy range, so this is writable straight to a unit. */
  vet: MilitaryUnit["vet"];
  xp: number;
  /** Men actually taken from the pool. */
  drawn: number;
}

/** Veterancy as one blendable score. */
const scoreOf = (vet: number, xp: number) => vet * 100 + xp;

/**
 * Top a unit up toward its establishment, blending the replacements' experience in by
 * headcount. Veterancy LEVELS can drop — rebuilding an elite formation with conscripts
 * genuinely degrades it, which is what makes veteran units worth preserving.
 */
export function reinforceUnit(
  unit: Pick<MilitaryUnit, "domain" | "type" | "personnel" | "vet" | "xp">,
  mode: Exclude<ReinforceMode, "off">,
  poolAvailable: number
): ReinforceResult {
  const unchanged = { personnel: unit.personnel, vet: unit.vet, xp: unit.xp, drawn: 0 };
  const establishment = getUnitArchetype(unit.domain, unit.type)?.personnel ?? 0;
  if (establishment <= 0) return unchanged;

  const deficit = establishment - unit.personnel;
  if (deficit <= 0) return unchanged;

  const rate = mode === "conscript" ? ATTRITION.conscriptFillRatio : ATTRITION.trainedFillRatio;
  const drawn = Math.max(
    0,
    Math.min(deficit, Math.floor(establishment * rate), Math.floor(poolAvailable))
  );
  if (drawn === 0) return unchanged;

  const replacementScore =
    mode === "conscript" ? ATTRITION.conscriptExpScore : ATTRITION.trainedExpScore;
  const total = unit.personnel + drawn;
  const blended = (unit.personnel * scoreOf(unit.vet, unit.xp) + drawn * replacementScore) / total;
  const vet = Math.max(0, Math.min(4, Math.floor(blended / 100)));
  const xp = Math.max(0, Math.min(99, Math.round(blended - vet * 100)));

  return { personnel: total, vet: vet as MilitaryUnit["vet"], xp, drawn };
}

/**
 * Ceiling on a nation's replacement pool: population × cap fraction × the
 * conscription stance multiplier. Shared by the per-turn reinforcement flow, the
 * briefing readout and procurement, so what the player sees as `poolCap` and the
 * ceiling procurement enforces cannot drift apart.
 */
export function manpowerCeiling(population: number, poolMult: number): number {
  return Math.floor(population * ATTRITION.manpowerPoolCapFraction * poolMult);
}

/** Fraction of the ceiling a nation's pool starts at on a fresh world. */
export const MANPOWER_START_FRACTION = 0.25;

/**
 * A nation's pool on a world that has never run a turn.
 *
 * Defined in terms of {@link manpowerCeiling} on purpose: the seeder and
 * `ensureManpowerPool`'s heal both call this, so "a fresh world and a healed
 * world start identically" is enforced by construction rather than by two
 * constants that agree today.
 *
 * Not the ceiling. Starting at 100% would hand every nation a full mobilisation
 * base before it has governed for an hour; starting at one turn's regeneration
 * (what the turn loop produced before this existed) left small nations unable to
 * afford a single formation — DD fielded 8,200 against a 12,000-man division.
 */
export function initialManpowerPool(population: number, poolMult: number): number {
  return Math.floor(manpowerCeiling(population, poolMult) * MANPOWER_START_FRACTION);
}
