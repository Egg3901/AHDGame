/**
 * African and American 1953 sphere-macro roster (#3721).
 *
 * GDP magnitudes use the same game units as Austria's oracle (AT = 7_500).
 * Populations: UN Demographic Yearbook / national censuses early-1950s.
 * GDP: Maddison-scale *relative* sizing vs Austria, lifted to a kernel floor
 * (~2_000+ annual game units) so commodity legs survive 0.01-unit rounding
 * after tradeExposure — strong defaults, not rails.
 * All ten were sovereign market economies in 1953 (no COMECON members here).
 * Colonial dependencies (Gold Coast, Congo, Algeria, etc.) remain Tier 3 until
 * authored sovereignty transitions — do not seed here. Nigeria is Tier-1
 * full-autonomous (product decision 2026-07-25), not a macro entry.
 * Resource keys are EXTRACTABLE_RESOURCES only; copper/gold/nickel/bauxite use
 * iron or rare_earth proxies where noted.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { buildMacroCountryFromSpec, type MacroCountrySeedSpec } from "./seedBuilder";
import type { MacroCountryState } from "./types";

export const ETHIOPIA_ENTITY_ID = "ET";
export const SOUTH_AFRICA_ENTITY_ID = "ZA";
export const CUBA_ENTITY_ID = "CU";
export const GUATEMALA_ENTITY_ID = "GT";
export const PANAMA_ENTITY_ID = "PA";
export const NICARAGUA_ENTITY_ID = "NI";
export const CHILE_ENTITY_ID = "CL";
export const ARGENTINA_ENTITY_ID = "AR";
export const MEXICO_ENTITY_ID = "MX";
export const VENEZUELA_ENTITY_ID = "VE";

const ET_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Imperial Ethiopia under Haile Selassie: highland agrarian, coffee, limited industry.
  agriculture: 48,
  retail: 10,
  logistics: 8,
  construction: 7,
  defense: 7,
  manufacturing: 6,
  extraction: 4, // modest gold / salt
  energy: 3,
  healthcare: 2,
  financial: 1,
  real_estate: 1,
  media: 1,
  entertainment: 1,
  telecommunications: 1,
  chemical_industries: 0,
  automobiles: 0,
  technology: 0,
};

const ZA_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Union of South Africa: Witwatersrand gold, coal, nascent manufacturing, apartheid labour.
  extraction: 22, // gold + coal + diamonds
  manufacturing: 18,
  agriculture: 14,
  logistics: 8,
  construction: 7,
  energy: 6,
  retail: 6,
  financial: 5,
  defense: 4,
  chemical_industries: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  technology: 0,
};

const CU_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Batista Cuba: sugar monoculture, US capital, tourism/services, nickel.
  agriculture: 32, // sugar + tobacco
  retail: 12,
  logistics: 10,
  manufacturing: 10,
  construction: 8,
  extraction: 6, // nickel
  entertainment: 6, // tourism / Havana services proxy
  financial: 4,
  energy: 3,
  defense: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  chemical_industries: 0,
  automobiles: 0,
  technology: 0,
};

const GT_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Arbenz Guatemala: coffee/banana plantation economy; land reform crisis 1952–54.
  agriculture: 42,
  retail: 10,
  logistics: 8,
  construction: 7,
  manufacturing: 7,
  extraction: 5, // timber; limited minerals
  defense: 5,
  energy: 3,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  media: 1,
  entertainment: 1,
  telecommunications: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const PA_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Panama Republic: Canal Zone transit rents dominate; thin domestic industrial base.
  logistics: 28, // canal / isthmian transit
  retail: 14,
  construction: 10,
  agriculture: 12,
  financial: 8,
  manufacturing: 6,
  defense: 5,
  real_estate: 5,
  energy: 3,
  healthcare: 2,
  extraction: 2,
  telecommunications: 2,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const NI_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Somoza Nicaragua: cattle/coffee/cotton; US-aligned dictatorship.
  agriculture: 40,
  retail: 10,
  logistics: 8,
  construction: 7,
  manufacturing: 7,
  defense: 6,
  extraction: 5, // gold + timber
  energy: 3,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  media: 1,
  entertainment: 1,
  telecommunications: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const CL_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Chile: copper (Chuquicamata / El Teniente), nitrates legacy, democratic politics.
  extraction: 22, // copper + nitrates
  agriculture: 18,
  manufacturing: 14,
  logistics: 8,
  construction: 7,
  retail: 7,
  energy: 5,
  financial: 4,
  defense: 3,
  chemical_industries: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  technology: 0,
};

const AR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Perón Argentina: Pampas agri-exports, ISI manufacturing, state-led industry.
  agriculture: 24,
  manufacturing: 20,
  construction: 8,
  logistics: 8,
  retail: 7,
  energy: 6,
  extraction: 5, // oil + minerals
  financial: 5,
  defense: 4,
  chemical_industries: 3,
  automobiles: 2,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  technology: 0,
};

const MX_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // PRI Mexico: oil (PEMEX), ISI manufacturing, agrarian base, political stability.
  agriculture: 22,
  manufacturing: 18,
  extraction: 12, // oil + silver/minerals
  construction: 8,
  logistics: 7,
  retail: 7,
  energy: 6,
  financial: 4,
  defense: 3,
  chemical_industries: 3,
  healthcare: 2,
  real_estate: 2,
  automobiles: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  technology: 0,
};

const VE_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Pérez Jiménez Venezuela: oil boom, iron ore (Cerro Bolívar), import-heavy consumption.
  extraction: 28, // oil + iron
  agriculture: 14,
  construction: 10,
  manufacturing: 10,
  logistics: 8,
  retail: 8,
  energy: 6,
  financial: 4,
  defense: 3,
  real_estate: 3,
  healthcare: 2,
  chemical_industries: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  technology: 0,
};

/**
 * Authored 1953 specs. Populations: UN / national series early-1950s.
 * GDP: relative Maddison-scale sizing anchored to Austria = 7_500.
 */
