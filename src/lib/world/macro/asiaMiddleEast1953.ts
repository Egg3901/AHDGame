/**
 * Asian and Middle Eastern 1953 sphere-macro roster (#3720, #3723).
 *
 * GDP magnitudes use the same game units as Austria's oracle (AT = 7_500).
 * Populations: UN Demographic Yearbook / national censuses early-1950s.
 * GDP: Maddison-scale *relative* sizing vs Austria, lifted to a kernel floor
 * (~1_500–2_500 annual game units) so commodity legs survive 0.01-unit
 * rounding after tradeExposure — strong defaults, not rails.
 * Non-COMECON polities seed as market aggregates (no firms). KP and NVN are
 * planned command economies. Resource keys are EXTRACTABLE_RESOURCES only;
 * phosphates/tin/gems use rare_earth or iron proxies where noted.
 *
 * IN/PK/IR/IQ/EG/SA/SY/ID/KP/KR/NVN/SVN were added by the 1953 Tier-1 matrix
 * (#3723) as unconfigured proposed Tier-1 → sphere-macro; authored here so
 * seedMacroCountries never falls back to a modern preset.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { buildMacroCountryFromSpec, type MacroCountrySeedSpec } from "./seedBuilder";
import type { MacroCountryState } from "./types";

export const JORDAN_ENTITY_ID = "JO";
export const AFGHANISTAN_ENTITY_ID = "AF";
export const NORTH_YEMEN_ENTITY_ID = "YE";
export const BURMA_ENTITY_ID = "MM";
export const LAOS_ENTITY_ID = "LA";
export const CAMBODIA_ENTITY_ID = "KH";
export const THAILAND_ENTITY_ID = "TH";

/** Matrix-reclassified proposed Tier-1 entities without CountryConfig (#3723). */
export const INDIA_ENTITY_ID = "IN";
export const PAKISTAN_ENTITY_ID = "PK";
export const IRAN_ENTITY_ID = "IR";
export const IRAQ_ENTITY_ID = "IQ";
export const EGYPT_ENTITY_ID = "EG";
export const SAUDI_ARABIA_ENTITY_ID = "SA";
export const SYRIA_ENTITY_ID = "SY";
export const INDONESIA_ENTITY_ID = "ID";
export const NORTH_KOREA_ENTITY_ID = "KP";
export const SOUTH_KOREA_ENTITY_ID = "KR";
export const NORTH_VIETNAM_ENTITY_ID = "NVN";
export const SOUTH_VIETNAM_ENTITY_ID = "SVN";

const JO_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Hashemite kingdom: British-trained Arab Legion, refugee absorption, phosphates.
  agriculture: 28,
  defense: 14,
  logistics: 12, // transit corridor Amman–Aqaba / Haifa legacy routes
  construction: 10,
  retail: 8,
  extraction: 6, // phosphate (modelled via rare_earth endowment)
  financial: 5,
  energy: 4,
  manufacturing: 4,
  healthcare: 3,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const AF_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Zahir Shah monarchy: pastoral/agrarian, negligible industry, opium/karakul trade.
  agriculture: 45,
  logistics: 8,
  retail: 8,
  construction: 7,
  defense: 7,
  extraction: 5, // limited coal/iron
  manufacturing: 5,
  energy: 4,
  healthcare: 3,
  financial: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const YE_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Mutawakkilite Imamate: near-autarkic highland agriculture, almost no industry.
  agriculture: 55,
  retail: 10,
  defense: 8,
  construction: 6,
  logistics: 5,
  manufacturing: 4,
  extraction: 3,
  energy: 2,
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

const MM_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Union of Burma under U Nu: rice bowl, teak, Yenangyaung oil, tin/tungsten.
  agriculture: 38,
  extraction: 12, // teak counted via timber endowment; oil + tin here
  manufacturing: 10,
  logistics: 8,
  retail: 7,
  construction: 6,
  defense: 6, // Karen / communist insurgencies
  energy: 4,
  financial: 2,
  healthcare: 2,
  chemical_industries: 1,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  technology: 0,
};

