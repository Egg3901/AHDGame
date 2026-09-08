/**
 * Coalition campaigning rewards ideological fit. Canvassing raises a turnout
 * input, while targeted ads give matching voters a capped competitive bonus.
 * campaignResponse preserves each voter's identities before averaging effects.
 */

export const CAMPAIGN_RULES_VERSION = 1;
export const CANVASS_BASE_BOOST = 2;
export const TURNOUT_CAP = 20;
export const TURNOUT_HALF_LIFE = 6;
export const AD_HALF_LIFE = 12;
export const AD_BONUS_CAP = 0.15;
/** Prevent long prepaid flights from banking effectively permanent saturation. */
export const AD_EXPOSURE_CAP = 3;
export const AD_ACTION_COST = 5;
/** Anchor campaign currency per thousand eligible people reached. */
export const AD_COST_PER_THOUSAND = 2;

export interface Position {
  economicLean: number;
  socialLean: number;
}

export interface CampaignCell extends Position {
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
  /** Exposure on lastPurchaseTurn. Later scheduled buys arrive once per turn. */
  exposure: number;
  lastPurchaseTurn: number;
  /** Inclusive last turn of the prepaid flight. */
  throughTurn: number;
}

export type TurnoutModifiers = Record<string, Record<string, number>>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function usesCampaignRules(election: { campaignRulesVersion?: number }): boolean {
  return (election.campaignRulesVersion ?? 0) >= CAMPAIGN_RULES_VERSION;
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

/** Evaluate prepaid flights from turn numbers; no per-turn writes or queue needed. */
export function adExposure(ad: TargetedAd, turn: number): number {
  if (turn < ad.lastPurchaseTurn) return 0;
  const elapsed = turn - ad.lastPurchaseTurn;
  const scheduled = Math.max(0, Math.min(turn, ad.throughTurn) - ad.lastPurchaseTurn);
  const retention = 2 ** (-1 / AD_HALF_LIFE);
  const flight = scheduled === 0 ? 0 : (1 - retention ** scheduled) / (1 - retention);
  const atLastBuy = Math.min(AD_EXPOSURE_CAP, ad.exposure * retention ** scheduled + flight);
  return atLastBuy * retention ** (elapsed - scheduled);
}

export function targetedAdBonuses(
  cells: CampaignCell[],
  candidate: Position,
  ads: TargetedAd[],
  stateId: string,
  turn: number
): Record<string, number> {
  const active = ads
    .filter((ad) => ad.stateId === stateId)
    .map((ad) => ({
      ad,
      audience: targetAudience(cells, ad),
      coverage: 1 - Math.exp(-adExposure(ad, turn)),
    }));
  return Object.fromEntries(
    cells.map((cell) => {
      let remaining = 1;
      for (const { ad, audience, coverage } of active) {
        if (audience) remaining *= 1 - coverage * campaignResponse(candidate, cell, ad, audience);
      }
      return [cell.id, AD_BONUS_CAP * (1 - remaining)];
    })
  );
}

export function planAdPurchase(
  ads: TargetedAd[],
  target: CampaignTarget & { stateId: string },
  turn: number,
  turns: number
): TargetedAd[] | null {
  const same = (ad: TargetedAd) =>
    ad.stateId === target.stateId &&
    ad.dimension === target.dimension &&
    ad.bucket === target.bucket;
  const previous = ads.find(same);
  if (previous && previous.throughTurn >= turn) return null;
  return [
    ...ads.filter((ad) => !same(ad) && (ad.throughTurn >= turn || adExposure(ad, turn) >= 0.001)),
    {
      stateId: target.stateId,
      dimension: target.dimension,
      bucket: target.bucket,
      exposure: Math.min(AD_EXPOSURE_CAP, (previous ? adExposure(previous, turn) : 0) + 1),
      lastPurchaseTurn: turn,
      throughTurn: turn + turns - 1,
    },
  ];
}

export function adPurchaseCost(
  eligiblePopulation: number,
  targetShare: number,
  turns: number
): number {
  return (
    Math.max(1, Math.ceil(((eligiblePopulation * targetShare) / 1000) * AD_COST_PER_THOUSAND)) *
    turns
  );
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
