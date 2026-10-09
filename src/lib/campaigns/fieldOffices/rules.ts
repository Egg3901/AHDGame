import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getCampaignFamilyScalar } from "@/lib/campaigns/upgradeCosts";

/**
 * Campaign field offices: rules registry.
 *
 * A country opts in with `CountryConfig.fieldOfficeScope`. Everything that
 * varies by scope (costs, effect sizes, stacking) lives in `SCOPE_RULES`, and
 * everything that varies by race size lives in `OFFICE_CAP_BY_ELECTION_TYPE`
 * and the shared campaign family scalar. Adding a country is one config line;
 * adding a scope (a JP prefecture map, a UK constituency map) is one entry
 * here plus a subdivision source in `subdivisions.ts`.
 *
 * Money is anchor-denominated and converted at the frozen campaign basis, the
 * same way Strategic Operations upgrades are priced.
 */

export type FieldOfficeScope = "county" | "region";

export interface FieldOfficeScopeRules {
  scope: FieldOfficeScope;
  /** Anchor funds to open one office, before family scalar and price level. */
  openCostAnchor: number;
  /** Campaign actions to open one office. */
  openActions: number;
  /** Anchor funds per office per turn. */
  upkeepAnchor: number;
  /**
   * Region-wide turnout points each fully ramped office adds before
   * saturation. Every office contributes here, county or not.
   */
  regionPerOfficePct: number;
  /** Ceiling on the region-wide term; offices saturate toward it. */
  regionCapPct: number;
  /**
   * Turnout points an office adds inside its own subdivision. Weighted by the
   * subdivision's share of the region electorate and the candidate's yield
   * there, so a big friendly county is worth more than a small hostile one.
   * Zero for region scope.
   */
  subdivisionPct: number;
  /** Most offices one campaign may hold in a single region (region scope stacks). */
  maxPerRegion: number;
}

const SCOPE_RULES: Readonly<Record<FieldOfficeScope, FieldOfficeScopeRules>> = {
  county: {
    scope: "county",
    openCostAnchor: 60_000,
    openActions: 4,
    upkeepAnchor: 6_000,
    regionPerOfficePct: 0.6,
    regionCapPct: 3,
    subdivisionPct: 5,
    maxPerRegion: Number.POSITIVE_INFINITY,
  },
  region: {
    scope: "region",
    openCostAnchor: 60_000,
    openActions: 4,
    upkeepAnchor: 6_000,
    regionPerOfficePct: 0.6,
    regionCapPct: 1.5,
    subdivisionPct: 0,
    maxPerRegion: 3,
  },
};

/** Turns for a new office to reach full strength (1/N, 2/N, ... 1). */
export const FIELD_OFFICE_RAMP_TURNS = 3;

/**
 * Per-campaign office cap by race. A national race spreads across many
 * regions; a district race has one region and little room. Unknown race
 * types fall back to `DEFAULT_OFFICE_CAP`.
 */
const OFFICE_CAP_BY_ELECTION_TYPE: Readonly<Record<string, number>> = {
  president: 40,
  senate: 12,
  governor: 12,
  house: 5,
  stateSenate: 4,
  commons: 3,
  special_commons: 3,
  shugiin: 3,
  snap_shugiin: 3,
  sangiin: 3,
};
const DEFAULT_OFFICE_CAP = 6;

export function getFieldOfficeScope(countryId: string): FieldOfficeScope | null {
  try {
    return getCountryConfig(countryId as CountryId).fieldOfficeScope ?? null;
  } catch {
    return null;
  }
}

export function getFieldOfficeRules(countryId: string): FieldOfficeScopeRules | null {
  const scope = getFieldOfficeScope(countryId);
  return scope ? SCOPE_RULES[scope] : null;
}

export function getFieldOfficeCap(electionType: string | undefined): number {
  return (electionType && OFFICE_CAP_BY_ELECTION_TYPE[electionType]) || DEFAULT_OFFICE_CAP;
}

/** Anchor open cost and per-turn upkeep for one office in this race. */
export function getFieldOfficeCostAnchor(
  rules: FieldOfficeScopeRules,
  electionType: string | undefined
): { open: number; upkeep: number; actions: number } {
  const scalar = getCampaignFamilyScalar(electionType);
  return {
    open: rules.openCostAnchor * scalar,
    upkeep: rules.upkeepAnchor * scalar,
    actions: rules.openActions,
  };
}
