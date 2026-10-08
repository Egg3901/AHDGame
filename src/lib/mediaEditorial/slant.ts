/**
 * Newsroom slant and advertising price. A media publisher's editorial stance
 * (the same two axes characters and parties use) sets the lean of the
 * newsrooms it runs in a state. Advertisers whose own positions sit close to a
 * state's revenue-weighted newsroom slant pay less to run ads there.
 */
import type { Db } from "mongodb";
import {
  EDITORIAL_POSITION_LIMIT,
  normalizeEditorialPosition,
  type EditorialPosition,
} from "./rules";

/** Largest price cut an advertiser can get from fully aligned local newsrooms. */
export const SLANT_MAX_PRICE_DISCOUNT = 0.15;
/** Distance (0 to 1) at which the discount reaches zero: half of the full stance range. */
const SLANT_DISCOUNT_REACH = 0.5;

export interface Newsroom {
  stance?: Partial<EditorialPosition> | null;
  /** Relative size of the newsroom in the state, e.g. its revenue. */
  weight: number;
}

export interface StateSlant {
  economic: number;
  social: number;
  /** Share of local newsroom weight that has taken a non-neutral stance, 0 to 1. */
  strength: number;
}

function isNeutral(position: EditorialPosition): boolean {
  return position.economic === 0 && position.social === 0;
}

/**
 * Reach-weighted mean stance of the non-neutral newsrooms in a state. A state
 * where nobody has set a stance has no slant, so moderates get no free cut.
 */
export function reachWeightedSlant(newsrooms: readonly Newsroom[]): StateSlant | null {
  let total = 0;
  let slantedWeight = 0;
  let economic = 0;
  let social = 0;
  for (const newsroom of newsrooms) {
    const weight = Number.isFinite(newsroom.weight) ? Math.max(0, newsroom.weight) : 0;
    if (weight === 0) continue;
    total += weight;
    const position = normalizeEditorialPosition(newsroom.stance);
    if (isNeutral(position)) continue;
    slantedWeight += weight;
    economic += position.economic * weight;
    social += position.social * weight;
  }
  if (total === 0 || slantedWeight === 0) return null;
  return {
    economic: economic / slantedWeight,
    social: social / slantedWeight,
    strength: slantedWeight / total,
  };
}

/** Normalised distance between two positions: 0 identical, 1 opposite corners. */
export function slantDistance(
  a: Partial<EditorialPosition> | null | undefined,
  b: Partial<EditorialPosition> | null | undefined
): number {
  const left = normalizeEditorialPosition(a);
  const right = normalizeEditorialPosition(b);
  return (
    (Math.abs(left.economic - right.economic) + Math.abs(left.social - right.social)) /
    (EDITORIAL_POSITION_LIMIT * 4)
  );
}

/**
 * Multiplier on an advertiser's cost in a state, between 0.85 and 1. Full
 * discount needs both identical positions and fully slanted local newsrooms.
 */
export function advertisingPriceFactor(
  advertiser: Partial<EditorialPosition> | null | undefined,
  slant: StateSlant | null
): number {
  if (!slant) return 1;
  return 1 - SLANT_MAX_PRICE_DISCOUNT * slantCloseness(advertiser, slant);
}

/** Largest favorability gain bonus from fully aligned, fully slanted local newsrooms. */
export const SLANT_MAX_FAVORABILITY_BONUS = 0.15;

function slantCloseness(
  advertiser: Partial<EditorialPosition> | null | undefined,
  slant: StateSlant
): number {
  const closeness = Math.max(0, 1 - slantDistance(advertiser, slant) / SLANT_DISCOUNT_REACH);
  return closeness * Math.min(1, Math.max(0, slant.strength));
}

/** Multiplier on the favorability an ad buys, between 1 and 1.15. */
export function advertisingFavorabilityFactor(
  advertiser: Partial<EditorialPosition> | null | undefined,
  slant: StateSlant | null
): number {
  if (!slant) return 1;
  return 1 + SLANT_MAX_FAVORABILITY_BONUS * slantCloseness(advertiser, slant);
}

export interface SlantedAdvertise {
  cost: number;
  favorabilityGain: number;
  /** Whole percent cut on the price; 0 when the slant gives nothing. */
  cutPct: number;
}

/**
 * Applies the newsroom slant to one ad buy: cheaper by the price factor and
 * worth up to 15% more favorability. Returns null when there is no discount.
 */
export function applySlantToAdvertise(
  baseCost: number,
  baseGain: number,
  advertiser: Partial<EditorialPosition> | null | undefined,
  slant: StateSlant | null
): SlantedAdvertise | null {
  const factor = advertisingPriceFactor(advertiser, slant);
  if (factor >= 1) return null;
  return {
    cost: Math.abs(baseCost) * factor,
    favorabilityGain:
      Math.round(baseGain * advertisingFavorabilityFactor(advertiser, slant) * 100) / 100,
    cutPct: Math.round((1 - factor) * 100),
  };
}

/** Slant of a state's newsrooms, weighted by what each sector actually earns. */
export async function loadStateSlant(db: Db, stateId: string): Promise<StateSlant | null> {
  const sectors = await db
    .collection("corporateSectors")
    .find({ sectorType: "media", stateId, mothballed: { $ne: true } })
    .project<{ corporationId: unknown; revenue?: number; realizedRevenue?: number }>({
      corporationId: 1,
      revenue: 1,
      realizedRevenue: 1,
    })
    .toArray();
  if (sectors.length === 0) return null;
  const corps = await db
    .collection("corporations")
    .find({ _id: { $in: [...new Set(sectors.map((s) => s.corporationId))] as never[] } })
    .project<{ _id: unknown; editorialStance?: EditorialPosition }>({ editorialStance: 1 })
    .toArray();
  const stanceById = new Map(corps.map((corp) => [String(corp._id), corp.editorialStance]));
  return reachWeightedSlant(
    sectors.map((sector) => ({
      stance: stanceById.get(String(sector.corporationId)),
      weight: sector.realizedRevenue ?? sector.revenue ?? 0,
    }))
  );
}
