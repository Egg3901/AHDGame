import type { PartyTier } from "@/lib/parties/partyTier";
import type { InfluenceType } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

/** The two party scopes that own an NPP Action Point pool. */
export type PartyScope = "national" | "state";

/** Flat AP cost to recruit one NPP. */
export const NPP_RECRUITMENT_AP_COST = 5 as const;

/** Flat AP cost for any single NPP Management action. */
export const NPP_MANAGEMENT_AP_COST = 1 as const;

/**
 * Treasury cost charged ALONGSIDE Action Points for NPP work, keyed by
 * **currency** (not country) so the cost follows a party if its country ever
 * adopts a different currency. Hand-tuned per-currency round numbers rather than
 * raw forex (which would make weak currencies absurdly large for a basic action).
 *
 * - `boost`: Boost Political Influence / Boost Favorability
 * - `loyalty`: Strengthen Party Loyalty / Improve Cooperation
 * - `recruit`: Recruit an NPP (charged on top of the flat 5 AP)
 *
 * Currencies not listed fall back to `DEFAULT_NPP_TREASURY_COST` (the USD base
 * tier). `relocate_state` costs no treasury.
 */
interface NppTreasuryCost {
  boost: number;
  loyalty: number;
  recruit: number;
}

export const NPP_TREASURY_COST_BY_CURRENCY: Partial<Record<CurrencyCode, NppTreasuryCost>> = {
  USD: { boost: 5_000, loyalty: 12_500, recruit: 50_000 },
  GBP: { boost: 5_000, loyalty: 12_500, recruit: 50_000 },
  EUR: { boost: 5_000, loyalty: 12_500, recruit: 50_000 },
  NGN: { boost: 5_000, loyalty: 12_500, recruit: 50_000 },
  BRL: { boost: 25_000, loyalty: 50_000, recruit: 200_000 },
  CNY: { boost: 25_000, loyalty: 50_000, recruit: 200_000 },
  JPY: { boost: 62_500, loyalty: 125_000, recruit: 500_000 },
  // Soviet ruble (also Belarus + Baltics) — 1979 official rate ≈ $1.35, a
  // near-par/strong currency, so it shares the base tier.
  SUR: { boost: 5_000, loyalty: 12_500, recruit: 50_000 },
};

const DEFAULT_NPP_TREASURY_COST: NppTreasuryCost = {
  boost: 5_000,
  loyalty: 12_500,
  recruit: 50_000,
};

const BOOST_ACTIONS: InfluenceType[] = ["boost_influence", "boost_favorability"];
const LOYALTY_ACTIONS: InfluenceType[] = ["boost_loyalty", "reduce_stubbornness"];

function treasuryCostFor(currency: CurrencyCode): NppTreasuryCost {
  return NPP_TREASURY_COST_BY_CURRENCY[currency] ?? DEFAULT_NPP_TREASURY_COST;
}

/** The currency a country's party treasury is denominated in (static map for now;
 *  the single chokepoint to swap if a country can change currency in future). */
export function nppTreasuryCurrency(countryId: CountryId): CurrencyCode {
  return COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
}

/** Per-action treasury cost (in the party's currency) for an NPP Management action. */
export function nppManagementFundCost(type: InfluenceType, currency: CurrencyCode): number {
  const c = treasuryCostFor(currency);
  if (BOOST_ACTIONS.includes(type)) return c.boost;
  if (LOYALTY_ACTIONS.includes(type)) return c.loyalty;
  return 0; // relocate_state and any non-management type
}

/** Treasury cost (in the party's currency) to recruit one NPP, on top of the 5 AP. */
export function nppRecruitmentFundCost(currency: CurrencyCode): number {
  return treasuryCostFor(currency).recruit;
}

interface ScopeTierValue {
  major: number;
  minor: number;
}

/** Banked pool maximum by scope × tier. */
export const NPP_ACTION_POINT_CAP: Record<PartyScope, ScopeTierValue> = {
  national: { major: 160, minor: 80 },
  state: { major: 40, minor: 20 },
};

/** Flat passive AP regenerated per turn by scope × tier. */
export const NPP_ACTION_POINT_REGEN: Record<PartyScope, ScopeTierValue> = {
  national: { major: 16, minor: 8 },
  state: { major: 4, minor: 3 },
};

export function nppActionPointCap(scope: PartyScope, tier: PartyTier): number {
  return NPP_ACTION_POINT_CAP[scope][tier];
}

export function nppActionPointRegen(scope: PartyScope, tier: PartyTier): number {
  return NPP_ACTION_POINT_REGEN[scope][tier];
}

export interface ComputeNppApGainInput {
  /** Current banked AP. `undefined` = legacy row → healed to the cap (full). */
  current: number | undefined;
  cap: number;
  regenPerTurn: number;
}

/**
 * Per-turn AP balance after a flat passive regen, clamped to the cap. A legacy
 * (`undefined`) balance heals to the cap so the migration never punishes a party.
 */
export function computeNppActionPointGain(input: ComputeNppApGainInput): number {
  const base = input.current === undefined ? input.cap : input.current;
  return Math.min(input.cap, base + input.regenPerTurn);
}
