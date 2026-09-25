/**
 * Does every registry a converted country appears in resolve at runtime, and
 * does it resolve to the FOLDER'S object rather than a second one holding equal
 * values?
 *
 *   npx tsx scripts/countries/verify-country-runtime.ts DE
 *   npx tsx scripts/countries/verify-country-runtime.ts --all
 *
 * ⚠ ONE HARNESS, NOT ONE PER COUNTRY. Japan, the United States and the United
 * Kingdom each had a 321-line copy of this, and copies drift: a check added to
 * the newest file is absent from the older two, and nothing says so. That is the
 * exact failure `jpCoverage.ts` was retired for -- a per-country artefact that
 * does not scale to twenty-four. The registry list and the folder accessors are
 * the same for every country, so they are written once here and the country id
 * is a parameter.
 *
 * ⚠ WHY A SCRIPT AND NOT A VITEST FILE. Vitest resolves modules through vite,
 * which is not the app's module-init order, so a circular import can pass there
 * and hand back `undefined` in the app. `countries.ts` imports a value from each
 * folder's `institutionsFacts.ts`, which imports the `CountryConfig` TYPE back
 * from `countries.ts`; type imports are erased so this should hold, but "should"
 * is not evidence and `COUNTRY_CONFIGS[cc]` is the most load-bearing object in
 * the game. If it silently became undefined, typecheck, lint and most unit tests
 * would still pass.
 *
 * ⚠ THE `===` BLOCK IS THE ONE THE REST CANNOT REPLACE. Everything in the first
 * list asks whether a registry RESOLVES. None of it asks whether it resolves to
 * the folder's object or to a copy with the same values. Deep equality passes
 * either way, which is exactly how a forwarder quietly becomes a copy: correct
 * on the day it is made, silently divergent after the first edit to one side.
 * Japan's chamber seat tables sat in that state through a completed phase.
 */
