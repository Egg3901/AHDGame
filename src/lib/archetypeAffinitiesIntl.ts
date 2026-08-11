/**
 * Domain-Specific Archetype Affinities — JP / DE / CN tables.
 *
 * Extracted from archetypeAffinities.ts (pure code motion, no value changes)
 * to keep that module under the architecture-audit size cap. The tables are
 * re-exported from archetypeAffinities.ts, so existing import paths keep
 * working. See archetypeAffinities.ts for the affinity conventions.
 */
import type { PolicyDomain } from "./archetypeAffinities";

/**
 * JP archetype approval template — maps JP voter archetypes to affinity strengths.
 */
export interface JPArchetypeApprovalTemplate {
  salaryman_conservative?: number;
  urban_progressive?: number;
  rural_traditionalist?: number;
  young_urban?: number;
  retiree?: number;
  public_sector?: number;
  small_business?: number;
  komeito_faithful?: number;
  reform_populist?: number;
  working_mothers?: number;
}

/** CN-specific archetype approval template. Positive = likes rightward policy shifts. */
export interface CNArchetypeApprovalTemplate {
  party_cadre?: number;
  urban_professional?: number;
  rural_peasant?: number;
  industrial_worker?: number;
  migrant_worker?: number;
  entrepreneur?: number;
  youth?: number;
}

/** DE-specific archetype approval template. Positive = likes rightward policy shifts. */
export interface DEArchetypeApprovalTemplate {
  katholische_konservative?: number;
  gewerkschafter?: number;
  urbane_progressive?: number;
  wirtschaftsliberale?: number;
  ost_post_industriell?: number;
  gruene_mittelschicht?: number;
  rentner_west?: number;
  migranten_communities?: number;
  landwirte_dorf?: number;
  junge_grossstadt?: number;
  protest_waehler_ost?: number;
  mittelstand_selbstaendige?: number;
}

/**
 * JP domain affinities: how each JP archetype reacts to RIGHTWARD policy shifts.
 * Positive = likes rightward (more market/traditional) shifts.
 * Negative = likes leftward (more progressive/state-led) shifts.
 *
 * Calibrated to Japanese political context (aging society, disaster prep,
 * overwork culture, pacifism, agricultural subsidies, etc.)
 */
