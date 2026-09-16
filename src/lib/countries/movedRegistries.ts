import { CABINET_IDENTITY } from "@/lib/constants/cabinetIdentity";
import { NATIONAL_ADDRESS_NAME } from "@/lib/constants/countries";
import { ECONOMY_TEXT } from "@/lib/constants/economyIdentity";
import { EXECUTIVE_SEALS } from "@/lib/constants/executiveSeals";
import { EXECUTIVE_SURFACE } from "@/lib/constants/executiveSurface";
import { EXECUTIVE_TEXT, POLICY_TEXT } from "@/lib/constants/institutionIdentity";
import { NATIONAL_IDENTITY } from "@/lib/constants/nationalIdentity";
import { NATIONAL_STATS_IDENTITY } from "@/lib/constants/nationalStatsIdentity";
import { SURFACES } from "@/lib/constants/parliamentaryExecutiveSurface";
import { REGION_CENSUS_LABELS } from "@/lib/constants/regionCensusLabels";
import { TREASURY_TEXT } from "@/lib/constants/treasuryIdentity";
import { COUNTRY_HISTORICAL_NAMES, COUNTRY_MODERN_NAMES } from "@/lib/banking/npcBanks";
import { STATE_DISPLAY_NAMES } from "@/lib/commodity-map/commodityRegionMappings";
import { COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import {
  COUNTRY_CONFIGS,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/constants/countries";
import { ENERGY_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetEnergy";
import { INFRA_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetInfra";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { GROUPS } from "@/lib/constants/cabinetPositionGroups";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
} from "@/lib/constants/military";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "@/lib/constants/internationalOrganizations";
import { LEGISLATIVE_PROCESS } from "@/lib/legislature/process";
import { ORDERS_OF_BATTLE, ORDERS_OF_BATTLE_BY_ERA } from "@/lib/seeds/reference/ordersOfBattle";
import { ORDERS_BY_COUNTRY } from "@/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "@/lib/constants/cabinetMechanics";
import {
  COUNTRY_CURRENCY_MAP,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
} from "@/lib/constants/currencies";
import {
  MONETARY_BASELINES_1953,
  MONETARY_BASELINES_1971,
  MONETARY_BASELINES_1979,
  MONETARY_BASELINES_1991,
} from "@/lib/constants/monetaryEra";
import { COST_SCALE_ANCHORS } from "@/lib/budget/costs";
import { SOVEREIGN_CORP_LEGAL_STRUCTURE } from "@/lib/seeds/reference/budgets";
import { M2_TO_GDP_1953 } from "@/lib/seeds/reference/moneySupply";
import { COUNTRY_SECTOR_WEIGHTS } from "@/lib/seeds/reference/sectorSeedWeights";
import { COUNTRY_SECTOR_WEIGHTS_1979 } from "@/lib/seeds/reference/sectorSeedWeights1979";
import { COUNTRY_SECTOR_WEIGHTS_1991 } from "@/lib/seeds/reference/sectorSeedWeights1991";
import { DEFAULT_STRATEGIC_SECTORS } from "@/lib/seeds/reference/strategicSectors";
import { REP_ECON } from "@/lib/era/legislationCostCatalog";
import { TREASURY_PS_RATE_BY_COUNTRY } from "@/lib/politicalStrength/strengthConstants";
import {
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY,
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY,
} from "@/lib/turn/gdpGrowth";
import { PLAYER_PAYOUT_CAP_PER_TURN } from "@/lib/treasury/payoutCapValues";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import { LEGISLATION_COUNTRY_SCOPES } from "@/lib/policy/nationalPolicyRecords";
import { COUNTRY_CONTINENT } from "@/lib/constants/countryContinents";
import { COUNTRY_TO_ISO_NUMERIC, ISO_NUMERIC_TO_COUNTRY } from "@/lib/constants/countryIso";
import { COUNTRY_REGIONS, COUNTRY_UN_MEMBER_SINCE } from "@/lib/world/worldEntityManifest";
import { STATE_ADJACENCY } from "@/lib/constants/stateAdjacency";
import { FULL_ERA_REGION_BUNDLES } from "@/lib/admin/seedDiagnostic/regionBundles";
import { REGION_NAME_MAPS } from "@/lib/admin/seed/seedSeats";
import { NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";
import { COUNTRY_MAP_REGISTRY } from "@/lib/commodity-map/commodityMapRegistry";
import { HAZARD_GROUPS } from "@/lib/crises/regionHazards";
import { CENSUS_BUNDLES } from "@/lib/seeds/regionCensusData";
import { CONSCRIPTION_SEED } from "@/lib/demographics/conscription";
import { POPULATION_ANCHOR_BUNDLES } from "@/lib/seeds/populationAnchors";
import { METRIC_PRESET_BUNDLES } from "@/lib/seeds/metricPresets";
import { CORE5_NORMALS, INCOME_ANCHORS } from "@/lib/era/metricCatalog";
import { TARGETS } from "@/lib/seeds/calibration/targets";
import { RAW_BUNDLES } from "@/lib/states/conditions/seedMetricsLoader";
import { COUNTRY_ERA1991_PATCHES } from "@/lib/states/conditions/countryEra1991Patches";
import { NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY } from "@/lib/turn/partyOrg/pacingConstants";
import { REGION_ROSTERS } from "@/lib/demographics/substrateCoverage";
import { COUNTRY_READINESS_EXPECTATIONS } from "@/lib/constants/countryReadinessExpectations";
import { SPAWN_ELECTIONS_REGISTRY } from "@/lib/turn/perpetualElections/registry";
import { PARLIAMENTARY_CABINET_CONFIGS } from "@/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";

/**
 * The faithful-replacement table. Each entry names one registry that now
 * FORWARDS to Japan's folder, and reads what it hands back.
 *
 * ⚠️ `after` reads the LIVE registry on purpose, and `before` is deliberately
 * NOT here. The pre-move value lives only in the committed snapshot fixture, and
 * the test supplies it. If `before` read the live registry too, the comparison
 * would be the new thing against itself: that tautology is not hypothetical, it
 * happened in Plan C task C0 when rewiring `getPresetSeats` made its
 * faithful-replacement test vacuous until it was rebuilt from raw source arrays.
 *
 * `name` is the fixture key, so a typo fails rather than silently skipping.
 *
 * ⚠️ No filesystem access in this module. Reading the fixture belongs to the
 * test, not to src code that ships.
 */
export interface MovedRegistry {
  /** Key in `__snapshots__/jp.pre-move.json`. */
  readonly name: string;
  /**
   * For an OUTER-KEYED fixture entry, the era or preset to compare.
   *
   * ⚠️ Preset-first registries hold Japan once per era, and comparing the whole
   * object at once turns a dropped era into one opaque diff. Splitting by era
   * makes a missing 2007 fail on a line that says 2007 -- which is how earlier
   * revisions lost eras without noticing.
   */
  readonly subKey?: string;
  /** What the forwarding registry hands back for Japan, today. */
  readonly after: () => unknown;
}

/**
 * Registries whose values are FUNCTIONS.
 *
 * ⚠️ `toEqual` compares functions by REFERENCE, so the ordinary harness is
 * silent on these. Capture the reference pre-move and a re-export passes
 * tautologically; re-declare the thunk and it fails despite identical
 * behaviour. Either way the plan's only proof is blind.
 *
 * Measured, there are THREE, not the two the plan names: SPAWN_ELECTIONS_REGISTRY,
 * REGION_ROSTERS, and COUNTRY_BILL_PHASES.
 *
 * ⚠️ REGION_ROSTERS is NESTED, not flat, so paths walk country then era.
 *
 * ⚠️ The D1 design took `paths()` and `resolved()`, meaning the test had to CALL
 * each thunk. Most of these reach the database, so that was untestable. Instead
 * the test walks the live value, replaces every function with a marker, and
 * compares the result to the fixture -- which verifies the surrounding DATA and
 * the function TOPOLOGY together. A function that moved, vanished or appeared at
 * a new path fails, and so does a changed sibling value.
 */
export interface MovedThunkRegistry {
  /** Key in `__snapshots__/jp.pre-move.json`. */
  readonly name: string;
  /** The live registry's Japan entry, functions and all. */
  readonly after: () => unknown;
}

/**
 * D2 moved 15 registries. The plan's D2 list names 16, but TREASURY_IDENTITY is
 * DERIVED -- treasuryIdentity.ts composes it from TREASURY_TEXT plus the national
 * palette -- so only the authored text moves and the derived registry recomposes
 * itself. Forwarding both would create a second source of the same values.
 */
export const MOVED_REGISTRIES: readonly MovedRegistry[] = [
  { name: "CABINET_IDENTITY", after: () => CABINET_IDENTITY.JP },
  { name: "NATIONAL_IDENTITY", after: () => NATIONAL_IDENTITY.JP },
  { name: "NATIONAL_STATS_IDENTITY", after: () => NATIONAL_STATS_IDENTITY.JP },
  { name: "TREASURY_TEXT", after: () => TREASURY_TEXT.JP },
  { name: "ECONOMY_TEXT", after: () => ECONOMY_TEXT.JP },
  { name: "EXECUTIVE_TEXT", after: () => EXECUTIVE_TEXT.JP },
  { name: "POLICY_TEXT", after: () => POLICY_TEXT.JP },
  { name: "EXECUTIVE_SEALS", after: () => EXECUTIVE_SEALS.JP },
  { name: "EXECUTIVE_SURFACE", after: () => EXECUTIVE_SURFACE.JP },
  { name: "SURFACES", after: () => SURFACES.JP },
  { name: "REGION_CENSUS_LABELS", after: () => REGION_CENSUS_LABELS.JP },
  { name: "NATIONAL_ADDRESS_NAME", after: () => NATIONAL_ADDRESS_NAME.JP },
  { name: "STATE_DISPLAY_NAMES", after: () => STATE_DISPLAY_NAMES.JP },
  { name: "COUNTRY_HISTORICAL_NAMES", after: () => COUNTRY_HISTORICAL_NAMES.JP },
  { name: "COUNTRY_MODERN_NAMES", after: () => COUNTRY_MODERN_NAMES.JP },

  // D3 -- institutions and elections.
  { name: "COUNTRY_CONFIGS", after: () => COUNTRY_CONFIGS.JP },
  { name: "REGIONAL_BILL_ASSENT_OFFICE_KEY", after: () => REGIONAL_BILL_ASSENT_OFFICE_KEY.JP },
  { name: "ENERGY_POSITION_BY_COUNTRY", after: () => ENERGY_POSITION_BY_COUNTRY.JP },
  { name: "INFRA_POSITION_BY_COUNTRY", after: () => INFRA_POSITION_BY_COUNTRY.JP },
  { name: "DEFENSE_POSITION_BY_COUNTRY", after: () => DEFENSE_POSITION_BY_COUNTRY.JP },
  {
    name: "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY",
    after: () => FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.JP,
  },
  {
    name: "TRADE_MINISTER_POSITION_BY_COUNTRY",
    after: () => TRADE_MINISTER_POSITION_BY_COUNTRY.JP,
  },
  { name: "MILITARY_BRANCHES_BY_COUNTRY", after: () => MILITARY_BRANCHES_BY_COUNTRY.JP },
  { name: "MILITARY_COUNTRY_SCALE", after: () => MILITARY_COUNTRY_SCALE.JP },
  { name: "ESTATE_PORTFOLIO_BY_COUNTRY", after: () => ESTATE_PORTFOLIO_BY_COUNTRY.JP },
  { name: "GROUPS", after: () => GROUPS.JP },
  { name: "LEGISLATIVE_PROCESS", after: () => LEGISLATIVE_PROCESS.JP },
  { name: "ORDERS_OF_BATTLE", after: () => ORDERS_OF_BATTLE.JP },

  /**
   * Not forwarded by an edit: their SOURCE FILES were relocated into the folder,
   * so these registries already read from it. Pinned anyway, because "it should
   * still work" is the assumption this harness exists to replace.
   */
  { name: "ORDERS_BY_COUNTRY", after: () => ORDERS_BY_COUNTRY.JP },
  { name: "MECHANICS_BY_COUNTRY", after: () => MECHANICS_BY_COUNTRY.JP },

  /**
   * ⚠️ Preset-first, and Japan holds entries in SIX eras here and TWO there.
   * Flattened so a single dropped era fails on its own line.
   */
  ...(["1979", "1991", "1999", "2007", "2019", "2023"] as const).map((year) => ({
    name: "ORDERS_OF_BATTLE_BY_ERA",
    subKey: year,
    after: () => ORDERS_OF_BATTLE_BY_ERA[year]?.JP,
  })),
  ...(["1953-default", "1991-default"] as const).map((preset) => ({
    name: "ERA_COUNTRY_CONFIG_OVERRIDES",
    subKey: preset,
    after: () => ERA_COUNTRY_CONFIG_OVERRIDES[preset]?.JP,
  })),

  /**
   * D4 -- economy and fiscal.
   *
   * ⚠️⚠️ BALANCE SURFACE. These are the numbers CLAUDE.md requires a GitHub
   * issue and a scripts/sim/ report to change. This phase is a move, so every
   * one of them must still equal the pre-move snapshot. A failure here is not a
   * test to adjust -- it is a balance change that has to be escalated.
   *
   * ⚠️ INITIAL_RATES* is absent on purpose. It lives in the same file as
   * COUNTRY_CURRENCY_MAP but is RELATIONAL -- a rate is a fact between two
   * currencies, so a per-country copy drifts. Same for the two SOE ID-range
   * tables, which allocate non-overlapping ranges across countries.
   */
  { name: "COUNTRY_CURRENCY_MAP", after: () => COUNTRY_CURRENCY_MAP.JP },
  { name: "ECONOMIC_BASELINES", after: () => ECONOMIC_BASELINES.JP },
  { name: "MONETARY_BASELINES", after: () => MONETARY_BASELINES.JP },
  { name: "MONETARY_BASELINES_1953", after: () => MONETARY_BASELINES_1953.JP },
  { name: "MONETARY_BASELINES_1971", after: () => MONETARY_BASELINES_1971.JP },
  { name: "MONETARY_BASELINES_1979", after: () => MONETARY_BASELINES_1979.JP },
  { name: "MONETARY_BASELINES_1991", after: () => MONETARY_BASELINES_1991.JP },
  { name: "COST_SCALE_ANCHORS", after: () => COST_SCALE_ANCHORS.JP },
  { name: "SOVEREIGN_CORP_LEGAL_STRUCTURE", after: () => SOVEREIGN_CORP_LEGAL_STRUCTURE.JP },
  { name: "M2_TO_GDP_1953", after: () => M2_TO_GDP_1953.JP },
  { name: "COUNTRY_SECTOR_WEIGHTS", after: () => COUNTRY_SECTOR_WEIGHTS.JP },
  { name: "COUNTRY_SECTOR_WEIGHTS_1979", after: () => COUNTRY_SECTOR_WEIGHTS_1979.JP },
  { name: "COUNTRY_SECTOR_WEIGHTS_1991", after: () => COUNTRY_SECTOR_WEIGHTS_1991.JP },
  { name: "DEFAULT_STRATEGIC_SECTORS", after: () => DEFAULT_STRATEGIC_SECTORS.JP },
  { name: "REP_ECON", after: () => REP_ECON.JP },
  { name: "TREASURY_PS_RATE_BY_COUNTRY", after: () => TREASURY_PS_RATE_BY_COUNTRY.JP },
  {
    name: "NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY",
    after: () => NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP,
  },
  {
    name: "NEUTRAL_STATE_SALES_TAX_BY_COUNTRY",
    after: () => NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.JP,
  },
  { name: "PLAYER_PAYOUT_CAP_PER_TURN", after: () => PLAYER_PAYOUT_CAP_PER_TURN.JP },
  { name: "NATIONAL_POLICY_STATE_IDS", after: () => NATIONAL_POLICY_STATE_IDS.JP },
  { name: "LEGISLATION_COUNTRY_SCOPES", after: () => LEGISLATION_COUNTRY_SCOPES.JP },

  // D5 -- geography, regions, demographics.
  { name: "COUNTRY_CONTINENT", after: () => COUNTRY_CONTINENT.JP },
  { name: "COUNTRY_TO_ISO_NUMERIC", after: () => COUNTRY_TO_ISO_NUMERIC.JP },
  /**
   * ⚠️ The inverse half of the ISO pair, keyed by ISO CODE with JP as the VALUE.
   * It is NOT forwarded -- inverting a lookup table to read from the folder buys
   * nothing -- but it IS pinned, so the two halves of one fact cannot drift.
   */
  { name: "ISO_NUMERIC_TO_COUNTRY", after: () => ({ "392": ISO_NUMERIC_TO_COUNTRY["392"] }) },
  { name: "COUNTRY_REGIONS", after: () => COUNTRY_REGIONS.JP },
  { name: "COUNTRY_UN_MEMBER_SINCE", after: () => COUNTRY_UN_MEMBER_SINCE.JP },
  { name: "STATE_ADJACENCY", after: () => STATE_ADJACENCY.JP },
  { name: "JP_ADJACENCY", after: () => STATE_ADJACENCY.JP },
  { name: "FULL_ERA_REGION_BUNDLES", after: () => FULL_ERA_REGION_BUNDLES.JP },
  { name: "REGION_NAME_MAPS", after: () => REGION_NAME_MAPS.JP },
  { name: "NPP_CAPITAL_STATES", after: () => NPP_CAPITAL_STATES.JP },
  { name: "COUNTRY_MAP_REGISTRY", after: () => COUNTRY_MAP_REGISTRY.JP },
  { name: "HAZARD_GROUPS", after: () => HAZARD_GROUPS.JP },
  { name: "CENSUS_BUNDLES", after: () => CENSUS_BUNDLES.JP },
  { name: "CONSCRIPTION_SEED", after: () => CONSCRIPTION_SEED.JP },
  { name: "POPULATION_ANCHOR_BUNDLES", after: () => POPULATION_ANCHOR_BUNDLES.JP },
  { name: "METRIC_PRESET_BUNDLES", after: () => METRIC_PRESET_BUNDLES.JP },
  { name: "INCOME_ANCHORS", after: () => INCOME_ANCHORS.JP },
  { name: "TARGETS", after: () => TARGETS.JP },
  { name: "RAW_BUNDLES", after: () => RAW_BUNDLES.JP },
  { name: "COUNTRY_ERA1991_PATCHES", after: () => COUNTRY_ERA1991_PATCHES.JP },
  {
    name: "NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY",
    after: () => NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY.JP,
  },

  /**
   * ⚠️ METRIC-FIRST, so one row per metric. CORE5_NORMALS is keyed metric ->
   * country and each metric carries a `global` fallback that belongs to every
   * country and must not move. Splitting by metric means a dropped metric fails
   * on a line that names it.
   */
  ...(
    ["gdpGrowth", "unemploymentRate", "lifeExpectancy", "violentCrimeRate", "povertyRate"] as const
  ).map((metric) => ({
    name: "CORE5_NORMALS",
    subKey: metric,
    after: () => CORE5_NORMALS[metric]?.JP,
  })),
];

/**
 * The function-valued registries. The plan names TWO; there are FIVE.
 * REGION_ROSTERS belongs to D5 and is added there.
 */
export const MOVED_THUNK_REGISTRIES: readonly MovedThunkRegistry[] = [
  { name: "SPAWN_ELECTIONS_REGISTRY", after: () => SPAWN_ELECTIONS_REGISTRY.JP },
  /**
   * ⚠️ NOT FORWARDED IN D5, DELIBERATELY. Japan's seven era thunks are
   * `() => import("@/lib/countries/jp/data/jpRegions1953")...` -- they point at the seed
   * modules D6 relocates. Forwarding now would write paths that D6 immediately
   * rewrites, touching the same lines twice for no gain. It is PINNED here so
   * the thunk set cannot change in the meantime, and D6 owns the move.
   */
  { name: "REGION_ROSTERS", after: () => REGION_ROSTERS.JP },
  /**
   * ⚠️ THE THIRD SNAPSHOT KIND, and the one the plan singled out. Its `extras`
   * field is an ARRAY holding a function -- [(db) => checkGovernmentFormation]
   * -- so JSON.stringify writes it as [null] and the only executable part
   * disappears. It first recorded exactly that way here, because the append
   * script's fnKeys still had the array blind spot the correction script had
   * already been fixed for.
   *
   * Pinned in the THUNK table, not the value table: the thunk comparison marks
   * functions instead of serialising them, so the data fields compare by value
   * and the function compares by PATH.
   */
  { name: "COUNTRY_READINESS_EXPECTATIONS", after: () => COUNTRY_READINESS_EXPECTATIONS.JP },
  { name: "COUNTRY_BILL_PHASES", after: () => COUNTRY_BILL_PHASES.JP },
  { name: "COUNTRY_ELECTION_PHASES", after: () => COUNTRY_ELECTION_PHASES.JP },
  { name: "PARLIAMENTARY_CABINET_CONFIGS", after: () => PARLIAMENTARY_CABINET_CONFIGS.JP },
];
