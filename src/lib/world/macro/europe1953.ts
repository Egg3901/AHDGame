/**
 * European 1953 sphere-macro roster (#3719, #3723).
 *
 * GDP magnitudes are authored in the same game units as Austria's oracle
 * (AT = 7_500 ≈ 12% of West German 1953 regional sum). Historical notes cite
 * UN / national statistical yearbooks and Maddison-scale relative sizes;
 * values are strong defaults, not rails. Planned economies deliberately use
 * lower tradeExposure and never seed market corporations.
 *
 * AT/FI/GR/IE/FR/IT/SE/TR were briefly demoted to sphere-macro by false readiness
 * claim (#3723); contract probes re-promoted them to full-autonomous
 * economy-preview. Their authored macro specs remain below as dormant
 * reference for a possible future Tier-2 migration — they are NOT in
 * {@link EUROPE_1953_MACRO_SPECS} and must not be seeded by seedMacroCountries.
 *
 * ES is the inverse case: demoted FROM full-autonomous TO sphere-macro for
 * 1953-default only (owner decision, 2026-07-28) — Franco's Spain has both
 * chambers (congresoDiputados, Senado) era-gated off, so a full-autonomous
 * classification modeled a legislature that never held an election. Its
 * authored spec below is active (not dormant) and IS seeded by
 * seedMacroCountries. ES stays full-autonomous in every later 1953+ preset
 * (1979/1991/1999/2007-default) and historical-presence in 2019-default —
 * this file only ever contributes to the 1953-default manifest.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { AUSTRIA_ENTITY_ID, AUSTRIA_1953_SPEC, getAustria1953MacroCountry } from "./austria1953";
import { buildMacroCountryFromSpec, type MacroCountrySeedSpec } from "./seedBuilder";
import type { MacroCountryState } from "./types";

/** Market neutrals / Western fringe retained as dormant reference specs. */
export const FINLAND_ENTITY_ID = "FI";
export const GREECE_ENTITY_ID = "GR";
export const IRELAND_ENTITY_ID = "IE";

/**
 * CountryId-backed market economies re-promoted to full-autonomous (#3723).
 * Entity ids retained for dormant macro-spec reference / future migration.
 * ES is the exception: demoted back to sphere-macro for 1953-default only
 * (2026-07-28) — see the file-level doc comment above.
 */
export const FRANCE_ENTITY_ID = "FR";
export const ITALY_ENTITY_ID = "IT";
export const SPAIN_ENTITY_ID = "ES";
export const SWEDEN_ENTITY_ID = "SE";
export const TURKEY_ENTITY_ID = "TR";

/** Planned / socialist economies (CountryId-backed cold-war stubs). */
export const POLAND_ENTITY_ID = "PL";
export const CZECHOSLOVAKIA_ENTITY_ID = "CS";
export const HUNGARY_ENTITY_ID = "HU";
export const ROMANIA_ENTITY_ID = "RO";
export const BULGARIA_ENTITY_ID = "BG";
export const YUGOSLAVIA_ENTITY_ID = "YU";

/** Soviet union republics modelled as their own countries. */
export const UKRAINE_ENTITY_ID = "UKR";
export const BYELORUSSIA_ENTITY_ID = "BLR";
export const BALTIC_ENTITY_ID = "BAL";

const FI_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Paper/pulp + metalworking after war reparations to the USSR (ended 1952).
  manufacturing: 22,
  agriculture: 18,
  extraction: 12, // timber counted via forestry + pulp pulp feedstock
  energy: 8, // hydro + peat
  construction: 8,
  logistics: 6,
  retail: 5,
  chemical_industries: 4,
  financial: 3,
  real_estate: 3,
  healthcare: 3,
  defense: 3, // constrained by FCMA with USSR
  telecommunications: 2,
  media: 1,
  entertainment: 1,
  automobiles: 1,
  technology: 0,
};