export const JP_DOMAIN_AFFINITIES: Record<PolicyDomain, JPArchetypeApprovalTemplate> = {
  // Placeholders — JP has agriculture/technology laws but no archetype-approval
  // data designed yet; fill in to enable approval previews for them.
  agriculture: {},
  technology: {},
  education: {
    salaryman_conservative: 5,
    urban_progressive: -30,
    rural_traditionalist: 15,
    young_urban: -20,
    retiree: 5,
    public_sector: -40,
    small_business: 10,
    komeito_faithful: -5,
    reform_populist: 20,
    working_mothers: -25,
  },
  healthcare: {
    salaryman_conservative: -10,
    urban_progressive: -30,
    rural_traditionalist: -15,
    young_urban: -20,
    retiree: -45,
    public_sector: -35,
    small_business: 5,
    komeito_faithful: -20,
    reform_populist: 15,
    working_mothers: -30,
  },
  environment: {
    salaryman_conservative: 5,
    urban_progressive: -40,
    rural_traditionalist: 10,
    young_urban: -35,
    retiree: -5,
    public_sector: -20,
    small_business: 15,
    komeito_faithful: -10,
    reform_populist: 10,
    working_mothers: -25,
  },
  immigration: {
    salaryman_conservative: 15,
    urban_progressive: -25,
    rural_traditionalist: 30,
    young_urban: -15,
    retiree: 20,
    public_sector: -10,
    small_business: 5,
    komeito_faithful: 0,
    reform_populist: 10,
    working_mothers: -5,
  },
  criminal_justice: {
    salaryman_conservative: 20,
    urban_progressive: -25,
    rural_traditionalist: 25,
    young_urban: -20,
    retiree: 15,
    public_sector: -15,
    small_business: 10,
    komeito_faithful: 5,
    reform_populist: 15,
    working_mothers: -10,
  },
  defense: {
    salaryman_conservative: 20,
    urban_progressive: -35,
    rural_traditionalist: 15,
    young_urban: -25,
    retiree: 10,
    public_sector: -10,
    small_business: 5,
    komeito_faithful: -20,
    reform_populist: 15,
    working_mothers: -15,
  },
  economic: {
    salaryman_conservative: 15,
    urban_progressive: -25,
    rural_traditionalist: 5,
    young_urban: -15,
    retiree: 0,
    public_sector: -30,
    small_business: 35,
    komeito_faithful: 0,
    reform_populist: 30,
    working_mothers: -10,
  },
  welfare: {
    salaryman_conservative: 10,
    urban_progressive: -35,
    rural_traditionalist: 5,
    young_urban: -25,
    retiree: -30,
    public_sector: -25,
    small_business: 15,
    komeito_faithful: -15,
    reform_populist: 20,
    working_mothers: -35,
  },
  infrastructure: {
    salaryman_conservative: 10,
    urban_progressive: -15,
    rural_traditionalist: -20,
    young_urban: -10,
    retiree: -5,
    public_sector: -10,
    small_business: 5,
    komeito_faithful: -5,
    reform_populist: 15,
    working_mothers: -10,
  },
  governance: {
    salaryman_conservative: 10,
    urban_progressive: -20,
    rural_traditionalist: 15,
    young_urban: -15,
    retiree: 5,
    public_sector: -25,
    small_business: 10,
    komeito_faithful: 0,
    reform_populist: 25,
    working_mothers: -10,
  },
  foreign_policy: {
    salaryman_conservative: 15,
    urban_progressive: -20,
    rural_traditionalist: 10,
    young_urban: -10,
    retiree: 10,
    public_sector: -5,
    small_business: 10,
    komeito_faithful: -10,
    reform_populist: 15,
    working_mothers: -5,
  },
  tax: {
    salaryman_conservative: 15,
    urban_progressive: -30,
    rural_traditionalist: 10,
    young_urban: -15,
    retiree: -10,
    public_sector: -25,
    small_business: 35,
    komeito_faithful: 0,
    reform_populist: 25,
    working_mothers: -15,
  },
  mediaInformation: {
    salaryman_conservative: 5,
    urban_progressive: -25,
    rural_traditionalist: 10,
    young_urban: -20,
    retiree: 5,
    public_sector: -15,
    small_business: 5,
    komeito_faithful: 0,
    reform_populist: 10,
    working_mothers: -10,
  },
};

/**
 * DE domain affinities: how German archetypes react to RIGHTWARD policy shifts.
 * Positive = likes market-oriented / traditional / restrictive shifts.
 * Negative = likes redistributive / progressive / permissive shifts.
 */