import { COUNTRY_CONFIGS, NATIONAL_ADDRESS_NAME } from "../../src/lib/constants/countries";
import { CABINET_IDENTITY } from "../../src/lib/constants/cabinetIdentity";
import { NATIONAL_IDENTITY } from "../../src/lib/constants/nationalIdentity";
import { NATIONAL_STATS_IDENTITY } from "../../src/lib/constants/nationalStatsIdentity";
import { TREASURY_TEXT } from "../../src/lib/constants/treasuryIdentity";
import { ECONOMY_TEXT } from "../../src/lib/constants/economyIdentity";
import { EXECUTIVE_TEXT, POLICY_TEXT } from "../../src/lib/constants/institutionIdentity";
import { EXECUTIVE_SEALS } from "../../src/lib/constants/executiveSeals";
import { EXECUTIVE_SURFACE } from "../../src/lib/constants/executiveSurface";
import { COUNTRY_HISTORICAL_NAMES, COUNTRY_MODERN_NAMES } from "../../src/lib/banking/npcBanks";
import { LEGISLATIVE_PROCESS } from "../../src/lib/legislature/process";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "../../src/lib/constants/cabinetEstates";
import { GROUPS } from "../../src/lib/constants/cabinetPositionGroups";
import { ORDERS_BY_COUNTRY } from "../../src/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "../../src/lib/constants/cabinetMechanics";
import { ENERGY_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetEnergy";
import { INFRA_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetInfra";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
} from "../../src/lib/constants/military";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "../../src/lib/constants/internationalOrganizations";
import { ORDERS_OF_BATTLE } from "../../src/lib/seeds/reference/ordersOfBattle";
import {
  COUNTRY_CURRENCY_MAP,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
} from "../../src/lib/constants/currencies";
import { COUNTRY_SECTOR_WEIGHTS } from "../../src/lib/seeds/reference/sectorSeedWeights";
import { REP_ECON } from "../../src/lib/era/legislationCostCatalog";
import { COST_SCALE_ANCHORS } from "../../src/lib/budget/costs";
import { NATIONAL_POLICY_STATE_IDS } from "../../src/lib/policy/nationalStateId";
import { LEGISLATION_COUNTRY_SCOPES } from "../../src/lib/policy/nationalPolicyRecords";
import { TREASURY_PS_RATE_BY_COUNTRY } from "../../src/lib/politicalStrength/strengthConstants";
import { PLAYER_PAYOUT_CAP_PER_TURN } from "../../src/lib/treasury/payoutCapValues";
import { DEFAULT_STRATEGIC_SECTORS } from "../../src/lib/seeds/reference/strategicSectors";
import { SOVEREIGN_CORP_LEGAL_STRUCTURE } from "../../src/lib/seeds/reference/budgets";
import {
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY,
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY,
} from "../../src/lib/turn/gdpGrowth";
import { COUNTRY_CONTINENT } from "../../src/lib/constants/countryContinents";
import { COUNTRY_TO_ISO_NUMERIC } from "../../src/lib/constants/countryIso";
import { COUNTRY_REGIONS, COUNTRY_UN_MEMBER_SINCE } from "../../src/lib/world/worldEntityManifest";
import { NPP_CAPITAL_STATES } from "../../src/lib/admin/spawnNppCorporation";
import { STATE_ADJACENCY } from "../../src/lib/constants/stateAdjacency";
import { CONSCRIPTION_SEED } from "../../src/lib/demographics/conscription";
import { COUNTRY_MAP_REGISTRY } from "../../src/lib/commodity-map/commodityMapRegistry";
import { COUNTRY_ANCHOR } from "../../src/lib/maps/countryAnchors";
import { MEDIAN_INCOME_THRESHOLDS } from "../../src/lib/utils/metricScoring";
import { POPULATION_MULTIPLIERS } from "../../src/lib/seeds/reference/era1991PopulationMultipliers";
import { CENSUS_BUNDLES } from "../../src/lib/seeds/regionCensusData";
import { SPAWN_ELECTIONS_REGISTRY } from "../../src/lib/turn/perpetualElections/registry";
import { COUNTRY_ELECTION_PHASES } from "../../src/lib/turn/countryPhases";
import { COUNTRY_SECTOR_WEIGHTS_1979 } from "../../src/lib/seeds/reference/sectorSeedWeights1979";
import { COUNTRY_SECTOR_WEIGHTS_1991 } from "../../src/lib/seeds/reference/sectorSeedWeights1991";
import {
  MONETARY_BASELINES_1953,
  MONETARY_BASELINES_1971,
  MONETARY_BASELINES_1979,
  MONETARY_BASELINES_1991,
} from "../../src/lib/constants/monetaryEra";
import { SURFACES } from "../../src/lib/constants/parliamentaryExecutiveSurface";
import { REGION_CENSUS_LABELS } from "../../src/lib/constants/regionCensusLabels";
import { STATE_DISPLAY_NAMES } from "../../src/lib/commodity-map/commodityRegionMappings";
import { METRIC_PRESET_BUNDLES } from "../../src/lib/seeds/metricPresets";
import { POPULATION_ANCHOR_BUNDLES } from "../../src/lib/seeds/populationAnchors";
import { FULL_ERA_REGION_BUNDLES } from "../../src/lib/admin/seedDiagnostic/regionBundles";
import { REGION_NAME_MAPS } from "../../src/lib/admin/seed/seedSeats";
import { M2_TO_GDP_1953 } from "../../src/lib/seeds/reference/moneySupply";
import { GDP_DENOMINATION_1953 } from "../../src/lib/seeds/reference/gdpDenomination";
import { RAW_BUNDLES } from "../../src/lib/states/conditions/seedMetricsLoader";
import { NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY } from "../../src/lib/turn/partyOrg/pacingConstants";
import { COUNTRY_COMMAND_FLAVOR } from "../../src/lib/military/theaters";
import { COUNTRY_BUCKET_LABELS } from "../../src/lib/demographics/bucketLabelsByCountry";
import { ERA_COUNTRY_CONFIG_OVERRIDES } from "../../src/lib/constants/countries";
import { CORE5_NORMALS } from "../../src/lib/era/metricCatalog";
import { COUNTRY_MODIFIER_PATCHES } from "../../src/lib/states/conditions/countryPatches";
import { DOMAIN_BUCKET_AFFINITIES } from "../../src/lib/bucketAffinities";
import { MAJOR_DEFAULT_PARTIES } from "../../src/lib/seeds/defaultPartyTiers";
import { COUNTRY_SECTOR_WEIGHTS_1953 } from "../../src/lib/seeds/reference/sectorSeedWeights1953";
import { REGIONAL_BILL_ASSENT_OFFICE_KEY } from "../../src/lib/constants/countries";
import { INCOME_ANCHORS } from "../../src/lib/era/metricCatalog";
import { TARGETS } from "../../src/lib/seeds/calibration/targets";
import { COUNTRY_ERA1991_PATCHES } from "../../src/lib/states/conditions/countryEra1991Patches";
import { HAZARD_GROUPS } from "../../src/lib/crises/regionHazards";
import { REGION_DEMOGRAPHIC_CATEGORY_IDS } from "../../src/app/country/[code]/region/[id]/regionData";
import { readFileSync } from "node:fs";
import { CONVERTED } from "../../src/lib/countries/singleCountryData";
import { escapeRegExp } from "./regexEscape";

type Dict = Record<string, unknown>;
const d = (o: unknown) => o as Dict;

/** Every registry that carries a per-country key, by the name a reader greps for. */
export const REGISTRIES: Record<string, Dict> = {
  COUNTRY_CONFIGS: d(COUNTRY_CONFIGS),
  NATIONAL_ADDRESS_NAME: d(NATIONAL_ADDRESS_NAME),
  CABINET_IDENTITY: d(CABINET_IDENTITY),
  NATIONAL_IDENTITY: d(NATIONAL_IDENTITY),
  NATIONAL_STATS_IDENTITY: d(NATIONAL_STATS_IDENTITY),
  TREASURY_TEXT: d(TREASURY_TEXT),
  ECONOMY_TEXT: d(ECONOMY_TEXT),
  EXECUTIVE_TEXT: d(EXECUTIVE_TEXT),
  POLICY_TEXT: d(POLICY_TEXT),
  EXECUTIVE_SEALS: d(EXECUTIVE_SEALS),
  EXECUTIVE_SURFACE: d(EXECUTIVE_SURFACE),
  COUNTRY_HISTORICAL_NAMES: d(COUNTRY_HISTORICAL_NAMES),
  COUNTRY_MODERN_NAMES: d(COUNTRY_MODERN_NAMES),
  LEGISLATIVE_PROCESS: d(LEGISLATIVE_PROCESS),
  ESTATE_PORTFOLIO_BY_COUNTRY: d(ESTATE_PORTFOLIO_BY_COUNTRY),
  GROUPS: d(GROUPS),
  ORDERS_BY_COUNTRY: d(ORDERS_BY_COUNTRY),
  MECHANICS_BY_COUNTRY: d(MECHANICS_BY_COUNTRY),
  ENERGY_POSITION_BY_COUNTRY: d(ENERGY_POSITION_BY_COUNTRY),
  INFRA_POSITION_BY_COUNTRY: d(INFRA_POSITION_BY_COUNTRY),
  DEFENSE_POSITION_BY_COUNTRY: d(DEFENSE_POSITION_BY_COUNTRY),
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY: d(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY),
  TRADE_MINISTER_POSITION_BY_COUNTRY: d(TRADE_MINISTER_POSITION_BY_COUNTRY),
  MILITARY_BRANCHES_BY_COUNTRY: d(MILITARY_BRANCHES_BY_COUNTRY),
  MILITARY_COUNTRY_SCALE: d(MILITARY_COUNTRY_SCALE),
  ORDERS_OF_BATTLE: d(ORDERS_OF_BATTLE),
  COUNTRY_CURRENCY_MAP: d(COUNTRY_CURRENCY_MAP),
  ECONOMIC_BASELINES: d(ECONOMIC_BASELINES),
  MONETARY_BASELINES: d(MONETARY_BASELINES),
  COUNTRY_SECTOR_WEIGHTS: d(COUNTRY_SECTOR_WEIGHTS),
  REP_ECON: d(REP_ECON),
  COST_SCALE_ANCHORS: d(COST_SCALE_ANCHORS),
  NATIONAL_POLICY_STATE_IDS: d(NATIONAL_POLICY_STATE_IDS),
  LEGISLATION_COUNTRY_SCOPES: d(LEGISLATION_COUNTRY_SCOPES),
  TREASURY_PS_RATE_BY_COUNTRY: d(TREASURY_PS_RATE_BY_COUNTRY),
  PLAYER_PAYOUT_CAP_PER_TURN: d(PLAYER_PAYOUT_CAP_PER_TURN),
  DEFAULT_STRATEGIC_SECTORS: d(DEFAULT_STRATEGIC_SECTORS),
  SOVEREIGN_CORP_LEGAL_STRUCTURE: d(SOVEREIGN_CORP_LEGAL_STRUCTURE),
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: d(NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY),
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: d(NEUTRAL_STATE_SALES_TAX_BY_COUNTRY),
  COUNTRY_CONTINENT: d(COUNTRY_CONTINENT),
  COUNTRY_TO_ISO_NUMERIC: d(COUNTRY_TO_ISO_NUMERIC),
  COUNTRY_REGIONS: d(COUNTRY_REGIONS),
  COUNTRY_UN_MEMBER_SINCE: d(COUNTRY_UN_MEMBER_SINCE),
  NPP_CAPITAL_STATES: d(NPP_CAPITAL_STATES),
  STATE_ADJACENCY: d(STATE_ADJACENCY),
  CONSCRIPTION_SEED: d(CONSCRIPTION_SEED),
  COUNTRY_MAP_REGISTRY: d(COUNTRY_MAP_REGISTRY),
  COUNTRY_ANCHOR: d(COUNTRY_ANCHOR),
  MEDIAN_INCOME_THRESHOLDS: d(MEDIAN_INCOME_THRESHOLDS),
  POPULATION_MULTIPLIERS: d(POPULATION_MULTIPLIERS),
  CENSUS_BUNDLES: d(CENSUS_BUNDLES),
  SPAWN_ELECTIONS_REGISTRY: d(SPAWN_ELECTIONS_REGISTRY),
  /*
   * ⚠️ ADDED AFTER AN AUDIT FOUND 495 UNCHECKED COUNTRY-ENTRIES. The harness
   * covered 53 of the 93 registries the snapshot captures, and most of the
   * uncovered ones still held per-country values -- usually a WRAPPER object
   * around the very objects the folder holds. Nothing had diverged yet, which
   * is exactly why it was worth closing: a duplicate is harmless until the day
   * one side is edited.
   */
  COUNTRY_SECTOR_WEIGHTS_1979: d(COUNTRY_SECTOR_WEIGHTS_1979),
  COUNTRY_SECTOR_WEIGHTS_1991: d(COUNTRY_SECTOR_WEIGHTS_1991),
  MONETARY_BASELINES_1953: d(MONETARY_BASELINES_1953),
  MONETARY_BASELINES_1971: d(MONETARY_BASELINES_1971),
  MONETARY_BASELINES_1979: d(MONETARY_BASELINES_1979),
  MONETARY_BASELINES_1991: d(MONETARY_BASELINES_1991),
  M2_TO_GDP_1953: d(M2_TO_GDP_1953),
  GDP_DENOMINATION_1953: d(GDP_DENOMINATION_1953),
  RAW_BUNDLES: d(RAW_BUNDLES),
  NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY: d(NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY),
  COUNTRY_COMMAND_FLAVOR: d(COUNTRY_COMMAND_FLAVOR),
  COUNTRY_BUCKET_LABELS: d(COUNTRY_BUCKET_LABELS),
  COUNTRY_MODIFIER_PATCHES: d(COUNTRY_MODIFIER_PATCHES),
  DOMAIN_BUCKET_AFFINITIES: d(DOMAIN_BUCKET_AFFINITIES),
  MAJOR_DEFAULT_PARTIES: d(MAJOR_DEFAULT_PARTIES),
  SURFACES: d(SURFACES),
  REGION_CENSUS_LABELS: d(REGION_CENSUS_LABELS),
  STATE_DISPLAY_NAMES: d(STATE_DISPLAY_NAMES),
  METRIC_PRESET_BUNDLES: d(METRIC_PRESET_BUNDLES),
  POPULATION_ANCHOR_BUNDLES: d(POPULATION_ANCHOR_BUNDLES),
  FULL_ERA_REGION_BUNDLES: d(FULL_ERA_REGION_BUNDLES),
  REGION_NAME_MAPS: d(REGION_NAME_MAPS),
  COUNTRY_SECTOR_WEIGHTS_1953: d(COUNTRY_SECTOR_WEIGHTS_1953),
  REGIONAL_BILL_ASSENT_OFFICE_KEY: d(REGIONAL_BILL_ASSENT_OFFICE_KEY),
  INCOME_ANCHORS: d(INCOME_ANCHORS),
  TARGETS: d(TARGETS),
  COUNTRY_ERA1991_PATCHES: d(COUNTRY_ERA1991_PATCHES),
  HAZARD_GROUPS: d(HAZARD_GROUPS),
  REGION_DEMOGRAPHIC_CATEGORY_IDS: d(REGION_DEMOGRAPHIC_CATEGORY_IDS),
};

/**
 * A registry a country is legitimately absent from, and why.
 *
 * ⚠ AN EXEMPTION IS A CLAIM ABOUT THE DATA, NOT A WAY TO QUIET THE HARNESS. Each
 * one says a country genuinely has no entry upstream -- the FRG was not a UN
 * member in the 1953 world, and Germany has no payout cap configured -- so
 * demanding one would make the harness insist on a value the game never had.
 * Anything not listed here must resolve, and an exemption that stops being true
 * FAILS: the entry is checked in both directions, so a registry that starts
 * carrying the country, or a folder that starts supplying the value, is
 * reported rather than silently tolerated.
 */
/**
 * A shared absence profile, for countries that are thin in exactly the same way.
 *
 * ⚠ EIGHT COUNTRIES, ONE PROFILE, BECAUSE THE PROFILE IS THE FACT. France,
 * Italy, Spain, Sweden, Turkey, Greece, Austria and Finland are absent from the
 * SAME twenty registries, character for character -- they are the economy tier,
 * and they share `ECON_COUNTRY_CABINET_POSITIONS` for the same reason. Writing
 * eight near-identical blocks would bury that in repetition and let one drift
 * from the others unnoticed.
 *
 * Each entry is still checked per country and in both directions: a country that
 * gains a row, or a folder that starts supplying a value, fails exactly as it
 * would from a hand-written block.
 */
const ECONOMY_TIER_ABSENCES: Record<string, string> = {
  NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
  CABINET_IDENTITY: "no row; getCabinetIdentity falls back to its documented shell",
  NATIONAL_STATS_IDENTITY: "no row; the reader falls back to DEFAULT_STATS_IDENTITY",
  ECONOMY_TEXT: "no row; the reader falls back to DEFAULT_ECONOMY_TEXT",
  LEGISLATIVE_PROCESS: "no row; readers fall through to DEFAULT_PROCESS",
  ESTATE_PORTFOLIO_BY_COUNTRY: "no row; seedCabinetEstates skips the country",
  ORDERS_BY_COUNTRY: "no cabinet-orders file exists; getMinisterialOrders returns []",
  GROUPS: 'no row; getCabinetGroup falls back to "Centre" per position',
  ENERGY_POSITION_BY_COUNTRY: "no energy seat is designated",
  INFRA_POSITION_BY_COUNTRY: "no infrastructure seat is designated",
  ECONOMIC_BASELINES: "forex-active with no full baseline, as rateCalculation.ts names it",
  REP_ECON: "no representative economy; incomeToGdp returns its 0.8 default",
  COST_SCALE_ANCHORS: "no anchor; costScale returns 1",
  DEFAULT_STRATEGIC_SECTORS: "no strategic sectors are configured",
  PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured",
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "no federal sales tax row",
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: "no state sales tax row",
  CONSCRIPTION_SEED: "no row; the reader falls back to DEFAULT_POLICY",
  MEDIAN_INCOME_THRESHOLDS: "no median-income thresholds are configured",
  POPULATION_MULTIPLIERS: "no 1991 cohort row; that era passes through at 1.0",
  SPAWN_ELECTIONS_REGISTRY: "spawns through COUNTRY_ELECTION_PHASES, not this registry",
};

/** The three economy-tier countries that also author no census bundles. */
const NO_CENSUS = {
  CENSUS_BUNDLES: "no census bundle is authored for any era",
};

/**
 * The Warsaw Pact tier: the economy tier's profile, plus no NPC bank names.
 *
 * ⚠ DERIVED, NOT COPIED. Poland, Hungary, Romania, Yugoslavia, Bulgaria and
 * Czechoslovakia are absent from every registry the economy tier is, and from
 * the two NPC-bank-name registries as well. Spelling the shared part out twice
 * would let the two lists drift; deriving it means a change to the economy
 * tier's profile is a change to this one, which is what the data says.
 */
const EASTERN_BLOC_ABSENCES: Record<string, string> = {
  ...ECONOMY_TIER_ABSENCES,
  COUNTRY_HISTORICAL_NAMES: "no NPC bank names are seeded",
  COUNTRY_MODERN_NAMES: "no NPC bank names are seeded",
};

const EASTERN_BLOC = ["PL", "HU", "RO", "YU", "BG", "CS"];

/**
 * The Soviet union republics, and the Baltic bloc that also predates UN entry.
 *
 * ⚠ BELARUS AND UKRAINE ARE THE EASTERN BLOC PROFILE EXACTLY. The Baltic
 * States add one row: no `COUNTRY_UN_MEMBER_SINCE`, which is correct -- the
 * three republics were not separate UN members in this world.
 */
const SOVIET_REPUBLICS = ["BLR", "UKR"];
const BALTIC = ["BAL"];

/**
 * Scotland and Wales, which are devolved nations rather than sovereign states.
 *
 * ⚠ THEIR PROFILE IS DIFFERENT BECAUSE THEIR STATUS IS. On top of the bloc's
 * absences they have no UN membership, no executive seal, no order of battle and
 * no sovereign-corporation legal structure -- four registries whose subject is
 * sovereignty, and neither is sovereign. They also share the United Kingdom's
 * ISO code, 826, which is why neither folder owns one.
 */
const DEVOLVED_NATIONS = ["SCO", "WAL"];
const DEVOLVED_ABSENCES: Record<string, string> = {
  ...EASTERN_BLOC_ABSENCES,
  /*
   * ⚠️ SCOTLAND AND WALES DO HAVE CABINET ORDERS, unlike the rest of the tier:
   * `scoCabinet.ts` and `walCabinet.ts` exist and `ORDERS_BY_COUNTRY` carries
   * both. The inherited entry is deleted rather than left to rot, and the
   * harness fails on a stale exemption, which is how this was noticed.
   */
  COUNTRY_UN_MEMBER_SINCE: "a devolved nation, not a UN member in its own right",
  EXECUTIVE_SEALS: "no seal; getSeal returns null and the UI omits it",
  ORDERS_OF_BATTLE: "no armed forces of its own; getOrderOfBattle returns null",
  SOVEREIGN_CORP_LEGAL_STRUCTURE: "not sovereign, so there is no sovereign-corp structure",
};
delete DEVOLVED_ABSENCES.ORDERS_BY_COUNTRY;

const ECONOMY_TIER = ["FR", "IT", "ES", "SE", "TR"];
const ECONOMY_TIER_NO_CENSUS = ["GR", "AT", "FI"];

const ABSENT_UPSTREAM: Record<string, Record<string, string>> = {
  DE: {
    COUNTRY_UN_MEMBER_SINCE: "the FRG was admitted in 1973; the 1953 world has no entry",
    PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured for Germany",
  },
  /*
   * ⚠ SIXTEEN, AND NONE OF THEM A MISTAKE. Russia has a `COUNTRY_CONFIGS`
   * row, a cabinet, fourteen regions and four election phases, and no row in any
   * of these. Most of the registries below hold six to eight keys in total --
   * they were only ever about the first cohort of countries, which is why eight
   * fields on the contract had to become optional for Russia to be describable
   * at all. Each line is checked in BOTH directions: if the registry starts
   * carrying Russia, or the folder starts supplying the value, this fails.
   */
  RU: {
    NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
    NATIONAL_STATS_IDENTITY: "no row; the reader falls back to DEFAULT_STATS_IDENTITY",
    ECONOMY_TEXT: "no row; the reader falls back to DEFAULT_ECONOMY_TEXT",
    COUNTRY_HISTORICAL_NAMES: "no NPC bank names are seeded for Russia",
    COUNTRY_MODERN_NAMES: "no NPC bank names are seeded for Russia",
    LEGISLATIVE_PROCESS: "no row; readers fall through to DEFAULT_PROCESS",
    ECONOMIC_BASELINES: "forex-active with no full baseline, as rateCalculation.ts names it",
    REP_ECON: "no representative economy; incomeToGdp returns its 0.8 default",
    COST_SCALE_ANCHORS: "no anchor; costScale returns 1",
    DEFAULT_STRATEGIC_SECTORS: "no strategic sectors are configured for Russia",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "a command economy with no federal sales tax row",
    NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: "no state sales tax row",
    CONSCRIPTION_SEED: "no row; the reader falls back to DEFAULT_POLICY",
    MEDIAN_INCOME_THRESHOLDS: "no median-income thresholds are configured",
    POPULATION_MULTIPLIERS: "no 1991 cohort row; that era passes through at 1.0",
    SPAWN_ELECTIONS_REGISTRY: "Russia spawns through COUNTRY_ELECTION_PHASES, not this registry",
  },
  DD: {
    NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
    NATIONAL_STATS_IDENTITY: "no row; the reader falls back to DEFAULT_STATS_IDENTITY",
    ECONOMY_TEXT: "no row; the reader falls back to DEFAULT_ECONOMY_TEXT",
    COUNTRY_HISTORICAL_NAMES: "no NPC bank names are seeded for East Germany",
    COUNTRY_MODERN_NAMES: "no NPC bank names are seeded for East Germany",
    LEGISLATIVE_PROCESS: "no row; readers fall through to DEFAULT_PROCESS",
    GROUPS: 'no row; getCabinetGroup falls back to "Centre" per position',
    ECONOMIC_BASELINES: "no full economic baseline is configured",
    REP_ECON: "no representative economy; incomeToGdp returns its 0.8 default",
    COST_SCALE_ANCHORS: "no anchor; costScale returns 1",
    DEFAULT_STRATEGIC_SECTORS: "no strategic sectors are configured",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "a command economy with no federal sales tax row",
    NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: "no state sales tax row",
    COUNTRY_UN_MEMBER_SINCE: "the GDR was admitted in 1973; the 1953 world has no entry",
    CONSCRIPTION_SEED: "no row; the reader falls back to DEFAULT_POLICY",
    MEDIAN_INCOME_THRESHOLDS: "no median-income thresholds are configured",
    POPULATION_MULTIPLIERS: "no 1991 cohort row; that era passes through at 1.0",
    SPAWN_ELECTIONS_REGISTRY: "East Germany spawns through COUNTRY_ELECTION_PHASES",
  },
  NG: {
    NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
    NATIONAL_STATS_IDENTITY: "no row; the reader falls back to DEFAULT_STATS_IDENTITY",
    LEGISLATIVE_PROCESS: "no row; readers fall through to DEFAULT_PROCESS",
    ESTATE_PORTFOLIO_BY_COUNTRY: "no row; seedCabinetEstates skips the country",
    ORDERS_BY_COUNTRY: "no ngCabinetOrders.ts exists; getMinisterialOrders returns []",
    ENERGY_POSITION_BY_COUNTRY: "no energy seat is designated for Nigeria",
    INFRA_POSITION_BY_COUNTRY: "no infrastructure seat is designated for Nigeria",
    PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured for Nigeria",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "no federal sales tax row",
    NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: "no state sales tax row",
    POPULATION_MULTIPLIERS: "no 1991 cohort row; that era passes through at 1.0",
  },
  BR: {
    NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
    CABINET_IDENTITY: "no row; getCabinetIdentity falls back to its documented shell",
    NATIONAL_STATS_IDENTITY: "no row; the reader falls back to DEFAULT_STATS_IDENTITY",
    LEGISLATIVE_PROCESS: "no row; readers fall through to DEFAULT_PROCESS",
    ESTATE_PORTFOLIO_BY_COUNTRY: "no row; seedCabinetEstates skips the country",
    ORDERS_BY_COUNTRY: "no brCabinetOrders.ts exists; getMinisterialOrders returns []",
    GROUPS: 'no row; getCabinetGroup falls back to "Centre" per position',
    ENERGY_POSITION_BY_COUNTRY: "no energy seat is designated for Brazil",
    INFRA_POSITION_BY_COUNTRY: "no infrastructure seat is designated for Brazil",
    REP_ECON: "no representative economy; incomeToGdp returns its 0.8 default",
    PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured for Brazil",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "no federal sales tax row",
  },
  IE: {
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "no federal sales tax row for Ireland",
    PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured for Ireland",
  },
  CN: {
    NATIONAL_ADDRESS_NAME: 'no row; the reader falls back to "Address to the Nation"',
    COUNTRY_HISTORICAL_NAMES: "no NPC bank names are seeded for China",
    COUNTRY_MODERN_NAMES: "no NPC bank names are seeded for China",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "a command economy with no federal sales tax row",
    PLAYER_PAYOUT_CAP_PER_TURN: "no payout cap is configured for China",
  },
};

/**
 * Absences recorded REGISTRY-first, because these are facts about the registry.
 *
 * ⚠️ AN ERA TABLE IS NOT A COUNTRY TABLE. `MONETARY_BASELINES_1979` holds
 * the countries whose 1979 world differs from their base; a country missing from
 * it inherits, which is the point of the table. Listing these per country, in
 * twenty-nine blocks, would bury that -- the shape of the fact is "this era has
 * these countries", not "this country lacks these eras".
 *
 * Each list was computed from the live registry, not guessed, and each entry is
 * still checked in BOTH directions per country.
 */
const ABSENT_BY_REGISTRY: Array<[string, string, readonly string[]]> = [
  [
    "COUNTRY_SECTOR_WEIGHTS_1979",
    "no 1979 sector-weight override; the country inherits its base weights",
    ["RU", "GR", "AT", "FI", "SCO", "WAL", "BLR"],
  ],
  [
    "MONETARY_BASELINES_1953",
    "no 1953 monetary override; the country inherits its base baseline",
    ["US", "UK", "CN", "IE", "SCO", "WAL"],
  ],
  [
    "MONETARY_BASELINES_1971",
    "no 1971 monetary override; the country inherits its base baseline",
    ["AT", "FI", "RO", "YU", "BG", "CS", "SCO", "WAL", "BLR", "UKR", "BAL"],
  ],
  [
    "MONETARY_BASELINES_1979",
    "no 1979 monetary override; the country inherits its base baseline",
    [
      "CN",
      "DD",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "MONETARY_BASELINES_1991",
    "no 1991 monetary override; the country inherits its base baseline",
    ["DD", "GR", "AT", "FI", "PL", "HU", "RO", "YU", "BG", "CS", "SCO", "WAL", "BLR", "UKR", "BAL"],
  ],
  [
    "M2_TO_GDP_1953",
    "no 1953 money-supply ratio is authored",
    ["GR", "AT", "FI", "PL", "HU", "RO", "YU", "BG", "CS", "SCO", "WAL", "BLR", "UKR", "BAL"],
  ],
  [
    "SURFACES",
    "no parliamentary executive surface: presidential, one-party or not sovereign",
    [
      "US",
      "CN",
      "RU",
      "DD",
      "NG",
      "BR",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "REGION_CENSUS_LABELS",
    "no census label set; consumers fall back to the generic labels",
    [
      "US",
      "RU",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "STATE_DISPLAY_NAMES",
    "no display-name map; the map falls back to compactRegionCode",
    ["US", "RU", "DD", "NG", "SCO", "WAL", "UKR"],
  ],
  [
    "METRIC_PRESET_BUNDLES",
    "no metric presets are authored for any era",
    ["DD", "PL", "HU", "RO", "YU", "BG", "CS", "SCO", "WAL", "BLR", "UKR", "BAL"],
  ],
  [
    "POPULATION_ANCHOR_BUNDLES",
    "no population anchors are authored for any era",
    [
      "RU",
      "DD",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "FULL_ERA_REGION_BUNDLES",
    "no row in the seed-diagnostic registry; the seed runner is the authority",
    [
      "US",
      "DD",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      // RU/PL/HU/RO/YU/BG/CS resolve: the branch added their 1991 region
      // bundles to the seed-diagnostic registry from the country folders.
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "MAJOR_DEFAULT_PARTIES",
    "no major-party list; every default party seeds Minor and partyTierTurn recomputes from live Org",
    [
      "RU",
      "DD",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "DOMAIN_BUCKET_AFFINITIES",
    "no authored affinity table; bucketAffinitiesFor falls back to the US block by name",
    [
      "RU",
      "DD",
      "NG",
      "BR",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "COUNTRY_MODIFIER_PATCHES",
    "no per-modifier override; the global and era defs apply unpatched",
    [
      "US",
      "RU",
      "DD",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "COUNTRY_BUCKET_LABELS",
    "the American terms are the global default (BUCKET_LABELS in bucketLabels.ts); a row here would copy the fallback",
    ["US"],
  ],
  [
    "RAW_BUNDLES",
    "no static state-metrics bundle; SCO/WAL fan out from the UK aggregate at secession, UKR regions are a deferred build",
    ["SCO", "WAL", "UKR"],
  ],
  [
    "NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY",
    "no country override; the reader falls back to NON_PARTY_BUCKET_INDEPENDENT_BIAS",
    [
      "CN",
      "IE",
      "RU",
      "DD",
      "NG",
      "BR",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "GDP_DENOMINATION_1953",
    "not a 1953 starting country; later presets are uniformly local-currency",
    ["SCO", "WAL"],
  ],
  [
    "COUNTRY_SECTOR_WEIGHTS_1953",
    "no 1953 sector-weight override; the country inherits its base weights",
    ["RU", "SCO", "WAL", "BLR"],
  ],
  [
    "REGIONAL_BILL_ASSENT_OFFICE_KEY",
    "regional bills need no assent office in this country",
    [
      "CN",
      "NG",
      "BR",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "INCOME_ANCHORS",
    "no authored income anchors; the metric catalog falls back",
    ["PL", "HU", "RO", "YU", "BG", "CS", "SCO", "WAL", "BLR", "UKR", "BAL"],
  ],
  [
    "TARGETS",
    "no calibration targets are authored",
    [
      "CN",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "COUNTRY_ERA1991_PATCHES",
    "no 1991 condition patches are authored",
    [
      "RU",
      "DD",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "HAZARD_GROUPS",
    "no regional hazard groups are authored",
    [
      "RU",
      "DD",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "REGION_DEMOGRAPHIC_CATEGORY_IDS",
    "no country-specific demographic category ids; the shared set applies",
    [
      "US",
      "RU",
      "NG",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
  [
    "REGION_NAME_MAPS",
    "no seat-seeder region-name map is authored",
    [
      "US",
      "RU",
      "DD",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "PL",
      "HU",
      "RO",
      "YU",
      "BG",
      "CS",
      "SCO",
      "WAL",
      "BLR",
      "UKR",
      "BAL",
    ],
  ],
];

for (const cc of ECONOMY_TIER) ABSENT_UPSTREAM[cc] = { ...ECONOMY_TIER_ABSENCES };
for (const cc of EASTERN_BLOC) ABSENT_UPSTREAM[cc] = { ...EASTERN_BLOC_ABSENCES };
for (const cc of SOVIET_REPUBLICS) ABSENT_UPSTREAM[cc] = { ...EASTERN_BLOC_ABSENCES };
for (const cc of BALTIC) {
  ABSENT_UPSTREAM[cc] = {
    ...EASTERN_BLOC_ABSENCES,
    COUNTRY_TO_ISO_NUMERIC: 'the row is "", an absence spelled as a string, not an ISO code',
    COUNTRY_UN_MEMBER_SINCE: "the Baltic republics are not separate UN members in this world",
  };
}
for (const cc of DEVOLVED_NATIONS) ABSENT_UPSTREAM[cc] = { ...DEVOLVED_ABSENCES };

for (const cc of ECONOMY_TIER_NO_CENSUS) {
  ABSENT_UPSTREAM[cc] = { ...ECONOMY_TIER_ABSENCES, ...NO_CENSUS };
}

/*
 * ⚠️ LAST, AND THAT ORDERING IS LOAD-BEARING. Each profile loop ASSIGNS a fresh
 * object, so anything merged in before one runs is discarded. Placed earlier,
 * this loop's entries for Greece, Austria and Finland were silently dropped by
 * the ECONOMY_TIER_NO_CENSUS assignment and three registries reported as
 * missing. Merging, rather than assigning, is what makes it safe here.
 */
for (const [registry, why, countries] of ABSENT_BY_REGISTRY) {
  for (const cc of countries) {
    ABSENT_UPSTREAM[cc] = { ...(ABSENT_UPSTREAM[cc] ?? {}), [registry]: why };
  }
}

/**
 * A registry whose row for this country is SHARED machinery, not its data.
 *
 * ⚠ THIS IS THE OPPOSITE FAILURE FROM AN ABSENT ROW, AND IT LOOKS THE SAME
 * FROM THE REGISTRY SIDE. `MECHANICS_BY_COUNTRY` has all 29 countries, so a
 * coverage count calls Brazil present -- but `MECHANICS_BY_COUNTRY.BR` is
 * `ECON_COUNTRY_CABINET_MECHANICS`, the economy-tier set that NINE countries
 * share. Forwarding it would put eight other countries' cabinet inside Brazil's
 * folder and make shared machinery look authored.
 *
 * So the check inverts: the registry MUST still resolve (a row that disappears
 * is a real change), and the folder MUST NOT supply a value (supplying one means
 * the country has authored its own and this entry is stale).
 */
const SHARED_UPSTREAM: Record<string, Record<string, string>> = {};

/*
 * All nine economy-tier countries point at the same cabinet. Brazil found it
 * first; the other eight were always going to be identical, and listing them
 * once keeps the claim in one place.
 */
for (const cc of [...EASTERN_BLOC, ...SOVIET_REPUBLICS, ...BALTIC, ...DEVOLVED_NATIONS]) {
  SHARED_UPSTREAM[cc] = {
    MECHANICS_BY_COUNTRY:
      "easternBlocCabinet.ts builds the whole Warsaw Pact's cabinets from DD's; " +
      "PL and YU get variants, CS/HU/RO/BG share one, and none of it is one country's",
  };
}

for (const cc of ["BR", ...ECONOMY_TIER, ...ECONOMY_TIER_NO_CENSUS]) {
  SHARED_UPSTREAM[cc] = {
    MECHANICS_BY_COUNTRY: "ECON_COUNTRY_CABINET_MECHANICS, shared by nine economy-tier countries",
  };
}

/** Where each registry's value lives inside the folder. `null` = no folder side. */
const FOLDER_PATH: Record<string, string | null> = {
  COUNTRY_CONFIGS: "institutions.config",
  NATIONAL_ADDRESS_NAME: "identity.addressNames.national",
  CABINET_IDENTITY: "identity.cabinet",
  NATIONAL_IDENTITY: "identity.national",
  NATIONAL_STATS_IDENTITY: "identity.stats",
  TREASURY_TEXT: "identity.treasuryText",
  ECONOMY_TEXT: "identity.economyText",
  EXECUTIVE_TEXT: "identity.executiveText",
  POLICY_TEXT: "identity.policyText",
  EXECUTIVE_SEALS: "identity.executiveSeal",
  EXECUTIVE_SURFACE: "identity.executiveSurface",
  COUNTRY_HISTORICAL_NAMES: "identity.historicalNames",
  COUNTRY_MODERN_NAMES: "identity.modernNames",
  LEGISLATIVE_PROCESS: "institutions.legislativeProcess",
  ESTATE_PORTFOLIO_BY_COUNTRY: "institutions.estatePortfolio",
  GROUPS: "institutions.cabinet.groups",
  ORDERS_BY_COUNTRY: "institutions.cabinet.orders",
  MECHANICS_BY_COUNTRY: "institutions.cabinet.mechanics",
  ENERGY_POSITION_BY_COUNTRY: "institutions.positions.energy",
  INFRA_POSITION_BY_COUNTRY: "institutions.positions.infrastructure",
  DEFENSE_POSITION_BY_COUNTRY: "institutions.positions.defense",
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY: "institutions.positions.foreignAffairs",
  TRADE_MINISTER_POSITION_BY_COUNTRY: "institutions.positions.tradeMinister",
  MILITARY_BRANCHES_BY_COUNTRY: "institutions.military.branches",
  MILITARY_COUNTRY_SCALE: "institutions.military.scale",
  ORDERS_OF_BATTLE: "institutions.military.ordersOfBattle",
  COUNTRY_CURRENCY_MAP: "economy.currencyCode",
  ECONOMIC_BASELINES: "economy.economicBaseline",
  MONETARY_BASELINES: "economy.monetary.baseline",
  COUNTRY_SECTOR_WEIGHTS: "economy.sectorWeights.base",
  REP_ECON: "economy.repEcon",
  COST_SCALE_ANCHORS: "economy.costScaleAnchors",
  NATIONAL_POLICY_STATE_IDS: "economy.nationalPolicyStateId",
  LEGISLATION_COUNTRY_SCOPES: "economy.legislationScope",
  TREASURY_PS_RATE_BY_COUNTRY: "economy.tax.treasuryPsRate",
  PLAYER_PAYOUT_CAP_PER_TURN: "economy.payoutCapPerTurn",
  DEFAULT_STRATEGIC_SECTORS: "economy.strategicSectors",
  SOVEREIGN_CORP_LEGAL_STRUCTURE: "economy.sovereignCorpLegalStructure",
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: "economy.tax.neutralFederalSalesTax",
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: "economy.tax.neutralStateSalesTax",
  COUNTRY_CONTINENT: "geography.continent",
  COUNTRY_TO_ISO_NUMERIC: "geography.isoNumeric",
  COUNTRY_REGIONS: "geography.worldRegion",
  COUNTRY_UN_MEMBER_SINCE: "geography.unMemberSince",
  NPP_CAPITAL_STATES: "geography.nppCapitalState",
  STATE_ADJACENCY: "geography.adjacency",
  CONSCRIPTION_SEED: "geography.conscription",
  COUNTRY_MAP_REGISTRY: "geography.mapRegistry",
  COUNTRY_ANCHOR: null,
  MEDIAN_INCOME_THRESHOLDS: null,
  POPULATION_MULTIPLIERS: "geography.populationMultipliers",
  CENSUS_BUNDLES: "geography.censusBundles",
  SPAWN_ELECTIONS_REGISTRY: "elections.spawn",
  COUNTRY_SECTOR_WEIGHTS_1979: "economy.sectorWeights.byEra.1979",
  COUNTRY_SECTOR_WEIGHTS_1991: "economy.sectorWeights.byEra.1991",
  MONETARY_BASELINES_1953: "economy.monetary.byEra.1953",
  MONETARY_BASELINES_1971: "economy.monetary.byEra.1971",
  MONETARY_BASELINES_1979: "economy.monetary.byEra.1979",
  MONETARY_BASELINES_1991: "economy.monetary.byEra.1991",
  M2_TO_GDP_1953: "economy.m2ToGdp1953",
  GDP_DENOMINATION_1953: "economy.gdpDenomination1953",
  RAW_BUNDLES: "geography.rawMetrics",
  NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY: "geography.nonPartyIndependentBias",
  COUNTRY_COMMAND_FLAVOR: "identity.commandFlavor",
  COUNTRY_MODIFIER_PATCHES: "geography.modifierPatches",
  MAJOR_DEFAULT_PARTIES: "elections.majorDefaultParties",
  SURFACES: "identity.parliamentarySurface",
  REGION_CENSUS_LABELS: "identity.regionCensusLabels",
  STATE_DISPLAY_NAMES: "identity.stateDisplayNames",
  METRIC_PRESET_BUNDLES: "geography.metricPresets",
  POPULATION_ANCHOR_BUNDLES: "geography.populationAnchors",
  FULL_ERA_REGION_BUNDLES: "geography.regionBundles",
  REGION_NAME_MAPS: "geography.regionNames",
  COUNTRY_SECTOR_WEIGHTS_1953: "economy.sectorWeights.byEra.1953",
  REGIONAL_BILL_ASSENT_OFFICE_KEY: "institutions.regionalBillAssentOfficeKey",
  INCOME_ANCHORS: "geography.incomeAnchors",
  TARGETS: "geography.calibrationTargets",
  COUNTRY_ERA1991_PATCHES: "geography.era1991Patches",
  HAZARD_GROUPS: "geography.hazardGroups",
  REGION_DEMOGRAPHIC_CATEGORY_IDS: "geography.demographicCategoryIds",
};

function at(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? o : d(o)[k]), root);
}

/**
 * Registries where `null` is a VALUE, not an absence.
 *
 * ⚠️ `Record<CountryId, string | null>`, AND THE NULL MEANS SOMETHING. The
 * six Warsaw Pact countries have `TRADE_MINISTER_POSITION_BY_COUNTRY.<cc> ===
 * null`: the row exists and says this country has no trade minister. Treating
 * that as "absent" made the harness demand an exemption for a fact the registry
 * states outright, and an exemption would then have hidden the row going
 * genuinely missing.
 */
/**
 * Registries where an empty STRING means "no value", not "the empty value".
 *
 * ⚠️ NARROW ON PURPOSE. `NPP_CAPITAL_STATES` holds `""` for eleven countries
 * and it means exactly what it says -- no NPP capital state -- so `""` is an
 * answer there and the folder carries it. `COUNTRY_TO_ISO_NUMERIC` is different:
 * the Baltic States' `""` is not an ISO code, and a folder carrying it would be
 * asserting a code that does not exist.
 */
/**
 * Registries that are PARTIAL BY DESIGN, where a missing row says nothing about
 * the folder.
 *
 * ⚠️ THE USUAL RULE IS THE RIGHT ONE ALMOST EVERYWHERE: if a registry has no row
 * for a country, the folder must not supply one either, because a folder value
 * with no registry behind it is a value somebody invented. These two are the
 * exception. `FULL_ERA_REGION_BUNDLES` lives in `admin/seedDiagnostic/` and
 * covers six countries; `REGION_NAME_MAPS` is the seat seeder's own map. The
 * folder's regions come from the authored region modules by way of the SEED
 * RUNNER, which is the authority -- so the folder being fuller than the registry
 * is the normal state, not an invention.
 */
const PARTIAL_REGISTRY = new Set(["FULL_ERA_REGION_BUNDLES", "REGION_NAME_MAPS"]);

/**
 * Rows that forward into the country's folder at a module the CONTRACT does not
 * surface, so there is no `FOLDER_PATH` to compare against.
 *
 * ⚠️ JAPAN'S 1953 SECTOR WEIGHTS LIVE IN `jp/data/jpSectorWeights1953.ts` and the
 * registry already imports them from there -- single-sourced, just not reachable
 * through `economy.sectorWeights.byEra`. Putting them on that object would need
 * a value import in `jp/economy.ts`, which `clientSafeLeafModules.test.ts`
 * forbids: that module is read by a client component through a forwarder, and a
 * value import there ships the data module to the browser.
 *
 * ⚠️ THIS CHECK IS STATIC AND WEAKER THAN THE REST OF THE FILE. It reads the
 * registry's source and asserts the import exists; it cannot prove the imported
 * binding is the one the key resolves to. It is recorded here rather than left
 * silent so the weakness is visible, and so the row is not mistaken for an
 * absence -- which is what an ABSENT_UPSTREAM entry would have claimed.
 */
/**
 * Registries deliberately OUT of scope for a country folder, with the reason.
 *
 * ⚠️ NOT A BACKLOG. An audit of the registries this harness does not cover will
 * keep finding these, and without a note each re-audit re-opens a question the
 * contract already answered. `INITIAL_RATES` is the clearest: a rate is a fact
 * BETWEEN two currencies, so a per-country copy drifts by construction, and
 * `CountryEconomy`'s own doc comment says so. `TREASURY_IDENTITY` is DERIVED --
 * `treasuryIdentity.ts` composes it from TREASURY_TEXT plus the national
 * palette, so a folder copy would be a second source of a computed value.
 */
const OUT_OF_SCOPE: Record<string, string> = {
  INITIAL_RATES: "relational: a rate is a fact between two currencies, not a country's",
  TREASURY_IDENTITY: "derived from TREASURY_TEXT plus the national palette",

  /*
   * ⚠️ MOVING THIS WOULD CREATE DUPLICATION, NOT REMOVE IT -- measured, not
   * assumed. Of the three fields in a bill-phase entry:
   *   - `phaseName` is `<cc>BillLifecycle` for 26 of 26, derivable from the id;
   *   - `emptyResult` is the same `{ enacted: 0, failed: 0 }` for 25 of 26;
   *   - `fn` is the only per-country part, and it CANNOT move. Japan's folder
   *     says why: `turn/billLifecycle/dispatch` reaches back into the folder
   *     through `configs/jp`, so naming the fn there is a real runtime cycle.
   * Japan's distinctive `emptyResult` (it also reports `overrides` and
   * `cabinetPassed`) is ALREADY in its folder, as `JP_BILL_PHASE_SHAPE`. That is
   * the one genuinely per-country fact, and it is where it belongs. Moving the
   * other 25 would write one derivable string and one shared literal into 25
   * folders.
   */
  COUNTRY_BILL_PHASES:
    "a dispatch table, not country data: phaseName is derivable and emptyResult is shared by 25 of 26; the fn cannot move without a runtime cycle",

  /*
   * ⚠️ THE LAZINESS IS THE POINT. `substrateCoverage.ts` holds these as thunks
   * because the rosters together pull in every country seed module, and only
   * tests and scripts import it. `geography.regionBundles` is eager, so
   * forwarding would load every country's bundles for any importer -- defeating
   * the documented reason the registry is shaped this way.
   */
  REGION_ROSTERS:
    "deliberately lazy thunks; forwarding to geography.regionBundles would load every country's bundles eagerly",

  /*
   * ⚠️ NOT "IMPOSSIBLE", DELIBERATE -- and Japan is the counterexample that
   * proves it. `JP_READINESS_EXPECTATIONS` already lives in `jp/data/`, so the
   * pattern exists. It is left alone because the entries are async closures that
   * take a `Db` and run checks against it: this is an admin diagnostic about
   * whether a country is seeded, not a fact about the country. Spreading
   * DB-touching closures across 29 folders would put query code in the one place
   * the contract keeps free of it.
   */
  COUNTRY_READINESS_EXPECTATIONS:
    "admin diagnostic: async Db-taking closures that check seed state, not country data (Japan's is moved; the rest deliberately are not)",
};
void OUT_OF_SCOPE;

/**
 * Registries whose OUTER key is not the country -- an era, a preset, a metric --
 * with the country one level in.
 *
 * ⚠️ THE MAIN LOOP IS BLIND TO THESE, AND THAT IS WHERE THE DUPLICATION SURVIVED.
 * `REGISTRIES` is `Record<countryId, value>`, so a registry shaped
 * `Record<preset, Record<countryId, value>>` matched nothing and was checked by
 * nothing. `ERA_COUNTRY_CONFIG_OVERRIDES` sat like that holding 25 countries'
 * era overrides as literals while each folder's `eras/<preset>.ts` held the same
 * values -- and `getCountryConfig` read the REGISTRY, so the folder copy was the
 * dead one. Same shape, same story, for `UNION_NAMES_BY_ERA`.
 *
 * Each entry compares `registry[outer][cc]` to the folder path with `<outer>`
 * substituted, by reference.
 */
const OUTER_KEYED: Record<string, { registry: Dict; path: string }> = {
  ERA_COUNTRY_CONFIG_OVERRIDES: {
    registry: d(ERA_COUNTRY_CONFIG_OVERRIDES),
    path: "eras.<outer>.config",
  },
  CORE5_NORMALS: { registry: d(CORE5_NORMALS), path: "geography.core5Normals.<outer>" },
};

const FOLDER_MODULE_FORWARD: Record<string, Record<string, string>> = {
  JP: {
    COUNTRY_SECTOR_WEIGHTS_1953: "src/lib/seeds/reference/sectorSeedWeights1953.ts",
  },
};

/*
 * Bucket labels forward through a data module rather than the contract, because
 * the registry is CLIENT-REACHABLE (`FactorLedgerCard` is a client component) and
 * `identity.ts` may hold no value imports. Inlining 28 countries' labels there
 * instead would have duplicated the shared EN/DE scaffolding five and two ways --
 * the duplication this pass exists to remove.
 *
 * ⚠️ US IS ABSENT ON PURPOSE and is recorded below, not here: the American terms
 * ARE the global default, `BUCKET_LABELS` in `bucketLabels.ts`. A US row would be
 * a second copy of the fallback it falls back to.
 */
for (const cc of [
  "UK",
  "IE",
  "NG",
  "DE",
  "DD",
  "AT",
  "BR",
  "FR",
  "IT",
  "ES",
  "SE",
  "FI",
  "TR",
  "JP",
  "CN",
  "RU",
  "GR",
  "HU",
  "PL",
  "RO",
  "YU",
  "CS",
  "BAL",
  "BG",
  "UKR",
  "BLR",
  "SCO",
  "WAL",
]) {
  FOLDER_MODULE_FORWARD[cc] = {
    ...(FOLDER_MODULE_FORWARD[cc] ?? {}),
    COUNTRY_BUCKET_LABELS: "src/lib/demographics/bucketLabelsByCountry.ts",
  };
}

/* Affinities forward the same way, for the same reason: a client component reads
 * the table and each country's block is a thousand numbers. */
for (const cc of ["US", "UK", "IE", "JP", "DE", "CN"]) {
  FOLDER_MODULE_FORWARD[cc] = {
    ...(FOLDER_MODULE_FORWARD[cc] ?? {}),
    DOMAIN_BUCKET_AFFINITIES: "src/lib/bucketAffinities.ts",
  };
}

/*
 * The last three outer-keyed registries. Each forwards to a folder module, but
 * none can be compared by reference the way OUTER_KEYED does:
 *   - UNION_NAMES_BY_ERA's country slices are data modules, not contract fields;
 *   - ORDERS_OF_BATTLE_BY_ERA keys era-first over a field that also exists on the
 *     base institutions and on era overrides, so there is no single folder path;
 *   - ISO_NUMERIC_TO_COUNTRY holds the country as its VALUE, not its key -- its
 *     inverse, COUNTRY_TO_ISO_NUMERIC, is checked by reference above.
 * The static check is weaker and is recorded here rather than left silent.
 */
for (const cc of CONVERTED) {
  FOLDER_MODULE_FORWARD[cc] = {
    ...(FOLDER_MODULE_FORWARD[cc] ?? {}),
    UNION_NAMES_BY_ERA: "src/lib/seeds/reference/unionNames.ts",
    ORDERS_OF_BATTLE_BY_ERA: "src/lib/seeds/reference/ordersOfBattle.ts",
    ISO_NUMERIC_TO_COUNTRY: "src/lib/constants/countryIso.ts",
  };
}

/**
 * Registry rows that are DERIVED elsewhere, so the folder must NOT restate them.
 *
 * ⚠️ THE FOLDER IS THE WRONG SOURCE HERE, WHICH IS THE OPPOSITE OF EVERY OTHER
 * ENTRY IN THIS FILE. `commodityRegionMappings.ts` builds these sixteen
 * countries' display names at runtime from their region rosters, under a comment
 * reading "no hand-maintained copies to drift". The conversion snapshotted that
 * derivation into each folder as a frozen literal -- so a renamed or added
 * region would move the registry and leave the folder behind. The copies are
 * removed; the rosters remain the single source.
 *
 * The check therefore inverts: the registry must resolve, and the folder must
 * be silent.
 */
const DERIVED_UPSTREAM: Record<string, Record<string, string>> = {};
for (const cc of [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "CS",
  "BLR",
  "BAL",
]) {
  DERIVED_UPSTREAM[cc] = {
    STATE_DISPLAY_NAMES: "derived from the region roster in commodityRegionMappings.ts",
  };
}

const EMPTY_STRING_IS_ABSENCE = new Set(["COUNTRY_TO_ISO_NUMERIC"]);

const NULL_IS_A_VALUE = new Set([
  "DEFENSE_POSITION_BY_COUNTRY",
  "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY",
  "TRADE_MINISTER_POSITION_BY_COUNTRY",
]);

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  /*
   * ⚠️ AN EMPTY STRING IS AN ABSENCE SPELLED AS A VALUE. The Baltic States'
   * `COUNTRY_TO_ISO_NUMERIC` row is `""` -- not an ISO code, and not a code the
   * folder should carry. Counting it as present made the harness demand a
   * folder value for something the registry declines to state.
   */
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && v !== null && Object.keys(v).length === 0);

export async function verify(cc: string): Promise<boolean> {
  const mod = (await import(`../../src/lib/countries/${cc.toLowerCase()}/index`)) as Dict;
  const folder = mod[cc];
  if (!folder) {
    console.log(`FAIL  the ${cc} folder's barrel exports no \`${cc}\``);
    return false;
  }
  const exempt = ABSENT_UPSTREAM[cc] ?? {};
  const shared = SHARED_UPSTREAM[cc] ?? {};
  const derived = DERIVED_UPSTREAM[cc] ?? {};
  const viaModule = FOLDER_MODULE_FORWARD[cc] ?? {};

  let resolved = 0;
  let forwarders = 0;
  let scalars = 0;
  let failed = 0;

  for (const [name, registry] of Object.entries(REGISTRIES)) {
    const value = registry[cc];
    const why = exempt[name];
    const path = FOLDER_PATH[name];
    const sharedWhy = shared[name];
    const derivedWhy = derived[name];
    const viaModuleFile = viaModule[name];
    /*
     * Declared HERE, not inside a branch: both the shared path below and the
     * ordinary path further down need it. The first version was scoped to the
     * shared branch and six countries kept failing on a legal `null`.
     */
    /*
     * ⚠️ "ABSENT" MEANS THE KEY IS MISSING, NOT THAT THE VALUE IS FALSY. Scotland
     * and Wales have `MILITARY_BRANCHES_BY_COUNTRY` rows holding `[]` and
     * `NPP_CAPITAL_STATES` rows holding `""` -- devolved nations with no armed
     * forces and no NPP capital. Those are ANSWERS. Treating them as absences
     * made the harness demand an exemption for a row that exists, and an
     * exemption would then have hidden the row going genuinely missing.
     *
     * `undefined`, `null` and `""` still count as absent even with the key
     * present. Germany's `COUNTRY_UN_MEMBER_SINCE` is written `DE: undefined`
     * with a comment, and the Baltic States' ISO row is `""` -- absences their
     * authors spelled out rather than omitted. An empty ARRAY or OBJECT is
     * different: it is a populated answer that happens to be empty.
     */
    const present =
      cc in registry &&
      value !== undefined &&
      value !== null &&
      !(value === "" && EMPTY_STRING_IS_ABSENCE.has(name));
    const nullIsValue = NULL_IS_A_VALUE.has(name) && value === null && cc in registry;

    if (viaModuleFile) {
      const src = readFileSync(viaModuleFile, "utf8");
      if (!present) {
        console.log(`FAIL  ${name}.${cc} no longer resolves at all.`);
        failed++;
      } else if (
        !new RegExp(`from "(@/lib|\\.)/countries/${escapeRegExp(cc.toLowerCase())}/`).test(src)
      ) {
        console.log(
          `FAIL  ${name}.${cc} is recorded as forwarding to a folder module, but ` +
            `${viaModuleFile} imports nothing from ${cc.toLowerCase()}/. The forward is gone.`
        );
        failed++;
      } else {
        resolved++;
      }
      continue;
    }

    if (derivedWhy) {
      const side = path ? at(folder, path) : undefined;
      if (!present) {
        console.log(
          `FAIL  ${name}.${cc} is listed as derived upstream ("${derivedWhy}") but the ` +
            `registry no longer carries it.`
        );
        failed++;
      } else if (!isEmpty(side)) {
        console.log(
          `FAIL  ${name}.${cc} is derived upstream ("${derivedWhy}"), but the folder restates ` +
            `it at ${path}. A frozen copy of a derived value cannot follow its source.`
        );
        failed++;
      } else {
        resolved++;
      }
      continue;
    }

    if (sharedWhy) {
      const side = path ? at(folder, path) : undefined;

      if (!present && !nullIsValue) {
        console.log(
          `FAIL  ${name}.${cc} is listed as shared upstream ("${sharedWhy}") but the registry ` +
            `no longer carries it.`
        );
        failed++;
      } else if (!isEmpty(side)) {
        console.log(
          `FAIL  ${name}.${cc} is listed as shared upstream ("${sharedWhy}"), but the folder ` +
            `now supplies ${path}. Either the country authored its own and the entry is ` +
            `stale, or the folder has claimed shared machinery.`
        );
        failed++;
      } else {
        resolved++;
      }
      continue;
    }

    if (!present && !nullIsValue) {
      if (why) {
        const side = path ? at(folder, path) : undefined;
        if (!isEmpty(side) && !PARTIAL_REGISTRY.has(name)) {
          console.log(
            `FAIL  ${name}.${cc} is exempt as "${why}", but the folder supplies a value at ` +
              `${path}. Either the exemption is stale or the folder invented the value.`
          );
          failed++;
        }
        continue;
      }
      console.log(`FAIL  ${name}.${cc} -> ${JSON.stringify(value)}`);
      failed++;
      continue;
    }
    if (why) {
      console.log(`FAIL  ${name}.${cc} is listed as absent upstream ("${why}") but resolves.`);
      failed++;
      continue;
    }
    resolved++;

    if (!path) continue;
    const side = at(folder, path);
    if (side === undefined && !nullIsValue) {
      console.log(`FAIL  ${name}.${cc} -> the folder side ${path} is undefined`);
      failed++;
      continue;
    }
    // A scalar comparison is value equality and proves nothing about
    // single-definition: a registry holding its own "EUR" passes exactly as a
    // forwarder does. They are counted separately so the identity number is
    // never inflated by comparisons that could not have failed for that reason.
    const scalar = typeof side !== "object" && typeof side !== "function";
    if (value !== side) {
      console.log(
        scalar
          ? `FAIL  ${name}.${cc} value differs: registry ${String(value)} vs folder ${String(side)}`
          : `FAIL  ${name}.${cc} is a SECOND COPY: equal values, different object. It does not forward.`
      );
      failed++;
      continue;
    }
    if (scalar) scalars++;
    else forwarders++;
  }

  /*
   * ⚠️ THE PHASES ARE COMPARED ENTRY BY ENTRY, BECAUSE A GENERATOR ONCE GOT
   * THEM FROM THE WRONG COUNTRY. `COUNTRY_ELECTION_PHASES` writes one-line
   * entries -- `SE: [{ name: "seElections", fn: ensureSEElections }],` -- and the
   * generator that reads it searched forward for a multi-line terminator, ran
   * past Sweden into Turkey, and gave Sweden THREE phases: its own plus both of
   * Turkey's. It typechecked and shipped, and it would have run Turkey's
   * elections under Sweden's id every turn.
   *
   * `fn` is compared by reference, which is the only comparison that means
   * anything for a function: two spawners with the same name are not the same
   * spawner, and `toEqual` would call them equal.
   */
  const declaredPhases = (COUNTRY_ELECTION_PHASES as Dict)[cc] as
    Array<{ name: string; fn: unknown }> | undefined;
  const folderPhases = at(folder, "elections.electionPhases") as
    Array<{ name: string; fn: unknown }> | undefined;
  if (declaredPhases && declaredPhases.length > 0) {
    if (!folderPhases) {
      console.log(
        `FAIL  ${cc} has ${declaredPhases.length} COUNTRY_ELECTION_PHASES entries but the ` +
          `folder declares no electionPhases.`
      );
      failed++;
    } else if (folderPhases.length !== declaredPhases.length) {
      console.log(
        `FAIL  ${cc} electionPhases count differs: folder ${folderPhases.length} vs ` +
          `COUNTRY_ELECTION_PHASES ${declaredPhases.length}. ` +
          `folder=[${folderPhases.map((p) => p.name).join(", ")}]`
      );
      failed++;
    } else {
      for (let i = 0; i < declaredPhases.length; i++) {
        if (
          folderPhases[i].name !== declaredPhases[i].name ||
          folderPhases[i].fn !== declaredPhases[i].fn
        ) {
          console.log(
            `FAIL  ${cc} electionPhases[${i}] differs: folder ${folderPhases[i].name} vs ` +
              `declared ${declaredPhases[i].name}`
          );
          failed++;
        }
      }
    }
  }

  /*
   * Outer-keyed registries: the country sits one level inside an era, preset or
   * metric key. Only outer keys that actually carry this country are checked --
   * a registry naming three presets says nothing about the other five.
   */
  for (const [name, { registry, path }] of Object.entries(OUTER_KEYED)) {
    for (const [outer, row] of Object.entries(registry)) {
      const value = (row as Dict)?.[cc];
      if (value === undefined) continue;
      const side = at(folder, path.replace("<outer>", outer));
      if (side === undefined) {
        console.log(
          `FAIL  ${name}["${outer}"].${cc} resolves, but the folder supplies nothing at ` +
            `${path.replace("<outer>", outer)}.`
        );
        failed++;
      } else if (side !== value) {
        console.log(
          `FAIL  ${name}["${outer}"].${cc} is a SECOND COPY: equal values, different ` +
            `object. It does not forward.`
        );
        failed++;
      } else {
        forwarders++;
      }
    }
  }

  console.log(
    `${cc}: ${resolved}/${Object.keys(REGISTRIES).length} registries resolve, ` +
      `${forwarders} forwarders identical, ${scalars} scalars match, ${failed} failures.`
  );
  return failed === 0;
}

/**
 * ⚠️ THE CLI RUNS ONLY WHEN THIS FILE IS INVOKED AS ONE.
 *
 * `verify-country-runtime.test.ts` imports `verify` so this check runs inside
 * `test:run` -- which is the only gate CI actually executes. CI runs lint,
 * architecture:audit, format:check, tsc, test:run and verify:build, and never
 * `npm run verify`, so a harness that only ran from the CLI was enforced by
 * nothing. Without this guard the test's import would parse vitest's argv,
 * find no country codes and exit the whole run.
 */
function invokedAsScript(): boolean {
  // Basename, so the Windows/POSIX separator never enters into it. The test
  // file is `verify-country-runtime.test.ts`, which does not end with this.
  return process.argv.some((a) => a.endsWith("verify-country-runtime.ts"));
}

/*
 * Wrapped rather than a top-level `await`: tsx transforms this file to CJS,
 * where top-level await is a transform error rather than a runtime one.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets = args.includes("--all") ? [...CONVERTED] : args.map((a) => a.toUpperCase());
  if (targets.length === 0) {
    console.error("usage: npx tsx scripts/countries/verify-country-runtime.ts <CC>... | --all");
    process.exitCode = 1;
    return;
  }
  let ok = true;
  for (const cc of targets) ok = (await verify(cc)) && ok;
  if (ok) console.log(`\nEvery registry resolves, forwards and matches for ${targets.join(", ")}.`);
  process.exitCode = ok ? 0 : 1;
}

if (invokedAsScript()) void main();
