/**
 * Coalition campaigning rewards ideological fit. Canvassing raises a turnout
 * input, while targeted ads give matching voters a capped competitive bonus.
 * campaignResponse preserves each voter's identities before averaging effects.
 */

export const CAMPAIGN_RULES_VERSION = 1;
export const CANVASS_BASE_BOOST = 2;
export const TURNOUT_CAP = 20;
export const TURNOUT_HALF_LIFE = 6;
export const AD_HALF_LIFE = 24;
export const AD_BONUS_CAP = 0.25;
export const AD_ACTION_COST = 1;
export const AD_FUNDS_PER_ACTION = 100;
export const AD_BOOST_PER_ACTION = 0.01;
export const AD_MAX_ACTIONS = 50;

export interface Position {
  economicLean: number;
  socialLean: number;
}

export interface CampaignCell extends Position {
  /** Present when combining regional cells into a nationwide electorate. */
  stateId?: string;
  id: string;
  share: number;
  turnout: number;
  buckets: Record<string, string>;
  identities: Record<string, Position>;
}

export interface CampaignTarget {
  dimension: string;
  bucket: string;
}

export interface TargetedAd extends CampaignTarget {
  stateId: string;
  /** Immediate nominal bonus; absent on historical prepaid records. */
  bonus?: number;
  /** Exposure on lastPurchaseTurn. Later scheduled buys arrive once per turn. */
  exposure?: number;
  lastPurchaseTurn: number;
  /** Inclusive last turn of the prepaid flight. */
  throughTurn?: number;
}

export type TurnoutModifiers = Record<string, Record<string, number>>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function usesCampaignRules(election: { campaignRulesVersion?: number }): boolean {
  return (election.campaignRulesVersion ?? 0) >= CAMPAIGN_RULES_VERSION;
}

/** Ads can be bought outside a race, independently of its turnout rules version. */
export function usesCampaignAds(
  election: { campaignRulesVersion?: number },
  candidates: ReadonlyArray<{ targetedAds?: TargetedAd[] }>
): boolean {
  return (
    usesCampaignRules(election) ||
    candidates.some((candidate) => Boolean(candidate.targetedAds?.length))
  );
}

/** Preserve old candidate flights while sharing standing exposure across races. */
export function combinedAds(...sources: (TargetedAd[] | undefined)[]): TargetedAd[] {
  return [
    ...new Map(sources.flatMap((ads) => ads ?? []).map((ad) => [JSON.stringify(ad), ad])).values(),
  ];
}

/** Stamp only newly inserted races; never retrofit a race already in progress. */
export function withCampaignRules<T extends object>(
  election: T
): T & { campaignRulesVersion: number } {
  return { ...election, campaignRulesVersion: CAMPAIGN_RULES_VERSION };
}

export function positionDistanceSquared(a: Position, b: Position): number {
  return ((a.economicLean - b.economicLean) ** 2 + (a.socialLean - b.socialLean) ** 2) / 2;
}

export function campaignFit(candidate: Position, audience: Position): number {
  return 0.2 + 0.8 * Math.exp(-positionDistanceSquared(candidate, audience) / 18);
}

export function canvassingBoost(candidate: Position, audience: Position, closing: boolean): number {
  return CANVASS_BASE_BOOST * campaignFit(candidate, audience) ** 2 * (closing ? 2 : 1);
}

/** Headroom is directional: positive action can recover a suppressed bucket. */
export function addTurnoutBoost(current: number, boost: number, count = 1): number {
  let value = clamp(current, -TURNOUT_CAP, TURNOUT_CAP);
  for (let i = 0; i < count; i++) {
    const resistance = Math.max(0, Math.sign(boost) * value) / TURNOUT_CAP;
    value = clamp(value + boost * (1 - resistance), -TURNOUT_CAP, TURNOUT_CAP);
  }
  return value;
}