export const DE_DOMAIN_AFFINITIES: Record<PolicyDomain, DEArchetypeApprovalTemplate> = {
  // Placeholders — DE has agriculture/technology laws but no archetype-approval
  // data designed yet; fill in to enable approval previews for them.
  agriculture: {},
  technology: {},
  education: {
    katholische_konservative: 15,
    gewerkschafter: -20,
    urbane_progressive: -25,
    wirtschaftsliberale: 10,
    ost_post_industriell: -5,
    gruene_mittelschicht: -30,
    rentner_west: 5,
    migranten_communities: -15,
    landwirte_dorf: 10,
    junge_grossstadt: -20,
    protest_waehler_ost: 10,
    mittelstand_selbstaendige: 10,
  },
  healthcare: {
    katholische_konservative: -10,
    gewerkschafter: -30,
    urbane_progressive: -25,
    wirtschaftsliberale: 10,
    ost_post_industriell: -15,
    gruene_mittelschicht: -20,
    rentner_west: -40,
    migranten_communities: -20,
    landwirte_dorf: -10,
    junge_grossstadt: -20,
    protest_waehler_ost: -10,
    mittelstand_selbstaendige: 10,
  },
  environment: {
    katholische_konservative: 10,
    gewerkschafter: -10,
    urbane_progressive: -40,
    wirtschaftsliberale: 15,
    ost_post_industriell: 10,
    gruene_mittelschicht: -50,
    rentner_west: 5,
    migranten_communities: -5,
    landwirte_dorf: 30,
    junge_grossstadt: -40,
    protest_waehler_ost: 20,
    mittelstand_selbstaendige: 15,
  },
  immigration: {
    katholische_konservative: 20,
    gewerkschafter: 5,
    urbane_progressive: -30,
    wirtschaftsliberale: -5,
    ost_post_industriell: 25,
    gruene_mittelschicht: -35,
    rentner_west: 15,
    migranten_communities: -50,
    landwirte_dorf: 25,
    junge_grossstadt: -20,
    protest_waehler_ost: 45,
    mittelstand_selbstaendige: -5,
  },
  criminal_justice: {
    katholische_konservative: 15,
    gewerkschafter: 5,
    urbane_progressive: -25,
    wirtschaftsliberale: 5,
    ost_post_industriell: 20,
    gruene_mittelschicht: -20,
    rentner_west: 15,
    migranten_communities: -20,
    landwirte_dorf: 20,
    junge_grossstadt: -25,
    protest_waehler_ost: 25,
    mittelstand_selbstaendige: 10,
  },
  defense: {
    katholische_konservative: 15,
    gewerkschafter: -10,
    urbane_progressive: -20,
    wirtschaftsliberale: 5,
    ost_post_industriell: 10,
    gruene_mittelschicht: -25,
    rentner_west: 10,
    migranten_communities: -5,
    landwirte_dorf: 10,
    junge_grossstadt: -20,
    protest_waehler_ost: 15,
    mittelstand_selbstaendige: 10,
  },
  economic: {
    katholische_konservative: 10,
    gewerkschafter: -35,
    urbane_progressive: -15,
    wirtschaftsliberale: 35,
    ost_post_industriell: -15,
    gruene_mittelschicht: -10,
    rentner_west: 5,
    migranten_communities: -5,
    landwirte_dorf: 10,
    junge_grossstadt: -20,
    protest_waehler_ost: 10,
    mittelstand_selbstaendige: 40,
  },
  welfare: {
    katholische_konservative: 0,
    gewerkschafter: -25,
    urbane_progressive: -20,
    wirtschaftsliberale: 15,
    ost_post_industriell: -10,
    gruene_mittelschicht: -15,
    rentner_west: -20,
    migranten_communities: -20,
    landwirte_dorf: 10,
    junge_grossstadt: -25,
    protest_waehler_ost: 5,
    mittelstand_selbstaendige: 20,
  },
  infrastructure: {
    katholische_konservative: 0,
    gewerkschafter: -20,
    urbane_progressive: -10,
    wirtschaftsliberale: 5,
    ost_post_industriell: -10,
    gruene_mittelschicht: -10,
    rentner_west: -5,
    migranten_communities: -5,
    landwirte_dorf: -5,
    junge_grossstadt: -15,
    protest_waehler_ost: -5,
    mittelstand_selbstaendige: 0,
  },
  governance: {
    katholische_konservative: 10,
    gewerkschafter: -5,
    urbane_progressive: -15,
    wirtschaftsliberale: 10,
    ost_post_industriell: 10,
    gruene_mittelschicht: -10,
    rentner_west: 5,
    migranten_communities: -10,
    landwirte_dorf: 5,
    junge_grossstadt: -15,
    protest_waehler_ost: 20,
    mittelstand_selbstaendige: 10,
  },
  foreign_policy: {
    katholische_konservative: 10,
    gewerkschafter: -5,
    urbane_progressive: -10,
    wirtschaftsliberale: 10,
    ost_post_industriell: 5,
    gruene_mittelschicht: -15,
    rentner_west: 5,
    migranten_communities: -5,
    landwirte_dorf: 5,
    junge_grossstadt: -10,
    protest_waehler_ost: 10,
    mittelstand_selbstaendige: 10,
  },
  tax: {
    katholische_konservative: 15,
    gewerkschafter: -25,
    urbane_progressive: -15,
    wirtschaftsliberale: 35,
    ost_post_industriell: -5,
    gruene_mittelschicht: -15,
    rentner_west: -5,
    migranten_communities: -5,
    landwirte_dorf: 10,
    junge_grossstadt: -15,
    protest_waehler_ost: 5,
    mittelstand_selbstaendige: 40,
  },
  mediaInformation: {
    katholische_konservative: 10,
    gewerkschafter: -10,
    urbane_progressive: -20,
    wirtschaftsliberale: 5,
    ost_post_industriell: 10,
    gruene_mittelschicht: -20,
    rentner_west: 5,
    migranten_communities: -15,
    landwirte_dorf: 10,
    junge_grossstadt: -20,
    protest_waehler_ost: 20,
    mittelstand_selbstaendige: 5,
  },
};