export const AFRICA_AMERICAS_1953_MACRO_SPECS: readonly MacroCountrySeedSpec[] = [
  {
    entityId: ETHIOPIA_ENTITY_ID,
    displayName: "Ethiopia",
    economicSystem: "market",
    // UN / national estimates early-1950s ≈ 18–19M (Empire incl. Eritrea federation).
    population: 18_500_000,
    // Large population, very low per-capita; coffee/hides exports.
    // Lifted above literal Maddison share so exposed commodity legs remain non-zero.
    annualGdpGameUnits: 4_200,
    fiscalCapacity: 0.12,
    stability: 0.6, // Haile Selassie consolidation; Eritrea federation 1952
    tradeExposure: 0.18,
    sectorWeights: ET_WEIGHTS,
    resources: {
      // Modest highland gold via rare_earth channel; coffee is agri not extractable.
      rare_earth: 4,
      timber: 6,
      iron: 2,
      coal: 0,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: SOUTH_AFRICA_ENTITY_ID,
    displayName: "South Africa",
    economicSystem: "market",
    // 1951 census ≈ 12.7M; early-1950s ≈ 13.2M.
    population: 13_200_000,
    // Industrialising settler economy; gold/coal dominant world supplier.
    annualGdpGameUnits: 9_500,
    fiscalCapacity: 0.24,
    stability: 0.62, // apartheid institutionalising (Group Areas etc.); regime-stable
    tradeExposure: 0.42, // sterling-area / commodity exports
    sectorWeights: ZA_WEIGHTS,
    resources: {
      // Gold + diamonds approximated via rare_earth; coal and iron literal.
      rare_earth: 28,
      coal: 22,
      iron: 12,
      timber: 4,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: CUBA_ENTITY_ID,
    displayName: "Cuba",
    economicSystem: "market",
    // 1953 census ≈ 5.8M.
    population: 5_800_000,
    // Sugar republic with high trade openness to the US; nickel secondary.
    annualGdpGameUnits: 4_500,
    fiscalCapacity: 0.18,
    stability: 0.45, // Batista dictatorship; revolutionary underground rising
    tradeExposure: 0.55, // sugar quota / US capital
    sectorWeights: CU_WEIGHTS,
    resources: {
      // Nickel via iron/rare_earth proxies.
      iron: 8,
      rare_earth: 6,
      timber: 3,
      oil: 1, // small domestic fields
      coal: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: GUATEMALA_ENTITY_ID,
    displayName: "Guatemala",
    economicSystem: "market",
    // Early-1950s ≈ 3.0M.
    population: 3_000_000,
    // Coffee/banana plantation economy; UFCO dependence.
    annualGdpGameUnits: 2_400,
    fiscalCapacity: 0.14,
    stability: 0.4, // Decree 900 land reform; CIA coup trajectory (1954)
    tradeExposure: 0.45,
    sectorWeights: GT_WEIGHTS,
    resources: {
      timber: 10,
      iron: 2,
      rare_earth: 1,
      oil: 0,
      coal: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: PANAMA_ENTITY_ID,
    displayName: "Panama",
    economicSystem: "market",
    // Early-1950s ≈ 0.86M (Canal Zone population largely US-administered separately).
    population: 860_000,
    // Canal transit rents punch above population; thin resource base.
    annualGdpGameUnits: 2_200,
    fiscalCapacity: 0.16,
    stability: 0.55, // Remón era; Canal Zone sovereignty tension
    tradeExposure: 0.6, // canal openness
    sectorWeights: PA_WEIGHTS,
    resources: {
      timber: 3,
      iron: 1,
      oil: 0,
      coal: 0,
      rare_earth: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: NICARAGUA_ENTITY_ID,
    displayName: "Nicaragua",
    economicSystem: "market",
    // Early-1950s ≈ 1.2M.
    population: 1_200_000,
    // Cattle/coffee/cotton under Somoza; US political alignment.
    annualGdpGameUnits: 2_100,
    fiscalCapacity: 0.13,
    stability: 0.55, // Anastasio Somoza García dictatorship (assassinated 1956)
    tradeExposure: 0.35,
    sectorWeights: NI_WEIGHTS,
    resources: {
      timber: 8,
      // Gold via rare_earth channel.
      rare_earth: 4,
      iron: 1,
      oil: 0,
      coal: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: CHILE_ENTITY_ID,
    displayName: "Chile",
    economicSystem: "market",
    // 1952 census ≈ 5.9M; early-1950s ≈ 6.2M.
    population: 6_200_000,
    // Copper-export economy; democratic Ibáñez return (1952).
    annualGdpGameUnits: 5_200,
    fiscalCapacity: 0.2,
    stability: 0.68,
    tradeExposure: 0.45, // copper to US/Europe
    sectorWeights: CL_WEIGHTS,
    resources: {
      // Copper + nitrates via iron/rare_earth proxies.
      iron: 18,
      rare_earth: 14,
      timber: 6,
      coal: 4,
      oil: 1,
      natural_gas: 0,
    },
  },
  {
    entityId: ARGENTINA_ENTITY_ID,
    displayName: "Argentina",
    economicSystem: "market",
    // Interpolated 1947 census ~15.9M → 1960 ~20M; mid-1950s ≈ 18M.
    population: 18_000_000,
    // Among the largest Southern Cone economies; Peronist ISI + Pampas exports.
    annualGdpGameUnits: 14_000,
    fiscalCapacity: 0.22,
    stability: 0.52, // late Perón inflation/political strain (overthrown 1955)
    tradeExposure: 0.35,
    sectorWeights: AR_WEIGHTS,
    resources: {
      oil: 10,
      iron: 6,
      timber: 5,
      coal: 2,
      rare_earth: 1,
      natural_gas: 3,
    },
  },
  {
    entityId: MEXICO_ENTITY_ID,
    displayName: "Mexico",
    economicSystem: "market",
    // 1950 census ≈ 25.8M; early-1950s growth → ≈ 28M.
    population: 28_000_000,
    // Largest economy in this roster; PEMEX oil + ISI manufacturing under PRI.
    annualGdpGameUnits: 16_500,
    fiscalCapacity: 0.22,
    stability: 0.72, // Alemán→Ruiz Cortines PRI continuity
    tradeExposure: 0.32,
    sectorWeights: MX_WEIGHTS,
    resources: {
      oil: 20,
      // Silver/polymetallics via rare_earth; iron literal.
      rare_earth: 10,
      iron: 8,
      timber: 6,
      coal: 3,
      natural_gas: 4,
    },
  },
  {
    entityId: VENEZUELA_ENTITY_ID,
    displayName: "Venezuela",
    economicSystem: "market",
    // 1950 census ≈ 5.0M; early-1950s ≈ 5.5M.
    population: 5_500_000,
    // High oil income relative to population; Cerro Bolívar iron opening.
    annualGdpGameUnits: 7_800,
    fiscalCapacity: 0.2,
    stability: 0.55, // Pérez Jiménez dictatorship (1948–58)
    tradeExposure: 0.5, // oil exports
    sectorWeights: VE_WEIGHTS,
    resources: {
      oil: 32,
      iron: 14, // Cerro Bolívar
      natural_gas: 8,
      timber: 4,
      coal: 1,
      rare_earth: 0,
    },
  },
];

export const AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] =
  AFRICA_AMERICAS_1953_MACRO_SPECS.map((spec) => spec.entityId);

const SPEC_BY_ID = new Map(AFRICA_AMERICAS_1953_MACRO_SPECS.map((spec) => [spec.entityId, spec]));

export function getAfricaAmericas1953MacroSpec(
  entityId: WorldEntityId
): MacroCountrySeedSpec | undefined {
  return SPEC_BY_ID.get(entityId);
}

export function getAfricaAmericas1953MacroCountry(
  entityId: WorldEntityId,
  now = new Date()
): MacroCountryState {
  const spec = SPEC_BY_ID.get(entityId);
  if (!spec) {
    throw new Error(
      `No authored 1953 macro seed for ${entityId}; refusing modern-preset fallback.`
    );
  }
  return buildMacroCountryFromSpec(spec, now, { markInitialTick: true });
}

export function listAfricaAmericas1953MacroCountries(now = new Date()): MacroCountryState[] {
  return AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS.map((entityId) =>
    getAfricaAmericas1953MacroCountry(entityId, now)
  );
}