const LA_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Kingdom of Laos: subsistence + timber/tin; First Indochina War periphery.
  agriculture: 48,
  extraction: 10, // timber + tin
  retail: 8,
  logistics: 7,
  construction: 6,
  defense: 6,
  manufacturing: 5,
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

const KH_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Kingdom of Cambodia (independence Nov 1953): rice, rubber, Tonle Sap fisheries.
  agriculture: 42,
  retail: 10,
  logistics: 8,
  construction: 7,
  manufacturing: 7,
  extraction: 6, // timber; rubber via agri
  defense: 5,
  energy: 3,
  healthcare: 3,
  financial: 2,
  real_estate: 2,
  media: 1,
  entertainment: 1,
  telecommunications: 1,
  chemical_industries: 1,
  automobiles: 1,
  technology: 0,
};

const TH_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Thailand under Phibun: rice/teak/tin exports; US military aid rising toward SEATO.
  agriculture: 32,
  manufacturing: 14,
  extraction: 10, // tin + teak
  logistics: 8,
  retail: 8,
  construction: 7,
  defense: 6,
  energy: 4,
  financial: 3,
  healthcare: 2,
  chemical_industries: 2,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 0,
  technology: 0,
};

const IN_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Nehru republic: First Plan (1951–56); textiles, steel plants starting, monsoon agri.
  agriculture: 42,
  manufacturing: 16,
  construction: 8,
  logistics: 6,
  retail: 6,
  extraction: 5, // coal / iron ore
  energy: 4,
  defense: 3,
  financial: 3,
  healthcare: 2,
  chemical_industries: 2,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  automobiles: 1,
  technology: 0,
};

const PK_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Early Pakistan: jute/cotton exports; refugee absorption; thin industry.
  agriculture: 45,
  manufacturing: 12,
  logistics: 8,
  retail: 7,
  construction: 7,
  defense: 6,
  extraction: 4,
  energy: 3,
  financial: 2,
  healthcare: 2,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const IR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Post-Mossadegh (Aug 1953 coup): oil nationalisation crisis; Shah restored.
  extraction: 22, // Abadan / southern oil
  agriculture: 28,
  manufacturing: 10,
  retail: 8,
  construction: 7,
  logistics: 6,
  defense: 5,
  energy: 4,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const IQ_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Hashemite Iraq: IPC oil; barley/dates; Baghdad Pact forming.
  extraction: 20, // Kirkuk oil
  agriculture: 32,
  manufacturing: 10,
  retail: 8,
  construction: 7,
  logistics: 6,
  defense: 5,
  energy: 3,
  financial: 2,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const EG_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Free Officers (1952): Nile agriculture; Suez Canal; nascent industry.
  agriculture: 35,
  manufacturing: 14,
  logistics: 12, // Suez / Alexandria
  retail: 8,
  construction: 7,
  defense: 6,
  extraction: 4, // modest oil; phosphates via rare_earth
  energy: 4,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const SA_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Aramco oil kingdom: still early production ramp; thin non-oil economy.
  extraction: 40, // Ghawar / Aramco
  agriculture: 18, // oasis / date
  construction: 10,
  logistics: 8,
  retail: 6,
  defense: 5,
  energy: 4,
  manufacturing: 3,
  financial: 2,
  healthcare: 1,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 0,
  chemical_industries: 0,
  automobiles: 0,
  technology: 0,
};

const SY_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Syrian Republic: cotton/wheat; coups; pipeline transit.
  agriculture: 38,
  manufacturing: 12,
  logistics: 10, // IPC pipeline / Levant trade
  retail: 8,
  construction: 7,
  defense: 6,
  extraction: 4, // modest oil; phosphates
  energy: 3,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const ID_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Sukarno republic: rubber/tin/oil; Java rice; Konfrontasi not yet.
  agriculture: 36,
  extraction: 14, // oil + tin
  manufacturing: 12,
  logistics: 8,
  retail: 7,
  construction: 6,
  defense: 5,
  energy: 3,
  financial: 2,
  healthcare: 2,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const KP_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // DPRK postwar reconstruction under Kim Il-sung; heavy industry priority.
  manufacturing: 28,
  defense: 16,
  extraction: 14, // coal / iron
  construction: 12,
  agriculture: 12,
  energy: 6,
  logistics: 4,
  chemical_industries: 3,
  healthcare: 2,
  retail: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 0,
  automobiles: 0,
  technology: 0,
};