/**
 * CN domain affinities: how each CN archetype reacts to RIGHTWARD policy shifts.
 * Positive = likes rightward (more market, more traditional-authoritarian).
 * Negative = likes leftward (more state, more liberalizing).
 *
 * Calibrated to intra-CCP factional dynamics on a two-axis spectrum:
 *   Economic: state-capitalist / 共同富裕 left ↔ market-reformist right
 *   Social:   authoritarian-traditional ↔ liberalizing
 *
 * Anchors derived from spec §6.2 of 2026-05-27-cn-legislation-overhaul-design.md.
 */
export const CN_DOMAIN_AFFINITIES: Record<PolicyDomain, CNArchetypeApprovalTemplate> = {
  // Placeholders — CN has agriculture/technology laws but no archetype-approval
  // data designed yet; fill in to enable approval previews for them.
  agriculture: {},
  technology: {},
  // EDUCATION: exam-meritocracy reinforcement vs reform / 双减 liberalization
  education: {
    party_cadre: 10,
    urban_professional: 0,
    rural_peasant: 5,
    industrial_worker: -5,
    migrant_worker: -20,
    entrepreneur: 5,
    youth: -25,
  },

  // HEALTHCARE: privatization vs state expansion
  healthcare: {
    party_cadre: -10,
    urban_professional: 10,
    rural_peasant: -35,
    industrial_worker: -25,
    migrant_worker: -40,
    entrepreneur: 15,
    youth: -30,
  },

  // ENVIRONMENT: growth-priority vs 双碳 decarbonization
  environment: {
    party_cadre: 5,
    urban_professional: -25,
    rural_peasant: -15,
    industrial_worker: 20,
    migrant_worker: -10,
    entrepreneur: 30,
    youth: -40,
  },

  // IMMIGRATION (Hukou / internal migration): liberalization vs entrenchment
  immigration: {
    party_cadre: 5,
    urban_professional: -20,
    rural_peasant: 10,
    industrial_worker: 5,
    migrant_worker: -50,
    entrepreneur: -10,
    youth: -25,
  },

  // CRIMINAL JUSTICE: stricter enforcement vs reform / due process
  criminal_justice: {
    party_cadre: 25,
    urban_professional: -10,
    rural_peasant: 15,
    industrial_worker: 10,
    migrant_worker: -20,
    entrepreneur: 0,
    youth: -25,
  },

  // DEFENSE: expanded mission vs restraint
  defense: {
    party_cadre: 25,
    urban_professional: -10,
    rural_peasant: 10,
    industrial_worker: 10,
    migrant_worker: -15,
    entrepreneur: 0,
    youth: -25,
  },

  // ECONOMIC: market liberalization vs state-led
  economic: {
    party_cadre: -5,
    urban_professional: 20,
    rural_peasant: -10,
    industrial_worker: -25,
    migrant_worker: -25,
    entrepreneur: 35,
    youth: -10,
  },

  // WELFARE: cuts vs expansion (共同富裕 framing)
  welfare: {
    party_cadre: -10,
    urban_professional: 0,
    rural_peasant: -35,
    industrial_worker: -20,
    migrant_worker: -40,
    entrepreneur: 15,
    youth: -25,
  },

  // INFRASTRUCTURE: privatization vs state-led
  infrastructure: {
    party_cadre: -15,
    urban_professional: -10,
    rural_peasant: -20,
    industrial_worker: -20,
    migrant_worker: -25,
    entrepreneur: 0,
    youth: -5,
  },

  // GOVERNANCE: strengthen Party authority vs liberalize
  governance: {
    party_cadre: 30,
    urban_professional: -20,
    rural_peasant: 10,
    industrial_worker: 5,
    migrant_worker: -15,
    entrepreneur: -15,
    youth: -30,
  },

  // FOREIGN POLICY: nationalist assertion vs cooperative engagement
  foreign_policy: {
    party_cadre: 25,
    urban_professional: -15,
    rural_peasant: 10,
    industrial_worker: 15,
    migrant_worker: 0,
    entrepreneur: -5,
    youth: -25,
  },

  // TAX: market liberalization (cuts) vs state redistribution (raises)
  tax: {
    party_cadre: 5,
    urban_professional: 25,
    rural_peasant: -25,
    industrial_worker: -20,
    migrant_worker: -30,
    entrepreneur: 35,
    youth: -15,
  },

  // MEDIA / INFORMATION: stricter press control vs press freedom
  mediaInformation: {
    party_cadre: 25,
    urban_professional: -20,
    rural_peasant: 10,
    industrial_worker: 5,
    migrant_worker: -15,
    entrepreneur: -10,
    youth: -30,
  },
};