export function decayTurnout(modifiers: TurnoutModifiers): TurnoutModifiers {
  return Object.fromEntries(
    Object.entries(modifiers)
      .filter(([, buckets]) => buckets && typeof buckets === "object" && !Array.isArray(buckets))
      .map(([dimension, buckets]) => [
        dimension,
        Object.fromEntries(
          Object.entries(buckets)
            .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
            .map(([bucket, value]) => {
              const decayed = value * 2 ** (-1 / TURNOUT_HALF_LIFE);
              return [bucket, Math.abs(decayed) < 0.01 ? 0 : decayed];
            })
        ),
      ])
  );
}

/** Missing modern state starts from the legacy snapshot without a data migration. */
export function turnoutForElection<
  T extends { modifiers: TurnoutModifiers; campaignModifiers?: TurnoutModifiers },
>(doc: T | null | undefined, election: { campaignRulesVersion?: number }): T | null | undefined {
  return doc && usesCampaignRules(election)
    ? { ...doc, modifiers: doc.campaignModifiers ?? doc.modifiers }
    : doc;
}

export function targetAudience(cells: CampaignCell[], target: CampaignTarget) {
  const members = cells.filter((cell) => cell.buckets[target.dimension] === target.bucket);
  const share = members.reduce((sum, cell) => sum + cell.share, 0);
  if (share <= 0) return null;
  const mean = members.reduce(
    (sum, cell) => ({
      economicLean: sum.economicLean + (cell.share * cell.economicLean) / share,
      socialLean: sum.socialLean + (cell.share * cell.socialLean) / share,
    }),
    { economicLean: 0, socialLean: 0 }
  );
  const position = members.reduce(
    (sum, cell) => {
      const identity = cell.identities[target.dimension] ?? cell;
      return {
        economicLean: sum.economicLean + (cell.share * identity.economicLean) / share,
        socialLean: sum.socialLean + (cell.share * identity.socialLean) / share,
      };
    },
    { economicLean: 0, socialLean: 0 }
  );
  const variance = members.reduce(
    (sum, cell) => sum + (cell.share * positionDistanceSquared(cell, mean)) / share,
    0
  );
  return { share, position, cohesion: 0.5 + 0.5 * Math.exp(-variance / 4.5) };
}

export function campaignResponse(
  candidate: Position,
  cell: CampaignCell,
  target: CampaignTarget,
  audience: NonNullable<ReturnType<typeof targetAudience>>
): number {
  if (cell.buckets[target.dimension] !== target.bucket) return 0;
  const identity = cell.identities[target.dimension] ?? audience.position;
  const others = Object.entries(cell.identities).filter(
    ([dimension]) => dimension !== target.dimension
  );
  const conflict =
    others.length === 0
      ? 0
      : others.reduce((sum, [, position]) => sum + positionDistanceSquared(identity, position), 0) /
        others.length;
  const agreement = 0.25 + 0.75 * Math.exp(-conflict / 12.5);
  return (
    campaignFit(candidate, audience.position) *
    campaignFit(candidate, cell) *
    agreement *
    audience.cohesion
  );
}

/** Bonuses only revert toward zero. Old prepaid records credit their paid actions upfront. */
export function adExposure(ad: TargetedAd, turn: number): number {
  if (turn < ad.lastPurchaseTurn) return 0;
  // A historical flight bought five action points per scheduled purchase.
  // Credit that effort immediately; never schedule another automatic purchase.
  const initial =
    ad.bonus ??
    (Math.max(0, ad.exposure ?? 0) +
      Math.max(0, (ad.throughTurn ?? ad.lastPurchaseTurn) - ad.lastPurchaseTurn)) *
      5 *
      AD_BOOST_PER_ACTION;
  return clamp(initial, 0, AD_BONUS_CAP) * 2 ** (-(turn - ad.lastPurchaseTurn) / AD_HALF_LIFE);
}

