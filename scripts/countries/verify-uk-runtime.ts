/**
 * Does every registry the United Kingdom appears in resolve at runtime, and does
 * it resolve to the FOLDER'S object rather than a second one holding equal
 * values?
 *
 * ⚠ WHY A SEPARATE CHECK, AND NOT A VITEST FILE. Vitest resolves modules through
 * vite, which is not the app's module-init order, so a circular import can pass
 * there and hand back `undefined` in the app. `countries.ts` imports a value
 * from `uk/institutionsFacts.ts`, which imports the `CountryConfig` TYPE back
 * from `countries.ts`; type imports are erased so this should hold, but "should"
 * is not evidence and `COUNTRY_CONFIGS.UK` is the most load-bearing object in
 * the game. If it silently became undefined, typecheck, lint and most unit tests
 * would still pass.
 *
 * ⚠ THE `===` BLOCK IS THE ONE THE REST CANNOT REPLACE. Everything in the first
 * list asks whether a registry RESOLVES. None of it asks whether it resolves to
 * the folder's object or to a copy with the same values. Deep equality passes
 * either way, which is exactly how a forwarder quietly becomes a copy: correct
 * on the day it is made, silently divergent after the first edit to one side.
 * Japan's chamber seat tables sat in that state through a completed phase.
 *
 *   npx tsx scripts/countries/verify-uk-runtime.ts
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

import { UK_IDENTITY } from "../../src/lib/countries/uk/identity";
import { UK_ECONOMY } from "../../src/lib/countries/uk/economy";
import { UK_GEOGRAPHY } from "../../src/lib/countries/uk/geography";
import { UK_INSTITUTIONS } from "../../src/lib/countries/uk/institutions";
import { UK_ELECTIONS } from "../../src/lib/countries/uk/elections";
import {
  UK_CABINET_GROUPS,
  UK_CABINET_SEAT_IDS,
  UK_CONFIG,
  UK_ESTATE_PORTFOLIO,
  UK_LEGISLATIVE_PROCESS,
  UK_MILITARY_BRANCHES,
  UK_MILITARY_SCALE,
  UK_ORDERS_OF_BATTLE,
} from "../../src/lib/countries/uk/institutionsFacts";
import {
  UK_ADJACENCY_MAP,
  UK_CONSCRIPTION,
  UK_CONTINENT,
  UK_ISO_NUMERIC,
  UK_MAP_ANCHOR,
  UK_MAP_REGISTRY,
  UK_MEDIAN_INCOME_THRESHOLDS,
  UK_NPP_CAPITAL_STATE,
  UK_POPULATION_MULTIPLIERS,
  UK_UN_MEMBER_SINCE,
  UK_WORLD_REGION,
} from "../../src/lib/countries/uk/geographyFacts";
import { UK_CABINET_POSITIONS } from "@/lib/constants/ukCabinet";
import { UK_MINISTERIAL_ORDERS } from "../../src/lib/constants/ukCabinetOrders";
import { UK_CABINET_MECHANICS } from "../../src/lib/constants/ukCabinetMechanics";

type Check = [label: string, value: unknown];

/** Does the registry resolve to something at all? */
const checks: Check[] = [
  ["COUNTRY_CONFIGS.UK", COUNTRY_CONFIGS.UK],
  ["NATIONAL_ADDRESS_NAME.UK", NATIONAL_ADDRESS_NAME.UK],
  ["CABINET_IDENTITY.UK", CABINET_IDENTITY.UK],
  ["NATIONAL_IDENTITY.UK", NATIONAL_IDENTITY.UK],
  ["NATIONAL_STATS_IDENTITY.UK", NATIONAL_STATS_IDENTITY.UK],
  ["TREASURY_TEXT.UK", TREASURY_TEXT.UK],
  ["ECONOMY_TEXT.UK", ECONOMY_TEXT.UK],
  ["EXECUTIVE_TEXT.UK", EXECUTIVE_TEXT.UK],
  ["POLICY_TEXT.UK", POLICY_TEXT.UK],
  ["EXECUTIVE_SEALS.UK", EXECUTIVE_SEALS.UK],
  ["EXECUTIVE_SURFACE.UK", EXECUTIVE_SURFACE.UK],
  ["COUNTRY_HISTORICAL_NAMES.UK", COUNTRY_HISTORICAL_NAMES.UK],
  ["COUNTRY_MODERN_NAMES.UK", COUNTRY_MODERN_NAMES.UK],
  ["LEGISLATIVE_PROCESS.UK", LEGISLATIVE_PROCESS.UK],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.UK", ESTATE_PORTFOLIO_BY_COUNTRY.UK],
  ["GROUPS.UK", GROUPS.UK],
  ["ORDERS_BY_COUNTRY.UK", ORDERS_BY_COUNTRY.UK],
  ["MECHANICS_BY_COUNTRY.UK", MECHANICS_BY_COUNTRY.UK],
  ["ENERGY_POSITION_BY_COUNTRY.UK", ENERGY_POSITION_BY_COUNTRY.UK],
  ["INFRA_POSITION_BY_COUNTRY.UK", INFRA_POSITION_BY_COUNTRY.UK],
  ["DEFENSE_POSITION_BY_COUNTRY.UK", DEFENSE_POSITION_BY_COUNTRY.UK],
  ["FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.UK", FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.UK],
  ["TRADE_MINISTER_POSITION_BY_COUNTRY.UK", TRADE_MINISTER_POSITION_BY_COUNTRY.UK],
  ["MILITARY_BRANCHES_BY_COUNTRY.UK", MILITARY_BRANCHES_BY_COUNTRY.UK],
  ["MILITARY_COUNTRY_SCALE.UK", MILITARY_COUNTRY_SCALE.UK],
  ["ORDERS_OF_BATTLE.UK", ORDERS_OF_BATTLE.UK],
  ["COUNTRY_CURRENCY_MAP.UK", COUNTRY_CURRENCY_MAP.UK],
  ["ECONOMIC_BASELINES.UK", ECONOMIC_BASELINES.UK],
  ["MONETARY_BASELINES.UK", MONETARY_BASELINES.UK],
  ["COUNTRY_SECTOR_WEIGHTS.UK", COUNTRY_SECTOR_WEIGHTS.UK],
  ["REP_ECON.UK", REP_ECON.UK],
  ["COST_SCALE_ANCHORS.UK", COST_SCALE_ANCHORS.UK],
  ["NATIONAL_POLICY_STATE_IDS.UK", NATIONAL_POLICY_STATE_IDS.UK],
  ["LEGISLATION_COUNTRY_SCOPES.UK", LEGISLATION_COUNTRY_SCOPES.UK],
  ["TREASURY_PS_RATE_BY_COUNTRY.UK", TREASURY_PS_RATE_BY_COUNTRY.UK],
  ["PLAYER_PAYOUT_CAP_PER_TURN.UK", PLAYER_PAYOUT_CAP_PER_TURN.UK],
  ["DEFAULT_STRATEGIC_SECTORS.UK", DEFAULT_STRATEGIC_SECTORS.UK],
  ["SOVEREIGN_CORP_LEGAL_STRUCTURE.UK", SOVEREIGN_CORP_LEGAL_STRUCTURE.UK],
  ["NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.UK", NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.UK],
  ["NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.UK", NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.UK],
  ["COUNTRY_CONTINENT.UK", COUNTRY_CONTINENT.UK],
  ["COUNTRY_TO_ISO_NUMERIC.UK", COUNTRY_TO_ISO_NUMERIC.UK],
  ["COUNTRY_REGIONS.UK", COUNTRY_REGIONS.UK],
  ["COUNTRY_UN_MEMBER_SINCE.UK", COUNTRY_UN_MEMBER_SINCE.UK],
  ["NPP_CAPITAL_STATES.UK", NPP_CAPITAL_STATES.UK],
  ["STATE_ADJACENCY.UK", STATE_ADJACENCY.UK],
  ["CONSCRIPTION_SEED.UK", CONSCRIPTION_SEED.UK],
  ["COUNTRY_MAP_REGISTRY.UK", COUNTRY_MAP_REGISTRY.UK],
  ["COUNTRY_ANCHOR.UK", COUNTRY_ANCHOR.UK],
  ["MEDIAN_INCOME_THRESHOLDS.UK", MEDIAN_INCOME_THRESHOLDS.UK],
  ["POPULATION_MULTIPLIERS.UK", POPULATION_MULTIPLIERS.UK],
  ["CENSUS_BUNDLES.UK", CENSUS_BUNDLES.UK],
  ["SPAWN_ELECTIONS_REGISTRY.UK", SPAWN_ELECTIONS_REGISTRY.UK],
];

