import type { CountryId } from "@/lib/constants/countries";

/**
 * Derived "dashboard" metrics for an international organization: dues share,
 * per-member influence, the bloc's share of the world economy and a notional
 * annual budget — figures the game does not track directly. All are derived
 * from real national GDP so the visuals stay honest.
 *
 * Only entities the game PRICES take part. Background Nations have no economy
 * modelled at all, so they are absent from the weighting rather than counted as
 * a zero — a bloc does not get poorer for admitting one.
 */

/** Notional assessed-budget rate applied to total member GDP (illustrative). */
export const ORG_ASSESSED_RATE = 0.005;

export interface MemberDerived {
  countryId: CountryId;
  /** Member GDP ÷ total member GDP (0..1). */
  contributionPct: number;
  /** 0–100 power index, normalized so the largest member = 100. */
  influenceIndex: number;
}

export interface OrgDerived {
  members: MemberDerived[];
  /**
   * Members' combined GDP as a percentage of the modelled world's, to one
   * decimal. How much of the world economy this bloc holds.
   *
   * It REPLACED a mean-of-influence-indices "standing index", which measured
   * something quite different from what its name implied. Because every member
   * was scored against the bloc's own largest one, the number rose as economic
   * weight grew EVENLY spread and fell as it concentrated — so a two-member
   * Commonwealth scored 54 while NATO scored 21, and admitting a strong ally
   * lowered your standing unless it out-earned your current leader. This asks
   * the question a player actually has: how much of the world is ours.
   */
  worldEconomySharePct: number;
  /** Total member GDP × ORG_ASSESSED_RATE (notional). */
  notionalBudgetMillions: number;
  /** Viewer country's influence index, else 0. */
  yourInfluence: number;
}

export function computeOrgDerived(
  members: { countryId: CountryId; gdpMillions: number }[],
  viewerCountry: CountryId | null,
  worldGdpMillions = 0
): OrgDerived {
  const total = members.reduce((s, m) => s + Math.max(0, m.gdpMillions), 0);
  const maxGdp = members.reduce((m, x) => Math.max(m, Math.max(0, x.gdpMillions)), 0);

  const derivedMembers: MemberDerived[] = members.map((m) => {
    const gdp = Math.max(0, m.gdpMillions);
    return {
      countryId: m.countryId,
      contributionPct: total > 0 ? gdp / total : 0,
      influenceIndex: maxGdp > 0 ? Math.round((100 * gdp) / maxGdp) : 0,
    };
  });

  // Capped at 100: a bloc cannot hold more of the world than the world has, and
  // rounding a near-total share must not print 100.1%.
  const worldEconomySharePct =
    worldGdpMillions > 0 ? Math.min(100, Math.round((1000 * total) / worldGdpMillions) / 10) : 0;

  const yourInfluence = viewerCountry
    ? (derivedMembers.find((m) => m.countryId === viewerCountry)?.influenceIndex ?? 0)
    : 0;

  return {
    members: derivedMembers,
    worldEconomySharePct,
    notionalBudgetMillions: total * ORG_ASSESSED_RATE,
    yourInfluence,
  };
}