const GR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Post-civil-war reconstruction; Marshall Plan; NATO from 1952.
  agriculture: 28,
  manufacturing: 14,
  construction: 10,
  retail: 8,
  logistics: 8, // merchant marine rebuilding
  extraction: 6, // bauxite, lignite
  energy: 5,
  financial: 4,
  real_estate: 4,
  defense: 4,
  healthcare: 3,
  chemical_industries: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 1,
  technology: 0,
};

const IE_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Matches sectorSeedWeights1953 IE authoring (cattle exports, ESB peat, protected industry).
  agriculture: 22,
  manufacturing: 18,
  construction: 10,
  energy: 8,
  retail: 8,
  logistics: 5,
  financial: 5,
  real_estate: 4,
  defense: 2,
  telecommunications: 2,
  media: 2,
  healthcare: 2,
  extraction: 1,
  entertainment: 1,
  automobiles: 1,
  chemical_industries: 1,
  technology: 0,
};

const PL_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 22,
  manufacturing: 20,
  extraction: 15, // Silesian coal
  defense: 12,
  construction: 8,
  chemical_industries: 5,
  energy: 5,
  logistics: 4,
  healthcare: 4,
  retail: 1,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  entertainment: 1,
  technology: 0,
};

const CS_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 30, // most industrialized Eastern Bloc
  defense: 14,
  agriculture: 12,
  chemical_industries: 8,
  extraction: 8, // Ostrava coal + Jáchymov uranium
  construction: 8,
  energy: 6,
  logistics: 5,
  healthcare: 4,
  automobiles: 3,
  retail: 1,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  technology: 1,
  entertainment: 1,
};

const HU_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 22,
  agriculture: 20,
  defense: 12,
  extraction: 8, // bauxite
  construction: 8,
  chemical_industries: 5,
  energy: 5,
  logistics: 4,
  healthcare: 4,
  retail: 2,
  entertainment: 2,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  technology: 0,
};

const RO_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 30,
  manufacturing: 18,
  extraction: 12, // Ploiești oil
  defense: 10,
  energy: 6,
  construction: 6,
  chemical_industries: 4,
  logistics: 4,
  healthcare: 3,
  retail: 2,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  entertainment: 1,
  technology: 0,
};

// Union-republic weights. Deliberately NOT copies of the satellites': a union
// republic has no consumer or financial sector to speak of, so the weight that
// would sit in retail/financial elsewhere goes to heavy industry and extraction.
const UKR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 26, // black earth: grain, sugar beet, sunflower
  manufacturing: 18, // Dnieper metallurgy; Kharkiv machine building
  extraction: 14, // Donbas coal; Kryvyi Rih ore; Nikopol manganese
  construction: 8, // rebuilding cities destroyed to the foundations
  defense: 7,
  energy: 7,
  logistics: 5,
  chemical_industries: 4,
  healthcare: 3,
  retail: 2,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  entertainment: 1,
  technology: 0,
};

const BLR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 25, // potato, flax, dairy; still a farm republic in 1953
  manufacturing: 20, // MAZ trucks; all-Union machine-building investment
  construction: 10, // roughly 80% of Minsk had to be rebuilt
  defense: 12, // the western frontier military district
  extraction: 5, // peat, potash at Salihorsk, timber
  energy: 5,
  logistics: 5, // the Brest transit corridor to the West
  chemical_industries: 4,
  healthcare: 4,
  retail: 2,
  automobiles: 2,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  entertainment: 1,
  technology: 0,
};

const BAL_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 22, // VEF Riga; Estonian machinery; textiles
  agriculture: 15, // dairy and fishing; less rural than the union average
  defense: 10, // Baltic Fleet bases and coastal defence
  extraction: 8, // Estonian oil shale, the republics' one strategic mineral
  construction: 6,
  logistics: 6, // Riga, Tallinn, Klaipeda - the union's western outlet
  energy: 6, // oil-shale electricity, unique in the USSR
  chemical_industries: 5,
  healthcare: 5, // the best health outcomes in the union
  retail: 3, // the best-supplied shops in the union
  entertainment: 3,
  media: 2, // Baltic-language press, permitted here and nowhere else
  real_estate: 2, // surviving pre-war housing stock
  telecommunications: 2,
  technology: 2,
  financial: 1,
  automobiles: 1,
};