export function targetedAdBonuses(
  cells: CampaignCell[],
  candidate: Position,
  ads: TargetedAd[],
  stateId: string,
  turn: number
): Record<string, number> {
  const regions = new Set(cells.map((cell) => cell.stateId).filter(Boolean));
  const active = ads
    .filter((ad) => ad.stateId === stateId || regions.has(ad.stateId))
    .map((ad) => ({
      ad,
      audience: targetAudience(
        regions.size ? cells.filter((cell) => cell.stateId === ad.stateId) : cells,
        ad
      ),
      coverage: adExposure(ad, turn) / AD_BONUS_CAP,
    }));
  return Object.fromEntries(
    cells.map((cell) => {
      let remaining = 1;
      for (const { ad, audience, coverage } of active) {
        if (cell.stateId && cell.stateId !== ad.stateId) continue;
        if (audience) remaining *= 1 - coverage * campaignResponse(candidate, cell, ad, audience);
      }
      return [cell.id, AD_BONUS_CAP * (1 - remaining)];
    })
  );
}

/** Nominal target modifier before alignment; used for cap and purchase capacity. */
export function currentAdBonus(
  ads: TargetedAd[],
  target: CampaignTarget & { stateId: string },
  turn: number
): number {
  const previous = ads.find(
    (ad) =>
      ad.stateId === target.stateId &&
      ad.dimension === target.dimension &&
      ad.bucket === target.bucket
  );
  return previous ? adExposure(previous, turn) : 0;
}

export function planAdPurchase(
  ads: TargetedAd[],
  target: CampaignTarget & { stateId: string },
  turn: number,
  count: number
): TargetedAd[] | null {
  const same = (ad: TargetedAd) =>
    ad.stateId === target.stateId &&
    ad.dimension === target.dimension &&
    ad.bucket === target.bucket;
  if (!Number.isInteger(count) || count < 1 || count > AD_MAX_ACTIONS) return null;
  const current = currentAdBonus(ads, target, turn);
  if (current >= AD_BONUS_CAP - 1e-10) return null;
  return [
    ...ads.filter((ad) => !same(ad) && adExposure(ad, turn) >= 0.00001),
    {
      stateId: target.stateId,
      dimension: target.dimension,
      bucket: target.bucket,
      bonus: Math.min(AD_BONUS_CAP, current + AD_BOOST_PER_ACTION * count),
      lastPurchaseTurn: turn,
    },
  ];
}

/** Fixed anchor campaign funds per action; population does not set the price. */
export function adPurchaseCost(count: number): number {
  return AD_FUNDS_PER_ACTION * count;
}

export function audienceTurnout(cells: CampaignCell[], target: CampaignTarget): number {
  const members = cells.filter((cell) => cell.buckets[target.dimension] === target.bucket);
  const share = members.reduce((sum, cell) => sum + cell.share, 0);
  return share > 0 ? members.reduce((sum, cell) => sum + cell.share * cell.turnout, 0) / share : 0;
}

/** Score-based primaries have one regional pool; fold cell bonuses into that pool. */
export function meanAdBonus(cells: CampaignCell[], bonuses: Record<string, number>): number {
  const pool = cells.reduce((sum, cell) => sum + cell.share * cell.turnout, 0);
  return pool > 0
    ? cells.reduce((sum, cell) => sum + cell.share * cell.turnout * (bonuses[cell.id] ?? 0), 0) /
        pool
    : 0;
}

/** Express a weight bonus in a score-softmax system without changing its base weights. */
export function campaignPrimaryScore(score: number, bonus: number, temperature: number): number {
  return score + temperature * Math.log1p(Math.max(0, Math.min(AD_BONUS_CAP, bonus)));
}

/** Nigeria's organization-based presidential lane uses the same bounded ad bonus. */
export const NG_CAMPAIGN_TURNOUT_RATE = 0.32;
export function organizationAdWeight(organization: number, bonus: number): number {
  return Math.max(5, organization) * (1 + clamp(bonus, 0, AD_BONUS_CAP));
}