const KR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // ROK after armistice (Jul 1953): devastated, aid-dependent, agrarian.
  agriculture: 40,
  construction: 12, // UN / US reconstruction
  manufacturing: 10,
  defense: 10,
  retail: 8,
  logistics: 6,
  extraction: 4,
  energy: 3,
  financial: 2,
  healthcare: 2,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

const NVN_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // Viet Minh north: land reform; war economy against France (pre-Geneva).
  agriculture: 40,
  defense: 18,
  manufacturing: 12,
  construction: 8,
  extraction: 6,
  logistics: 5,
  energy: 3,
  retail: 2,
  healthcare: 2,
  chemical_industries: 1,
  financial: 1,
  real_estate: 1,
  telecommunications: 1,
  media: 1,
  entertainment: 0,
  automobiles: 0,
  technology: 0,
};

const SVN_WEIGHTS: Partial<Record<CorporationType, number>> = {
  // State of Vietnam / Bao Dai: Mekong rice; French / US aid; weak industry.
  agriculture: 42,
  retail: 10,
  logistics: 8,
  construction: 8,
  manufacturing: 8,
  defense: 7,
  extraction: 4,
  energy: 3,
  financial: 3,
  healthcare: 2,
  real_estate: 2,
  telecommunications: 1,
  media: 1,
  entertainment: 1,
  chemical_industries: 1,
  automobiles: 0,
  technology: 0,
};

/**
 * Authored 1953 specs. Populations: UN / national series early-1950s.
 * GDP: relative Maddison-scale sizing anchored to Austria = 7_500.
 */