const BG_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 40, // tobacco, wine, roses
  manufacturing: 15,
  defense: 10,
  construction: 7,
  extraction: 5,
  energy: 5,
  logistics: 4,
  healthcare: 3,
  chemical_industries: 3,
  retail: 2,
  media: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  entertainment: 1,
  technology: 0,
};

const YU_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Tito path: abandoned Soviet collectivization 1953; US aid; self-management.
  agriculture: 25,
  manufacturing: 20,
  defense: 12,
  construction: 8,
  retail: 5,
  extraction: 5,
  energy: 5,
  chemical_industries: 4,
  logistics: 4,
  healthcare: 3,
  financial: 2,
  entertainment: 2,
  media: 1,
  real_estate: 1,
  telecommunications: 1,
  automobiles: 1,
  technology: 0,
};

/** Matches sectorSeedWeights1953 FR (Fourth Republic / Trente Glorieuses start). */
const FR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 25,
  agriculture: 15,
  construction: 10,
  energy: 8,
  automobiles: 6,
  chemical_industries: 5,
  financial: 5,
  retail: 5,
  logistics: 4,
  real_estate: 3,
  defense: 3, // Indochina; NATO
  telecommunications: 2,
  media: 2,
  healthcare: 2,
  extraction: 2, // Lorraine coal/iron
  entertainment: 1,
  technology: 0,
};

/** Matches sectorSeedWeights1953 IT (IRI / Miracolo Economico dawn). */
const IT_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 24,
  agriculture: 20,
  construction: 12,
  energy: 7, // ENI founded 1953
  automobiles: 6,
  real_estate: 5,
  retail: 5,
  financial: 5,
  logistics: 4,
  chemical_industries: 4,
  defense: 2,
  healthcare: 2,
  telecommunications: 2,
  media: 2,
  extraction: 1,
  entertainment: 1,
  technology: 0,
};

/** Matches sectorSeedWeights1953 ES (Franco autarky → Pact of Madrid 1953). */
const ES_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 25,
  manufacturing: 18,
  construction: 10,
  energy: 10,
  extraction: 6, // Vizcaya iron; Río Tinto
  logistics: 4,
  financial: 4,
  retail: 4,
  real_estate: 3,
  defense: 3,
  telecommunications: 2,
  media: 2,
  healthcare: 2,
  automobiles: 1, // SEAT founded 1950
  chemical_industries: 1,
  entertainment: 1,
  technology: 0,
};

/** Matches sectorSeedWeights1953 SE (Erlander / export industry / folkhemmet). */
const SE_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 26,
  energy: 10, // Vattenfall hydro
  agriculture: 8,
  construction: 8,
  financial: 7,
  automobiles: 6, // Volvo / SAAB
  logistics: 5,
  chemical_industries: 5,
  retail: 5,
  defense: 4, // neutral conscript + SAAB
  healthcare: 3,
  real_estate: 3,
  media: 2,
  telecommunications: 2,
  extraction: 2, // Kiruna iron
  entertainment: 1,
  technology: 0,
};

/** Matches sectorSeedWeights1953 TR (Menderes / NATO / agrarian majority). */
const TR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 40,
  manufacturing: 14,
  construction: 10,
  energy: 8,
  logistics: 6,
  extraction: 5, // chrome, copper, boron, coal
  real_estate: 3,
  financial: 3,
  retail: 3,
  defense: 3, // NATO 1952; Korea veterans
  healthcare: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  chemical_industries: 0,
  technology: 0,
};

/**
 * Authored 1953 specs. Populations: national censuses / UN early-1950s.
 * GDP: relative Maddison-scale sizing anchored to Austria = 7_500.
 *
 * Active Tier-2 roster excludes IE/FR/IT/SE/TR and Eastern bloc PL/CS/HU/RO/BG/YU
 * plus the union republics UKR/BLR/BAL
 * (re-promoted to full-autonomous). Their specs live in
 * {@link DORMANT_REPROMOTED_EUROPE_1953_MACRO_SPECS}. ES rejoins this active
 * roster (owner decision, 2026-07-28) — see the file-level doc comment above.
 */