let failed = 0;
for (const [name, value] of checks) {
  const empty =
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && value !== null && Object.keys(value).length === 0);
  if (empty) {
    console.log(`FAIL  ${name} -> ${JSON.stringify(value)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// IS THERE EXACTLY ONE COPY?
//
// ⚠ SCALARS ARE EXCLUDED FROM THIS LIST ON PURPOSE. `===` on a string or a
// number is value equality, so `COUNTRY_CURRENCY_MAP.UK === UK_ECONOMY.currencyCode`
// is true whether it forwards or holds its own "USD". Listing them here would
// manufacture passes. Only reference types can prove single-definition, so only
// they are here; the scalars are covered by the resolution list above.
// ---------------------------------------------------------------------------
type Same = [label: string, registry: unknown, folder: unknown];
const sameObject: Same[] = [
  ["COUNTRY_CONFIGS.UK", COUNTRY_CONFIGS.UK, UK_CONFIG],
  ["COUNTRY_CONFIGS.UK (via institutions)", COUNTRY_CONFIGS.UK, UK_INSTITUTIONS.config],
  ["CABINET_IDENTITY.UK", CABINET_IDENTITY.UK, UK_IDENTITY.cabinet],
  ["NATIONAL_IDENTITY.UK", NATIONAL_IDENTITY.UK, UK_IDENTITY.national],
  ["NATIONAL_STATS_IDENTITY.UK", NATIONAL_STATS_IDENTITY.UK, UK_IDENTITY.stats],
  ["TREASURY_TEXT.UK", TREASURY_TEXT.UK, UK_IDENTITY.treasuryText],
  ["ECONOMY_TEXT.UK", ECONOMY_TEXT.UK, UK_IDENTITY.economyText],
  ["EXECUTIVE_TEXT.UK", EXECUTIVE_TEXT.UK, UK_IDENTITY.executiveText],
  ["POLICY_TEXT.UK", POLICY_TEXT.UK, UK_IDENTITY.policyText],
  ["EXECUTIVE_SEALS.UK", EXECUTIVE_SEALS.UK, UK_IDENTITY.executiveSeal],
  ["EXECUTIVE_SURFACE.UK", EXECUTIVE_SURFACE.UK, UK_IDENTITY.executiveSurface],
  ["COUNTRY_HISTORICAL_NAMES.UK", COUNTRY_HISTORICAL_NAMES.UK, UK_IDENTITY.historicalNames],
  ["COUNTRY_MODERN_NAMES.UK", COUNTRY_MODERN_NAMES.UK, UK_IDENTITY.modernNames],
  ["LEGISLATIVE_PROCESS.UK", LEGISLATIVE_PROCESS.UK, UK_LEGISLATIVE_PROCESS],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.UK", ESTATE_PORTFOLIO_BY_COUNTRY.UK, UK_ESTATE_PORTFOLIO],
  ["GROUPS.UK", GROUPS.UK, UK_CABINET_GROUPS],
  ["ORDERS_BY_COUNTRY.UK", ORDERS_BY_COUNTRY.UK, UK_MINISTERIAL_ORDERS],
  ["MECHANICS_BY_COUNTRY.UK", MECHANICS_BY_COUNTRY.UK, UK_CABINET_MECHANICS],
  ["MILITARY_BRANCHES_BY_COUNTRY.UK", MILITARY_BRANCHES_BY_COUNTRY.UK, UK_MILITARY_BRANCHES],
  ["ORDERS_OF_BATTLE.UK", ORDERS_OF_BATTLE.UK, UK_ORDERS_OF_BATTLE],
  ["ECONOMIC_BASELINES.UK", ECONOMIC_BASELINES.UK, UK_ECONOMY.economicBaseline],
  ["MONETARY_BASELINES.UK", MONETARY_BASELINES.UK, UK_ECONOMY.monetary.baseline],
  ["COUNTRY_SECTOR_WEIGHTS.UK", COUNTRY_SECTOR_WEIGHTS.UK, UK_ECONOMY.sectorWeights.base],
  ["REP_ECON.UK", REP_ECON.UK, UK_ECONOMY.repEcon],
  ["COST_SCALE_ANCHORS.UK", COST_SCALE_ANCHORS.UK, UK_ECONOMY.costScaleAnchors],
  ["TREASURY_PS_RATE_BY_COUNTRY.UK", TREASURY_PS_RATE_BY_COUNTRY.UK, UK_ECONOMY.tax.treasuryPsRate],
  ["DEFAULT_STRATEGIC_SECTORS.UK", DEFAULT_STRATEGIC_SECTORS.UK, UK_ECONOMY.strategicSectors],
  ["STATE_ADJACENCY.UK", STATE_ADJACENCY.UK, UK_ADJACENCY_MAP],
  ["STATE_ADJACENCY.UK (via geography)", STATE_ADJACENCY.UK, UK_GEOGRAPHY.adjacency],
  ["CONSCRIPTION_SEED.UK", CONSCRIPTION_SEED.UK, UK_CONSCRIPTION],
  ["COUNTRY_MAP_REGISTRY.UK", COUNTRY_MAP_REGISTRY.UK, UK_MAP_REGISTRY],
  ["COUNTRY_ANCHOR.UK", COUNTRY_ANCHOR.UK, UK_MAP_ANCHOR],
  ["MEDIAN_INCOME_THRESHOLDS.UK", MEDIAN_INCOME_THRESHOLDS.UK, UK_MEDIAN_INCOME_THRESHOLDS],
  ["POPULATION_MULTIPLIERS.UK", POPULATION_MULTIPLIERS.UK, UK_POPULATION_MULTIPLIERS],
  ["CENSUS_BUNDLES.UK", CENSUS_BUNDLES.UK, UK_GEOGRAPHY.censusBundles],
  ["SPAWN_ELECTIONS_REGISTRY.UK", SPAWN_ELECTIONS_REGISTRY.UK, UK_ELECTIONS.spawn],
  ["cabinet positions reachable", UK_INSTITUTIONS.cabinet.positions, UK_CABINET_POSITIONS],
];

let copies = 0;
for (const [label, registry, folder] of sameObject) {
  if (registry === undefined || folder === undefined) {
    const which = registry === undefined ? "registry" : "folder";
    console.log(`FAIL  ${label} -> ${which} side is undefined`);
    copies++;
    failed++;
  } else if (registry !== folder) {
    console.log(
      `FAIL  ${label} is a SECOND COPY: equal values, different object. It does not forward.`
    );
    copies++;
    failed++;
  }
}

/**
 * Scalars, checked by VALUE because that is all `===` can mean for them.
 *
 * ⚠ THIS PROVES FAITHFULNESS, NOT SINGLE-DEFINITION. A registry holding its own
 * `"USD"` passes here exactly as a forwarder does. It is worth checking anyway:
 * a wrong scalar is a real defect, and the resolution list above would not catch
 * a value that resolves but is simply not this country's.
 */
const scalars: Same[] = [
  ["COUNTRY_CURRENCY_MAP.UK", COUNTRY_CURRENCY_MAP.UK, UK_ECONOMY.currencyCode],
  ["NATIONAL_POLICY_STATE_IDS.UK", NATIONAL_POLICY_STATE_IDS.UK, UK_ECONOMY.nationalPolicyStateId],
  ["LEGISLATION_COUNTRY_SCOPES.UK", LEGISLATION_COUNTRY_SCOPES.UK, UK_ECONOMY.legislationScope],
  ["PLAYER_PAYOUT_CAP_PER_TURN.UK", PLAYER_PAYOUT_CAP_PER_TURN.UK, UK_ECONOMY.payoutCapPerTurn],
  [
    "SOVEREIGN_CORP_LEGAL_STRUCTURE.UK",
    SOVEREIGN_CORP_LEGAL_STRUCTURE.UK,
    UK_ECONOMY.sovereignCorpLegalStructure,
  ],
  [
    "NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.UK",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.UK,
    UK_ECONOMY.tax.neutralFederalSalesTax,
  ],
  [
    "NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.UK",
    NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.UK,
    UK_ECONOMY.tax.neutralStateSalesTax,
  ],
  ["MILITARY_COUNTRY_SCALE.UK", MILITARY_COUNTRY_SCALE.UK, UK_MILITARY_SCALE],
  ["ENERGY_POSITION_BY_COUNTRY.UK", ENERGY_POSITION_BY_COUNTRY.UK, UK_CABINET_SEAT_IDS.energy],
  [
    "INFRA_POSITION_BY_COUNTRY.UK",
    INFRA_POSITION_BY_COUNTRY.UK,
    UK_CABINET_SEAT_IDS.infrastructure,
  ],
  ["DEFENSE_POSITION_BY_COUNTRY.UK", DEFENSE_POSITION_BY_COUNTRY.UK, UK_CABINET_SEAT_IDS.defense],
  [
    "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.UK",
    FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.UK,
    UK_CABINET_SEAT_IDS.foreignAffairs,
  ],
  [
    "TRADE_MINISTER_POSITION_BY_COUNTRY.UK",
    TRADE_MINISTER_POSITION_BY_COUNTRY.UK,
    UK_CABINET_SEAT_IDS.tradeMinister,
  ],
  ["COUNTRY_CONTINENT.UK", COUNTRY_CONTINENT.UK, UK_CONTINENT],
  ["COUNTRY_TO_ISO_NUMERIC.UK", COUNTRY_TO_ISO_NUMERIC.UK, UK_ISO_NUMERIC],
  ["COUNTRY_REGIONS.UK", COUNTRY_REGIONS.UK, UK_WORLD_REGION],
  ["COUNTRY_UN_MEMBER_SINCE.UK", COUNTRY_UN_MEMBER_SINCE.UK, UK_UN_MEMBER_SINCE],
  ["NPP_CAPITAL_STATES.UK", NPP_CAPITAL_STATES.UK, UK_NPP_CAPITAL_STATE],
  ["NATIONAL_ADDRESS_NAME.UK", NATIONAL_ADDRESS_NAME.UK, UK_IDENTITY.addressNames.national],
];

let wrongScalars = 0;
for (const [label, registry, folder] of scalars) {
  if (registry !== folder) {
    console.log(
      `FAIL  ${label} value differs: registry ${String(registry)} vs folder ${String(folder)}`
    );
    wrongScalars++;
    failed++;
  }
}

console.log(`\n${checks.length} registries checked for resolution, ${failed ? "" : "0 "}failures.`);
console.log(`${sameObject.length} forwarders checked for identity, ${copies} holding a copy.`);
console.log(`${scalars.length} scalars checked by value, ${wrongScalars} differing.`);
if (failed === 0) console.log("Every UK registry resolves, forwards, and matches.");
process.exitCode = failed === 0 ? 0 : 1;