export const ASIA_ME_1953_MACRO_SPECS: readonly MacroCountrySeedSpec[] = [
  {
    entityId: JORDAN_ENTITY_ID,
    displayName: "Jordan",
    economicSystem: "market",
    // ~1.3–1.5M including West Bank population under Hashemite annexation.
    population: 1_400_000,
    // Small aid-dependent economy; phosphate exports + UK subsidy.
    // Lifted above literal Maddison share so exposed commodity legs remain non-zero.
    annualGdpGameUnits: 2_400,
    fiscalCapacity: 0.15,
    stability: 0.55, // young King Hussein; Abdullah assassinated 1951
    tradeExposure: 0.35, // sterling-area / British orientation
    sectorWeights: JO_WEIGHTS,
    resources: {
      // Phosphate rock approximated via rare_earth channel.
      rare_earth: 12,
      oil: 0,
      coal: 0,
      iron: 1,
      timber: 1,
      natural_gas: 0,
    },
  },
  {
    entityId: AFGHANISTAN_ENTITY_ID,
    displayName: "Afghanistan",
    economicSystem: "market",
    // UN early-1950s ≈ 8M.
    population: 8_000_000,
    // Pastoral/agrarian; per-capita output far below Austria.
    annualGdpGameUnits: 3_500,
    fiscalCapacity: 0.12,
    stability: 0.6, // Zahir Shah relative calm before later coups
    // Landlocked; limited convertible trade via Pakistan/Iran/USSR.
    tradeExposure: 0.15,
    sectorWeights: AF_WEIGHTS,
    resources: {
      coal: 4,
      iron: 3,
      timber: 2,
      oil: 0,
      natural_gas: 1, // northern gas not yet major
      rare_earth: 0,
    },
  },
  {
    entityId: NORTH_YEMEN_ENTITY_ID,
    displayName: "North Yemen",
    economicSystem: "market",
    // Mutawakkilite Kingdom ≈ 4–5M (South Arabia/Aden still a UK dependency).
    population: 4_500_000,
    // Among the poorest sovereigns; coffee/qat highland subsistence.
    annualGdpGameUnits: 2_200,
    fiscalCapacity: 0.08,
    stability: 0.45, // Imam Ahmad absolutism; tribal revolts
    // Near-autarky (Aden is foreign); kept ≥0.12 so kernel legs survive rounding.
    tradeExposure: 0.12,
    sectorWeights: YE_WEIGHTS,
    resources: {
      oil: 0, // North Yemen oil discoveries are later decades
      coal: 0,
      iron: 1,
      timber: 1,
      rare_earth: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: BURMA_ENTITY_ID,
    displayName: "Burma",
    economicSystem: "market",
    // 1953 census ≈ 19.1M.
    population: 19_100_000,
    // Major rice exporter; teak + Yenangyaung oil; civil war drags output.
    annualGdpGameUnits: 6_500,
    fiscalCapacity: 0.16,
    stability: 0.4, // Karen / communist / ethnic insurgencies ongoing
    tradeExposure: 0.25, // rice sterling trade; non-aligned drift
    sectorWeights: MM_WEIGHTS,
    resources: {
      timber: 22, // teak
      oil: 8, // Yenangyaung / central Burma fields
      // Tin/tungsten approximated via iron + rare_earth channels.
      iron: 6,
      rare_earth: 5,
      coal: 2,
      natural_gas: 0,
    },
  },
  {
    entityId: LAOS_ENTITY_ID,
    displayName: "Laos",
    economicSystem: "market",
    // Early-1950s ≈ 1.7–2.0M.
    population: 1_800_000,
    // Subsistence + timber/tin; French Associated State → fuller sovereignty mid-1950s.
    annualGdpGameUnits: 2_000,
    fiscalCapacity: 0.1,
    stability: 0.45, // Pathet Lao forming; Indochina war spillover
    tradeExposure: 0.12,
    sectorWeights: LA_WEIGHTS,
    resources: {
      timber: 14,
      // Tin via iron channel.
      iron: 5,
      rare_earth: 2,
      coal: 0,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: CAMBODIA_ENTITY_ID,
    displayName: "Cambodia",
    economicSystem: "market",
    // Independence year ≈ 4.5M.
    population: 4_500_000,
    // Rice/rubber agrarian kingdom under Sihanouk.
    annualGdpGameUnits: 2_800,
    fiscalCapacity: 0.14,
    stability: 0.55, // Sihanouk consolidating independence (Nov 1953)
    tradeExposure: 0.2, // French Union residual trade
    sectorWeights: KH_WEIGHTS,
    resources: {
      timber: 10,
      iron: 2,
      rare_earth: 1,
      coal: 0,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: THAILAND_ENTITY_ID,
    displayName: "Thailand",
    economicSystem: "market",
    // Interpolated 1950 census 17.4M → 1960 ~26M; mid-1950s ≈ 20M.
    population: 20_000_000,
    // Largest economy in this roster; rice/teak/tin; US aid rising.
    annualGdpGameUnits: 8_500,
    fiscalCapacity: 0.2,
    stability: 0.65, // Phibun military government; relatively stable vs neighbours
    tradeExposure: 0.35,
    sectorWeights: TH_WEIGHTS,
    resources: {
      timber: 16, // teak
      // Tin (world-significant) via rare_earth/iron proxies.
      rare_earth: 10,
      iron: 4,
      coal: 1,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: INDIA_ENTITY_ID,
    displayName: "India",
    economicSystem: "market",
    // 1951 census ≈ 361M (Republic; First Five-Year Plan underway).
    population: 361_000_000,
    // Maddison total near France; low GDP/capita — largest Asia/ME macro.
    annualGdpGameUnits: 58_000,
    fiscalCapacity: 0.18,
    stability: 0.7, // Nehru Congress dominance
    tradeExposure: 0.22, // sterling-area / Colombo Plan; import controls
    sectorWeights: IN_WEIGHTS,
    resources: {
      coal: 18,
      iron: 14,
      timber: 8,
      oil: 2,
      rare_earth: 3, // mica / monazite proxy
      natural_gas: 1,
    },
  },
  {
    entityId: PAKISTAN_ENTITY_ID,
    displayName: "Pakistan",
    economicSystem: "market",
    // Early-1950s ≈ 76M (East + West wings).
    population: 76_000_000,
    annualGdpGameUnits: 12_000,
    fiscalCapacity: 0.14,
    stability: 0.5, // refugee crisis; political turbulence
    tradeExposure: 0.28,
    sectorWeights: PK_WEIGHTS,
    resources: {
      natural_gas: 6, // Sui field (1952)
      coal: 4,
      iron: 2,
      timber: 2,
      oil: 1,
      rare_earth: 0,
    },
  },
  {
    entityId: IRAN_ENTITY_ID,
    displayName: "Iran",
    economicSystem: "market",
    // Early-1950s ≈ 17M.
    population: 17_000_000,
    // Oil crisis compresses 1953 output; still above kernel floor via Abadan endowment.
    annualGdpGameUnits: 11_000,
    fiscalCapacity: 0.16,
    stability: 0.4, // Mossadegh overthrow Aug 1953; Shah restored
    tradeExposure: 0.3,
    sectorWeights: IR_WEIGHTS,
    resources: {
      oil: 28, // Abadan / southern fields
      natural_gas: 8,
      coal: 2,
      iron: 2,
      timber: 1,
      rare_earth: 0,
    },
  },
  {
    entityId: IRAQ_ENTITY_ID,
    displayName: "Iraq",
    economicSystem: "market",
    // Early-1950s ≈ 5.5M.
    population: 5_500_000,
    annualGdpGameUnits: 5_500,
    fiscalCapacity: 0.15,
    stability: 0.55, // Hashemite monarchy
    tradeExposure: 0.35, // IPC oil exports
    sectorWeights: IQ_WEIGHTS,
    resources: {
      oil: 24, // Kirkuk
      natural_gas: 4,
      iron: 1,
      timber: 1,
      coal: 0,
      rare_earth: 0,
    },
  },
  {
    entityId: EGYPT_ENTITY_ID,
    displayName: "Egypt",
    economicSystem: "market",
    // Early-1950s ≈ 22M.
    population: 22_000_000,
    annualGdpGameUnits: 9_800,
    fiscalCapacity: 0.2,
    stability: 0.55, // Nasser ascending after Free Officers
    tradeExposure: 0.4, // Suez Canal + cotton exports
    sectorWeights: EG_WEIGHTS,
    resources: {
      // Phosphates / Nile minerals via rare_earth; modest oil.
      rare_earth: 8,
      oil: 4,
      iron: 2,
      timber: 1,
      coal: 0,
      natural_gas: 1,
    },
  },
  {
    entityId: SAUDI_ARABIA_ENTITY_ID,
    displayName: "Saudi Arabia",
    economicSystem: "market",
    // Early-1950s ≈ 4M (pre-census estimates).
    population: 4_000_000,
    // Oil rents already dominate; lifted above tiny non-oil Maddison share.
    annualGdpGameUnits: 7_200,
    fiscalCapacity: 0.22, // Aramco royalties
    stability: 0.7, // Ibn Saud succession settling under Saud
    tradeExposure: 0.45, // oil exports
    sectorWeights: SA_WEIGHTS,
    resources: {
      oil: 32, // Ghawar ramp
      natural_gas: 6,
      iron: 0,
      coal: 0,
      timber: 0,
      rare_earth: 0,
    },
  },
  {
    entityId: SYRIA_ENTITY_ID,
    displayName: "Syria",
    economicSystem: "market",
    // Early-1950s ≈ 3.6M.
    population: 3_600_000,
    annualGdpGameUnits: 3_800,
    fiscalCapacity: 0.14,
    stability: 0.42, // coup cycle
    tradeExposure: 0.32,
    sectorWeights: SY_WEIGHTS,
    resources: {
      oil: 3,
      rare_earth: 4, // phosphates
      iron: 1,
      timber: 1,
      coal: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: INDONESIA_ENTITY_ID,
    displayName: "Indonesia",
    economicSystem: "market",
    // Early-1950s ≈ 80M.
    population: 80_000_000,
    annualGdpGameUnits: 16_000,
    fiscalCapacity: 0.15,
    stability: 0.5, // Sukarno parliamentary turbulence
    tradeExposure: 0.3, // rubber/tin/oil exports
    sectorWeights: ID_WEIGHTS,
    resources: {
      oil: 14,
      // Tin via rare_earth/iron proxies; tropical timber.
      timber: 12,
      rare_earth: 8,
      iron: 3,
      coal: 4,
      natural_gas: 2,
    },
  },
  {
    entityId: NORTH_KOREA_ENTITY_ID,
    displayName: "North Korea",
    economicSystem: "planned",
    // Early-1950s ≈ 9M (armistice Jul 1953; heavy war damage).
    population: 9_000_000,
    // War-devastated; lifted to kernel floor for planned commodity legs.
    annualGdpGameUnits: 5_500,
    fiscalCapacity: 0.3, // extractive wartime state
    stability: 0.4, // reconstruction under Kim Il-sung
    tradeExposure: 0.15, // Soviet/Chinese aid orientation
    sectorWeights: KP_WEIGHTS,
    resources: {
      coal: 16,
      iron: 12,
      timber: 4,
      rare_earth: 2,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: SOUTH_KOREA_ENTITY_ID,
    displayName: "South Korea",
    economicSystem: "market",
    // Early-1950s ≈ 21M (armistice; Rhee government).
    population: 21_000_000,
    annualGdpGameUnits: 6_200,
    fiscalCapacity: 0.12, // aid-dependent
    stability: 0.45, // postwar devastation; Rhee authoritarianism
    tradeExposure: 0.35, // US aid / imports dominate
    sectorWeights: KR_WEIGHTS,
    resources: {
      coal: 4,
      iron: 2,
      timber: 2,
      rare_earth: 1,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: NORTH_VIETNAM_ENTITY_ID,
    displayName: "North Vietnam",
    economicSystem: "planned",
    // Viet Minh north ≈ 13M on eve of Geneva (1954).
    population: 13_000_000,
    annualGdpGameUnits: 4_200,
    fiscalCapacity: 0.22,
    stability: 0.4, // First Indochina War climax
    tradeExposure: 0.12, // Chinese/Soviet leakage; wartime autarky
    sectorWeights: NVN_WEIGHTS,
    resources: {
      coal: 8, // Hon Gai
      iron: 3,
      timber: 6,
      rare_earth: 1,
      oil: 0,
      natural_gas: 0,
    },
  },
  {
    entityId: SOUTH_VIETNAM_ENTITY_ID,
    displayName: "South Vietnam",
    economicSystem: "market",
    // State of Vietnam south ≈ 12M.
    population: 12_000_000,
    annualGdpGameUnits: 4_800,
    fiscalCapacity: 0.14,
    stability: 0.42, // Bao Dai weakness; sect armies
    tradeExposure: 0.3, // French Union / US aid
    sectorWeights: SVN_WEIGHTS,
    resources: {
      timber: 8,
      iron: 1,
      rare_earth: 1,
      coal: 0,
      oil: 0,
      natural_gas: 0,
    },
  },
];

export const ASIA_ME_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] = ASIA_ME_1953_MACRO_SPECS.map(
  (spec) => spec.entityId
);

export const PLANNED_ASIA_ME_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] =
  ASIA_ME_1953_MACRO_SPECS.filter((spec) => spec.economicSystem === "planned").map(
    (spec) => spec.entityId
  );

const SPEC_BY_ID = new Map(ASIA_ME_1953_MACRO_SPECS.map((spec) => [spec.entityId, spec]));

export function getAsiaMiddleEast1953MacroSpec(
  entityId: WorldEntityId
): MacroCountrySeedSpec | undefined {
  return SPEC_BY_ID.get(entityId);
}

export function getAsiaMiddleEast1953MacroCountry(
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

export function listAsiaMiddleEast1953MacroCountries(now = new Date()): MacroCountryState[] {
  return ASIA_ME_1953_MACRO_ENTITY_IDS.map((entityId) =>
    getAsiaMiddleEast1953MacroCountry(entityId, now)
  );
}