export const EUROPE_1953_MACRO_SPECS: readonly MacroCountrySeedSpec[] = [
  {
    entityId: SPAIN_ENTITY_ID,
    displayName: "Spain",
    economicSystem: "market",
    // 1950 census ≈ 28.2M.
    population: 28_200_000,
    // Mid economy: Franco autarky recovery; ~2.2× Austria (below Italy, above Sweden).
    annualGdpGameUnits: 16_500,
    fiscalCapacity: 0.18, // extractive but thin fiscal base under autarky
    stability: 0.72, // Franco dictatorship; 1953 Concordat + US bases pact
    // Autarky still binds; Pact of Madrid opens limited US leakage.
    tradeExposure: 0.22,
    sectorWeights: ES_WEIGHTS,
    resources: {
      iron: 12, // Vizcaya
      coal: 8,
      // Río Tinto copper / potash via rare_earth channel.
      rare_earth: 6,
      timber: 3,
      oil: 0,
      natural_gas: 0,
    },
  },
];

/**
 * Dormant macro specs for countries re-promoted to full-autonomous
 * (IE/FR/IT/SE/TR via #3723; PL/CS/HU/RO/BG/YU and the union republics
 * UKR/BLR/BAL via the 2026-07-25 product decision).
 * Kept for a possible future Tier-2 migration — not seeded by seedMacroCountries.
 * ES's spec left this list on 2026-07-28 — it is active above, not dormant.
 */
