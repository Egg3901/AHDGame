import type { StateDemographics } from "@/lib/db/types";

/**
 * Brazil macro-region demographics — 1979 era (independently authored).
 *
 * Era anchor: the final years of the military regime, with Figueiredo's
 * abertura just beginning (amnesty law 1979, party reform dissolving
 * ARENA/MDB in late 1979). Voting compulsory but illiterates still
 * disenfranchised until 1985, which depresses effective turnout among the
 * rural and urban poor. Brazil is still majority-recently-rural: the great
 * urbanization wave is mid-stream, the Nordeste is dominated by oligarchic
 * landholding ("coronelismo"), and the Centro-Oeste agribusiness frontier
 * is only just opening (cerrado soy pioneering, Embrapa breakthroughs).
 *
 * Group-by-group anchors:
 * - evangelical_conservative: Pentecostal share ~5% nationally; politically
 *   quiescent ("believers don't mix with politics"), socially very
 *   conservative, mildly pro-regime.
 * - working_class_pt: nascent — the PT is founded only in 1980. The base is
 *   the ABC São Paulo metalworker strikes of 1978-79 (Lula's union), so the
 *   group is meaningful only in the Sudeste and small everywhere else.
 * - rural_agribusiness: here a traditional/oligarchic rural electorate, the
 *   regime's ARENA vote bank, largest cohort in N/NE/CO.
 * - urban_middle_class: beneficiary of the "economic miracle" years, still
 *   leaning pro-regime/order despite the late-70s slowdown.
 * - urban_poor: swelling favelas from rural exodus; low effective turnout
 *   (illiteracy bar).
 * - business_financial: strongly pro-regime, developmentalist-corporatist.
 * - young_progressive: student-movement opposition (UNE re-founded 1979),
 *   small but socially the most liberal cohort of the era.
 *
 * Methodology: every population share, lean, and turnout below was authored
 * independently from 1970/1980 IBGE census structure and regime-era
 * political history — NOT derived by scaling the 2019 file. Populations per
 * region sum to 100 per the seed convention; state IDs and group IDs match
 * `brRegionDemographics.ts` exactly.
 */
export const brRegionDemographics1979: StateDemographics[] = [
  // ── Norte ──────────────────────────────────────────────────────────────────

  // Norte: sparsely settled Amazon; regime colonization projects
  // (Transamazônica, Zona Franca de Manaus) just drawing migrants; rural and
  // extractive economy dominates; tiny evangelical presence.
  {
    _id: "NORTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 5, economicLean: 2, socialLean: 5, turnout: 74 },
      working_class_pt: { population: 4, economicLean: -4, socialLean: -1, turnout: 70 },
      rural_agribusiness: { population: 38, economicLean: 3, socialLean: 4, turnout: 64 },
      urban_middle_class: { population: 8, economicLean: 2, socialLean: 1, turnout: 80 },
      urban_poor: { population: 22, economicLean: -3, socialLean: 0, turnout: 58 },
      afro_brazilian: { population: 12, economicLean: -2, socialLean: -1, turnout: 54 },
      business_financial: { population: 3, economicLean: 4, socialLean: 2, turnout: 84 },
      young_progressive: { population: 8, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // ── Nordeste ───────────────────────────────────────────────────────────────

  // Nordeste: oligarchic rural heartland — coronelismo delivers the ARENA
  // vote; highest illiteracy in Brazil (large disenfranchised poor); heavy
  // out-migration to the Sudeste underway; PT essentially absent.
  {
    _id: "NORDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 5, economicLean: 2, socialLean: 5, turnout: 74 },
      working_class_pt: { population: 5, economicLean: -4, socialLean: -1, turnout: 70 },
      rural_agribusiness: { population: 36, economicLean: 3, socialLean: 4, turnout: 64 },
      urban_middle_class: { population: 7, economicLean: 2, socialLean: 1, turnout: 80 },
      urban_poor: { population: 24, economicLean: -3, socialLean: 0, turnout: 58 },
      afro_brazilian: { population: 14, economicLean: -2, socialLean: -1, turnout: 54 },
      business_financial: { population: 2, economicLean: 4, socialLean: 2, turnout: 84 },
      young_progressive: { population: 7, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // ── Centro-Oeste ───────────────────────────────────────────────────────────

  // Centro-Oeste: agribusiness frontier just opening — cerrado soy pioneers
  // arriving from the Sul; Brasília's federal workforce anchors an outsized
  // middle class for the era; otherwise traditional ranching country.
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 6, economicLean: 2, socialLean: 5, turnout: 74 },
      working_class_pt: { population: 5, economicLean: -4, socialLean: -1, turnout: 70 },
      rural_agribusiness: { population: 40, economicLean: 3, socialLean: 4, turnout: 64 },
      urban_middle_class: { population: 14, economicLean: 2, socialLean: 1, turnout: 80 },
      urban_poor: { population: 16, economicLean: -3, socialLean: 0, turnout: 58 },
      afro_brazilian: { population: 6, economicLean: -2, socialLean: -1, turnout: 54 },
      business_financial: { population: 5, economicLean: 4, socialLean: 2, turnout: 84 },
      young_progressive: { population: 8, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // ── Sudeste ────────────────────────────────────────────────────────────────

  // Sudeste: industrial core of the "miracle"; ABC São Paulo metalworker
  // strikes (1978-79) make this the ONE region where the proto-PT base is
  // real; large miracle-era middle class; favelas growing fast from
  // nordestino migration.
  {
    _id: "SUDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 6, economicLean: 2, socialLean: 5, turnout: 74 },
      working_class_pt: { population: 14, economicLean: -4, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 14, economicLean: 3, socialLean: 4, turnout: 64 },
      urban_middle_class: { population: 20, economicLean: 2, socialLean: 1, turnout: 80 },
      urban_poor: { population: 22, economicLean: -3, socialLean: 0, turnout: 58 },
      afro_brazilian: { population: 10, economicLean: -2, socialLean: -1, turnout: 54 },
      business_financial: { population: 7, economicLean: 4, socialLean: 2, turnout: 84 },
      young_progressive: { population: 7, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // ── Sul ────────────────────────────────────────────────────────────────────

  // Sul: European-settler smallholder agriculture (not yet "agribusiness" in
  // the modern sense); literate, orderly, high effective turnout; an MDB
  // opposition streak in Rio Grande do Sul but a broadly conservative mix.
  {
    _id: "SUL",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 4, economicLean: 2, socialLean: 5, turnout: 74 },
      working_class_pt: { population: 8, economicLean: -4, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 32, economicLean: 3, socialLean: 4, turnout: 68 },
      urban_middle_class: { population: 22, economicLean: 2, socialLean: 1, turnout: 80 },
      urban_poor: { population: 14, economicLean: -3, socialLean: 0, turnout: 58 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -1, turnout: 54 },
      business_financial: { population: 8, economicLean: 4, socialLean: 2, turnout: 84 },
      young_progressive: { population: 8, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },
];
