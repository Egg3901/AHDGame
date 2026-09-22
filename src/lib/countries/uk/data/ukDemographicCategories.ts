import type { DemographicCategory } from "@/lib/db/types";

/**
 * UK Voter Archetypes — 12 mutually exclusive attitudinal/demographic groups
 * reflecting the British political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every region;
 * regional character is expressed through population percentages in
 * ukRegionDemographics.ts, not through dedicated regional identity slots.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left) to +5 (far right) on redistribution/market axis
 *   defaultSocialLean:   -5 (progressive/liberal) to +5 (conservative/traditional)
 *   defaultTurnout:      baseline participation rate (UK avg ~67% in 2019 GE)
 *
 * The system (electionEngine, demographicAppeal) is identical to US —
 * only the group definitions differ.
 *
 * demographicProfileId: "uk_archetypes"
 */
// Baseline turnout rates for UK voter groups (from 2019 GE data)
export const UK_VOTER_GROUP_BASELINES: Record<string, number> = {
  post_industrial_workers: 57,
  urban_progressives: 72,
  suburban_homeowners: 70,
  young_renters: 52,
  rural_traditionalists: 71,
  retirees: 73,
  public_sector: 68,
  moderate_centrists: 67,
  populist_right: 55,
  green_activists: 61,
  small_business: 70,
  new_britons: 50,
};

export const ukDemographicCategories: DemographicCategory[] = [
  {
    _id: "uk_voterGroups",
    name: "UK Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Post-Industrial Workers (Red Wall heartlands)
       * Ex-manufacturing towns in England, Scotland, and Wales — not just
       * "the North". Economically left (pro-public spending) but socially
       * conservative. Split heavily toward the Tories in 2019.
       */
      {
        id: "post_industrial_workers",
        name: "Post-Industrial Workers",
        defaultEconomicLean: -2,
        defaultSocialLean: 2,
        defaultTurnout: 57,
      },
      /**
       * Urban Progressives
       * University-educated city dwellers across every major UK city —
       * London, Manchester, Edinburgh, Bristol, Birmingham. Overwhelmingly
       * Remain-voting, cosmopolitan values, back left and centre-left parties.
       */
      {
        id: "urban_progressives",
        name: "Urban Progressives",
        defaultEconomicLean: -3,
        defaultSocialLean: -4,
        defaultTurnout: 72,
      },
      /**
       * Suburban Homeowners
       * Property-owning, aspirational middle class in commuter belts and
       * market towns. Moderate economically, moderately conservative socially.
       * The archetypal swing voter in English marginals.
       */
      {
        id: "suburban_homeowners",
        name: "Suburban Homeowners",
        defaultEconomicLean: 2,
        defaultSocialLean: 2,
        defaultTurnout: 70,
      },
      /**
       * Young Renters
       * Under-35 urban renters, many university-educated, priced out of housing.
       * The housing crisis is their defining political issue. Strongly socially
       * progressive, mildly left economically. Lower turnout than older cohorts.
       */
      {
        id: "young_renters",
        name: "Young Renters",
        defaultEconomicLean: -1,
        defaultSocialLean: -4,
        defaultTurnout: 52,
      },
      /**
       * Rural Traditionalists
       * Farming communities, market towns, English countryside. Reliably
       * right-of-centre, socially traditional, strongly Leave-voting.
       * Exists in every region — not only "the countryside".
       */
      {
        id: "rural_traditionalists",
        name: "Rural Traditionalists",
        defaultEconomicLean: 3,
        defaultSocialLean: 3,
        defaultTurnout: 71,
      },
      /**
       * Retirees & Pensioners
       * The UK's highest-turnout demographic. Deeply invested in the pension
       * triple lock, NHS social care, and cost-of-living. Broadly right-leaning
       * economically, socially conservative — present in every region.
       */
      {
        id: "retirees",
        name: "Retirees & Pensioners",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 73,
      },
      /**
       * Public Sector & NHS
       * Teachers, nurses, civil servants, social workers — ~5.5 million workers.
       * Pro-union, pro-public spending. The NHS is the UK's most politically
       * sacred institution; NHS workers are a uniquely powerful voting bloc.
       */
      {
        id: "public_sector",
        name: "Public Sector & NHS",
        defaultEconomicLean: -3,
        defaultSocialLean: -2,
        defaultTurnout: 68,
      },
      /**
       * Moderate Centrists
       * Educated, pro-Remain, fiscally moderate, socially liberal — the
       * classic centre-ground voter found in suburban marginals across England
       * and Scotland. Pro-constitutional reform. The archetypal swing vote.
       */
      {
        id: "moderate_centrists",
        name: "Moderate Centrists",
        defaultEconomicLean: 0,
        defaultSocialLean: -2,
        defaultTurnout: 67,
      },
      /**
       * Populist Right
       * Anti-establishment, anti-immigration, socially very conservative.
       * Economically populist rather than traditional free-market right.
       * Former protest voters; sovereignty and cultural identity are core issues.
       */
      {
        id: "populist_right",
        name: "Populist Right",
        defaultEconomicLean: 1,
        defaultSocialLean: 4,
        defaultTurnout: 55,
      },
      /**
       * Green & Climate Activists
       * Younger, often urban; climate action as a primary political identity.
       * Economically far left, socially very progressive. Back environmental
       * parties or the left wing of Labour.
       */
      {
        id: "green_activists",
        name: "Green & Climate Activists",
        defaultEconomicLean: -4,
        defaultSocialLean: -5,
        defaultTurnout: 61,
      },
      /**
       * Small Business & Self-Employed
       * Entrepreneurs, sole traders, small-business owners. Anti-regulation,
       * pro-tax relief, economically right. Present in every region; mirrors
       * the US "Small Business" archetype.
       */
      {
        id: "small_business",
        name: "Small Business & Self-Employed",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 70,
      },
      /**
       * New Britons & Minorities
       * British Asian, Black British, and immigrant communities. Concentrated
       * in cities but present across most regions. Left-leaning economically,
       * mildly progressive socially. Mirrors US "New Americans".
       */
      {
        id: "new_britons",
        name: "New Britons & Minorities",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 50,
      },
    ],
  },
];

export default ukDemographicCategories;