export const DORMANT_REPROMOTED_EUROPE_1953_MACRO_SPECS: readonly MacroCountrySeedSpec[] = [
  AUSTRIA_1953_SPEC,
  {
    entityId: IRELAND_ENTITY_ID,
    displayName: "Ireland",
    economicSystem: "market",
    // 1951 census Republic ≈ 2.96M; emigration crisis ongoing.
    population: 2_960_000,
    // Authored ieRegions1953 GDP sum is GBP millions (~570); scaled to AT game units.
    annualGdpGameUnits: 2_900,
    fiscalCapacity: 0.2,
    stability: 0.7,
    // Sterling-area trade; limited dollar openness under Marshall-era controls.
    tradeExposure: 0.38,
    sectorWeights: IE_WEIGHTS,
    resources: {
      coal: 2, // peat via Bord na Móna modelled as low-grade solid fuel
      timber: 3,
      iron: 1,
      oil: 0,
      rare_earth: 0,
    },
  },
  {
    entityId: FINLAND_ENTITY_ID,
    displayName: "Finland",
    economicSystem: "market",
    // 1950 census ≈ 4.03M; early-1950s growth to ~4.1–4.2M.
    population: 4_150_000,
    // Roughly on par with Austria in Maddison 1953 USD; paper exports + metalworking.
    annualGdpGameUnits: 7_200,
    fiscalCapacity: 0.24,
    stability: 0.78, // Paasikivi–Kekkonen continuity after war
    // FCMA (1948) constrains Western trade; still a market economy.
    tradeExposure: 0.32,
    sectorWeights: FI_WEIGHTS,
    resources: {
      // Only EXTRACTABLE_RESOURCES keys — copper folded into iron endowment.
      timber: 28, // dominant forest endowment
      iron: 10, // Outokumpu copper/iron complex approximated via iron
      coal: 1,
      rare_earth: 0,
    },
  },
  {
    entityId: GREECE_ENTITY_ID,
    displayName: "Greece",
    economicSystem: "market",
    // 1951 census ≈ 7.63M.
    population: 7_630_000,
    // Smaller industrial base than Austria; agriculture + shipping.
    annualGdpGameUnits: 4_800,
    fiscalCapacity: 0.18,
    stability: 0.58, // post-civil-war recovery; Papagos government from late 1952
    tradeExposure: 0.4, // NATO + US aid openness
    sectorWeights: GR_WEIGHTS,
    resources: {
      // Bauxite approximated via rare_earth (aluminium feedstock proxy).
      rare_earth: 10,
      coal: 4, // lignite
      iron: 2,
      timber: 3,
      oil: 0,
    },
  },
  {
    entityId: FRANCE_ENTITY_ID,
    displayName: "France",
    economicSystem: "market",
    // 1954 census ≈ 42.8M (Fourth Republic; Algeria still départemental).
    population: 42_800_000,
    // Maddison ~8× Austria; large ECSC industrial economy near West German scale.
    annualGdpGameUnits: 62_000,
    fiscalCapacity: 0.28, // dirigiste state (EDF, SNCF, nationalised banks)
    stability: 0.55, // Fourth Republic cabinet churn; Indochina war
    tradeExposure: 0.42, // ECSC 1951; OEEC; still colonial trade
    sectorWeights: FR_WEIGHTS,
    resources: {
      coal: 16, // Lorraine / Nord–Pas-de-Calais (Charbonnages de France)
      iron: 14, // Lorraine ore
      timber: 6,
      natural_gas: 3, // Lacq field developing from 1951
      oil: 1,
      rare_earth: 0,
    },
  },
  {
    entityId: ITALY_ENTITY_ID,
    displayName: "Italy",
    economicSystem: "market",
    // 1951 census ≈ 47.5M.
    population: 47_500_000,
    // Maddison ~6.4× Austria; IRI heavy industry + southern agrarian dualism.
    annualGdpGameUnits: 48_000,
    fiscalCapacity: 0.24,
    stability: 0.62, // De Gasperi DC era; legge truffa election 1953
    tradeExposure: 0.38, // OEEC / early EEC path; dollar shortage easing
    sectorWeights: IT_WEIGHTS,
    resources: {
      natural_gas: 12, // Po Valley / ENI (founded 1953)
      oil: 4, // ENI exploration; modest domestic
      timber: 4,
      coal: 2,
      iron: 2,
      rare_earth: 1, // Sicilian sulphur / Sardinian metals proxy
    },
  },
  {
    entityId: SWEDEN_ENTITY_ID,
    displayName: "Sweden",
    economicSystem: "market",
    // 1950 census ≈ 7.04M; early-1950s ≈ 7.1M.
    population: 7_100_000,
    // Mid-high productivity export economy; ~1.9× Austria on Maddison totals.
    annualGdpGameUnits: 14_000,
    fiscalCapacity: 0.32, // strong social-democratic tax state
    stability: 0.88, // Erlander continuity; folkhemmet
    tradeExposure: 0.48, // export-oriented (iron, timber, engineering)
    sectorWeights: SE_WEIGHTS,
    resources: {
      iron: 22, // Kiruna / LKAB
      timber: 18, // boreal forestry
      coal: 1,
      oil: 0,
      natural_gas: 0,
      rare_earth: 0,
    },
  },
  {
    entityId: TURKEY_ENTITY_ID,
    displayName: "Turkey",
    economicSystem: "market",
    // 1950 census 20.9M; ~22.5M by 1953 under Menderes.
    population: 22_500_000,
    // Lower-capacity agrarian economy; ~1.3× Austria total, low GDP/capita.
    annualGdpGameUnits: 9_500,
    fiscalCapacity: 0.16,
    stability: 0.6, // Democrat Party; NATO from 1952
    tradeExposure: 0.28, // Marshall / NATO orientation; still agrarian exports
    sectorWeights: TR_WEIGHTS,
    resources: {
      coal: 10, // Zonguldak
      // Chrome / boron / copper folded into iron + rare_earth channels.
      iron: 8,
      rare_earth: 6,
      timber: 3,
      oil: 1, // TPAO exploration; production still tiny
      natural_gas: 0,
    },
  },
  {
    entityId: POLAND_ENTITY_ID,
    displayName: "Poland",
    economicSystem: "planned",
    // GUS / UN mid-1950s ≈ 25.5M (matches plRegions1953).
    population: 25_500_000,
    annualGdpGameUnits: 18_500,
    fiscalCapacity: 0.28, // Stalinist extractive state
    stability: 0.55, // Bierut era; postwar trauma, collectivization pressure
    // COMECON orientation — limited convertible-currency leakage.
    tradeExposure: 0.18,
    sectorWeights: PL_WEIGHTS,
    resources: {
      coal: 32, // Silesia
      iron: 10, // includes Legnica copper start as iron-channel metals
      timber: 8,
      oil: 1,
      rare_earth: 0,
    },
  },
  {
    entityId: CZECHOSLOVAKIA_ENTITY_ID,
    displayName: "Czechoslovakia",
    economicSystem: "planned",
    // 1950 census / UN ≈ 12.4M.
    population: 12_400_000,
    // Most industrialized Eastern Bloc — high GDP/capita vs neighbours.
    annualGdpGameUnits: 15_000,
    fiscalCapacity: 0.3,
    stability: 0.52, // post-Slánský trials (1952); Gottwald dies March 1953
    tradeExposure: 0.2,
    sectorWeights: CS_WEIGHTS,
    resources: {
      coal: 18, // Ostrava
      iron: 6,
      timber: 5,
      rare_earth: 8, // Jáchymov uranium via rare_earth channel
      oil: 0,
    },
  },
  {
    entityId: HUNGARY_ENTITY_ID,
    displayName: "Hungary",
    economicSystem: "planned",
    // HCSO / UN early 1950s ≈ 9.5M.
    population: 9_500_000,
    annualGdpGameUnits: 6_800,
    fiscalCapacity: 0.27,
    stability: 0.48, // Rákosi repression; Nagy briefly PM mid-1953 under Soviet pressure
    tradeExposure: 0.17,
    sectorWeights: HU_WEIGHTS,
    resources: {
      // Bauxite (top-tier world producer) + manganese via rare_earth/iron proxies.
      rare_earth: 14,
      coal: 8,
      iron: 5,
      timber: 3,
      oil: 1,
    },
  },
  {
    entityId: ROMANIA_ENTITY_ID,
    displayName: "Romania",
    economicSystem: "planned",
    // UN / Romanian census series ≈ 16.6M.
    population: 16_600_000,
    annualGdpGameUnits: 7_800,
    fiscalCapacity: 0.26,
    stability: 0.5, // Gheorghiu-Dej consolidation
    tradeExposure: 0.16,
    sectorWeights: RO_WEIGHTS,
    resources: {
      oil: 22, // Ploiești
      natural_gas: 10,
      coal: 6,
      timber: 6,
      iron: 3,
      rare_earth: 0,
    },
  },
  {
    entityId: BULGARIA_ENTITY_ID,
    displayName: "Bulgaria",
    economicSystem: "planned",
    // Early-1950s ≈ 7.3M.
    population: 7_300_000,
    annualGdpGameUnits: 3_400,
    fiscalCapacity: 0.25,
    stability: 0.5, // Chervenkov "Little Stalin"
    tradeExposure: 0.15,
    sectorWeights: BG_WEIGHTS,
    resources: {
      coal: 6,
      iron: 4, // includes Medet copper start
      timber: 4,
      oil: 0,
      rare_earth: 0,
    },
  },
  // Union republics. GDP is expressed on the same relative Maddison scale as the
  // satellites above (Poland 25.5M -> 18_500), NOT converted from the ruble GDP
  // figures in the country seeds: the seeds price in rubles at administered
  // 1953 exchange rates, and dropping those numbers into a scale anchored on
  // Austria would make Byelorussia richer per head than Czechoslovakia.
  {
    entityId: UKRAINE_ENTITY_ID,
    displayName: "Ukrainian SSR",
    economicSystem: "planned",
    // Regional rollup of uaRegions1953.
    population: 41_000_000,
    // ~600 units/head: below Poland's 725, which is right - Ukraine lost a far
    // larger share of its capital stock and its 1946-47 famine is six years old.
    annualGdpGameUnits: 24_500,
    fiscalCapacity: 0.3, // a union republic remits through the all-Union budget
    stability: 0.48, // the western insurgency is only just being closed out
    tradeExposure: 0.08, // trades inside the union, not with the world
    sectorWeights: UKR_WEIGHTS,
    resources: {
      coal: 24, // Donbas
      iron: 20, // Kryvyi Rih; Nikopol manganese folded in
      natural_gas: 6, // Dashava
      timber: 3,
      oil: 2, // Boryslav, long past its peak
      rare_earth: 2,
    },
  },
  {
    entityId: BYELORUSSIA_ENTITY_ID,
    displayName: "Byelorussian SSR",
    economicSystem: "planned",
    population: 7_700_000,
    annualGdpGameUnits: 4_400, // ~570 units/head, just under Ukraine
    fiscalCapacity: 0.3,
    stability: 0.62, // the quietest republic in the union
    tradeExposure: 0.08,
    sectorWeights: BLR_WEIGHTS,
    resources: {
      timber: 10,
      // Peat carries half the union's reserves and is the republic's fuel; it
      // has no coal channel of its own, so it rides the coal resource.
      coal: 6,
      rare_earth: 5, // Salihorsk potash
      iron: 1,
      oil: 1,
      natural_gas: 0,
    },
  },
  {
    entityId: BALTIC_ENTITY_ID,
    displayName: "Baltic Republics",
    economicSystem: "planned",
    // Regional rollup of balRegions1953 (Estonia, Latvia, Lithuania).
    population: 2_900_000,
    // ~900 units/head, the highest of the three republics and above every
    // satellite except Czechoslovakia. This is the pre-war inheritance.
    annualGdpGameUnits: 2_600,
    fiscalCapacity: 0.3,
    stability: 0.4, // the lowest in the bloc: annexed 1940, resistance ongoing
    tradeExposure: 0.1, // slightly higher: the ports handle union transit
    sectorWeights: BAL_WEIGHTS,
    resources: {
      // Estonian oil shale is genuinely an oil resource here - it was refined
      // into shale oil and piped as gas to Leningrad.
      oil: 12,
      timber: 8,
      coal: 2,
      iron: 1,
      natural_gas: 0,
      rare_earth: 1,
    },
  },
  {
    entityId: YUGOSLAVIA_ENTITY_ID,
    displayName: "Yugoslavia",
    economicSystem: "planned",
    // 1953 census ≈ 16.9M.
    population: 16_900_000,
    annualGdpGameUnits: 9_800,
    fiscalCapacity: 0.23,
    stability: 0.62, // Tito consolidation; more open than Bloc
    // Non-aligned + US Mutual Defense Assistance → higher leakage than COMECON.
    tradeExposure: 0.28,
    sectorWeights: YU_WEIGHTS,
    resources: {
      // Bor copper + bauxite folded into iron/rare_earth channels.
      iron: 12,
      coal: 10,
      rare_earth: 5,
      timber: 7,
      oil: 1,
    },
  },
];
/** Full European Tier-2 roster including the Austria oracle. */
export const EUROPE_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] = EUROPE_1953_MACRO_SPECS.map(
  (spec) => spec.entityId
);

export const PLANNED_EUROPE_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] =
  EUROPE_1953_MACRO_SPECS.filter((spec) => spec.economicSystem === "planned").map(
    (spec) => spec.entityId
  );

const SPEC_BY_ID = new Map(EUROPE_1953_MACRO_SPECS.map((spec) => [spec.entityId, spec]));

export function getEurope1953MacroSpec(entityId: WorldEntityId): MacroCountrySeedSpec | undefined {
  return SPEC_BY_ID.get(entityId);
}

export function getEurope1953MacroCountry(
  entityId: WorldEntityId,
  now = new Date()
): MacroCountryState {
  if (entityId === AUSTRIA_ENTITY_ID) return getAustria1953MacroCountry(now);
  const spec = SPEC_BY_ID.get(entityId);
  if (!spec) {
    throw new Error(
      `No authored 1953 macro seed for ${entityId}; refusing modern-preset fallback.`
    );
  }
  return buildMacroCountryFromSpec(spec, now, { markInitialTick: true });
}

export function listEurope1953MacroCountries(now = new Date()): MacroCountryState[] {
  return EUROPE_1953_MACRO_ENTITY_IDS.map((entityId) => getEurope1953MacroCountry(entityId, now));
}
