/**
 * Does every registry the United States appears in resolve at runtime, and does
 * it resolve to the FOLDER'S object rather than a second one holding equal
 * values?
 *
 * ⚠ WHY A SEPARATE CHECK, AND NOT A VITEST FILE. Vitest resolves modules through
 * vite, which is not the app's module-init order, so a circular import can pass
 * there and hand back `undefined` in the app. `countries.ts` imports a value
 * from `us/institutionsFacts.ts`, which imports the `CountryConfig` TYPE back
 * from `countries.ts`; type imports are erased so this should hold, but "should"
 * is not evidence and `COUNTRY_CONFIGS.US` is the most load-bearing object in
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
 *   npx tsx scripts/countries/verify-us-runtime.ts
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

import { US_IDENTITY } from "../../src/lib/countries/us/identity";
import { US_ECONOMY } from "../../src/lib/countries/us/economy";
import { US_GEOGRAPHY } from "../../src/lib/countries/us/geography";
import { US_INSTITUTIONS } from "../../src/lib/countries/us/institutions";
import { US_ELECTIONS } from "../../src/lib/countries/us/elections";
import {
  US_CABINET_GROUPS,
  US_CABINET_SEAT_IDS,
  US_CONFIG,
  US_ESTATE_PORTFOLIO,
  US_LEGISLATIVE_PROCESS,
  US_MILITARY_BRANCHES,
  US_MILITARY_SCALE,
  US_ORDERS_OF_BATTLE,
} from "../../src/lib/countries/us/institutionsFacts";
import {
  US_ADJACENCY_MAP,
  US_CONSCRIPTION,
  US_CONTINENT,
  US_ISO_NUMERIC,
  US_MAP_ANCHOR,
  US_MAP_REGISTRY,
  US_MEDIAN_INCOME_THRESHOLDS,
  US_NPP_CAPITAL_STATE,
  US_POPULATION_MULTIPLIERS,
  US_UN_MEMBER_SINCE,
  US_WORLD_REGION,
} from "../../src/lib/countries/us/geographyFacts";
import { CABINET_POSITIONS } from "../../src/lib/countries/us/cabinet/positions";
import { US_MINISTERIAL_ORDERS } from "../../src/lib/countries/us/cabinet/orders";
import { US_CABINET_MECHANICS } from "../../src/lib/countries/us/cabinet/mechanics";

type Check = [label: string, value: unknown];

/** Does the registry resolve to something at all? */
const checks: Check[] = [
  ["COUNTRY_CONFIGS.US", COUNTRY_CONFIGS.US],
  ["NATIONAL_ADDRESS_NAME.US", NATIONAL_ADDRESS_NAME.US],
  ["CABINET_IDENTITY.US", CABINET_IDENTITY.US],
  ["NATIONAL_IDENTITY.US", NATIONAL_IDENTITY.US],
  ["NATIONAL_STATS_IDENTITY.US", NATIONAL_STATS_IDENTITY.US],
  ["TREASURY_TEXT.US", TREASURY_TEXT.US],
  ["ECONOMY_TEXT.US", ECONOMY_TEXT.US],
  ["EXECUTIVE_TEXT.US", EXECUTIVE_TEXT.US],
  ["POLICY_TEXT.US", POLICY_TEXT.US],
  ["EXECUTIVE_SEALS.US", EXECUTIVE_SEALS.US],
  ["EXECUTIVE_SURFACE.US", EXECUTIVE_SURFACE.US],
  ["COUNTRY_HISTORICAL_NAMES.US", COUNTRY_HISTORICAL_NAMES.US],
  ["COUNTRY_MODERN_NAMES.US", COUNTRY_MODERN_NAMES.US],
  ["LEGISLATIVE_PROCESS.US", LEGISLATIVE_PROCESS.US],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.US", ESTATE_PORTFOLIO_BY_COUNTRY.US],
  ["GROUPS.US", GROUPS.US],
  ["ORDERS_BY_COUNTRY.US", ORDERS_BY_COUNTRY.US],
  ["MECHANICS_BY_COUNTRY.US", MECHANICS_BY_COUNTRY.US],
  ["ENERGY_POSITION_BY_COUNTRY.US", ENERGY_POSITION_BY_COUNTRY.US],
  ["INFRA_POSITION_BY_COUNTRY.US", INFRA_POSITION_BY_COUNTRY.US],
  ["DEFENSE_POSITION_BY_COUNTRY.US", DEFENSE_POSITION_BY_COUNTRY.US],
  ["FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.US", FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.US],
  ["TRADE_MINISTER_POSITION_BY_COUNTRY.US", TRADE_MINISTER_POSITION_BY_COUNTRY.US],
  ["MILITARY_BRANCHES_BY_COUNTRY.US", MILITARY_BRANCHES_BY_COUNTRY.US],
  ["MILITARY_COUNTRY_SCALE.US", MILITARY_COUNTRY_SCALE.US],
  ["ORDERS_OF_BATTLE.US", ORDERS_OF_BATTLE.US],
  ["COUNTRY_CURRENCY_MAP.US", COUNTRY_CURRENCY_MAP.US],
  ["ECONOMIC_BASELINES.US", ECONOMIC_BASELINES.US],
  ["MONETARY_BASELINES.US", MONETARY_BASELINES.US],
  ["COUNTRY_SECTOR_WEIGHTS.US", COUNTRY_SECTOR_WEIGHTS.US],
  ["REP_ECON.US", REP_ECON.US],
  ["COST_SCALE_ANCHORS.US", COST_SCALE_ANCHORS.US],
  ["NATIONAL_POLICY_STATE_IDS.US", NATIONAL_POLICY_STATE_IDS.US],
  ["LEGISLATION_COUNTRY_SCOPES.US", LEGISLATION_COUNTRY_SCOPES.US],
  ["TREASURY_PS_RATE_BY_COUNTRY.US", TREASURY_PS_RATE_BY_COUNTRY.US],
  ["PLAYER_PAYOUT_CAP_PER_TURN.US", PLAYER_PAYOUT_CAP_PER_TURN.US],
  ["DEFAULT_STRATEGIC_SECTORS.US", DEFAULT_STRATEGIC_SECTORS.US],
  ["SOVEREIGN_CORP_LEGAL_STRUCTURE.US", SOVEREIGN_CORP_LEGAL_STRUCTURE.US],
  ["NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.US", NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.US],
  ["NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.US", NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.US],
  ["COUNTRY_CONTINENT.US", COUNTRY_CONTINENT.US],
  ["COUNTRY_TO_ISO_NUMERIC.US", COUNTRY_TO_ISO_NUMERIC.US],
  ["COUNTRY_REGIONS.US", COUNTRY_REGIONS.US],
  ["COUNTRY_UN_MEMBER_SINCE.US", COUNTRY_UN_MEMBER_SINCE.US],
  ["NPP_CAPITAL_STATES.US", NPP_CAPITAL_STATES.US],
  ["STATE_ADJACENCY.US", STATE_ADJACENCY.US],
  ["CONSCRIPTION_SEED.US", CONSCRIPTION_SEED.US],
  ["COUNTRY_MAP_REGISTRY.US", COUNTRY_MAP_REGISTRY.US],
  ["COUNTRY_ANCHOR.US", COUNTRY_ANCHOR.US],
  ["MEDIAN_INCOME_THRESHOLDS.US", MEDIAN_INCOME_THRESHOLDS.US],
  ["POPULATION_MULTIPLIERS.US", POPULATION_MULTIPLIERS.US],
  ["CENSUS_BUNDLES.US", CENSUS_BUNDLES.US],
  ["SPAWN_ELECTIONS_REGISTRY.US", SPAWN_ELECTIONS_REGISTRY.US],
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
// number is value equality, so `COUNTRY_CURRENCY_MAP.US === US_ECONOMY.currencyCode`
// is true whether it forwards or holds its own "USD". Listing them here would
// manufacture passes. Only reference types can prove single-definition, so only
// they are here; the scalars are covered by the resolution list above.
// ---------------------------------------------------------------------------
type Same = [label: string, registry: unknown, folder: unknown];
const sameObject: Same[] = [
  ["COUNTRY_CONFIGS.US", COUNTRY_CONFIGS.US, US_CONFIG],
  ["COUNTRY_CONFIGS.US (via institutions)", COUNTRY_CONFIGS.US, US_INSTITUTIONS.config],
  ["CABINET_IDENTITY.US", CABINET_IDENTITY.US, US_IDENTITY.cabinet],
  ["NATIONAL_IDENTITY.US", NATIONAL_IDENTITY.US, US_IDENTITY.national],
  ["NATIONAL_STATS_IDENTITY.US", NATIONAL_STATS_IDENTITY.US, US_IDENTITY.stats],
  ["TREASURY_TEXT.US", TREASURY_TEXT.US, US_IDENTITY.treasuryText],
  ["ECONOMY_TEXT.US", ECONOMY_TEXT.US, US_IDENTITY.economyText],
  ["EXECUTIVE_TEXT.US", EXECUTIVE_TEXT.US, US_IDENTITY.executiveText],
  ["POLICY_TEXT.US", POLICY_TEXT.US, US_IDENTITY.policyText],
  ["EXECUTIVE_SEALS.US", EXECUTIVE_SEALS.US, US_IDENTITY.executiveSeal],
  ["EXECUTIVE_SURFACE.US", EXECUTIVE_SURFACE.US, US_IDENTITY.executiveSurface],
  ["COUNTRY_HISTORICAL_NAMES.US", COUNTRY_HISTORICAL_NAMES.US, US_IDENTITY.historicalNames],
  ["COUNTRY_MODERN_NAMES.US", COUNTRY_MODERN_NAMES.US, US_IDENTITY.modernNames],
  ["LEGISLATIVE_PROCESS.US", LEGISLATIVE_PROCESS.US, US_LEGISLATIVE_PROCESS],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.US", ESTATE_PORTFOLIO_BY_COUNTRY.US, US_ESTATE_PORTFOLIO],
  ["GROUPS.US", GROUPS.US, US_CABINET_GROUPS],
  ["ORDERS_BY_COUNTRY.US", ORDERS_BY_COUNTRY.US, US_MINISTERIAL_ORDERS],
  ["MECHANICS_BY_COUNTRY.US", MECHANICS_BY_COUNTRY.US, US_CABINET_MECHANICS],
  ["MILITARY_BRANCHES_BY_COUNTRY.US", MILITARY_BRANCHES_BY_COUNTRY.US, US_MILITARY_BRANCHES],
  ["ORDERS_OF_BATTLE.US", ORDERS_OF_BATTLE.US, US_ORDERS_OF_BATTLE],
  ["ECONOMIC_BASELINES.US", ECONOMIC_BASELINES.US, US_ECONOMY.economicBaseline],
  ["MONETARY_BASELINES.US", MONETARY_BASELINES.US, US_ECONOMY.monetary.baseline],
  ["COUNTRY_SECTOR_WEIGHTS.US", COUNTRY_SECTOR_WEIGHTS.US, US_ECONOMY.sectorWeights.base],
  ["REP_ECON.US", REP_ECON.US, US_ECONOMY.repEcon],
  ["COST_SCALE_ANCHORS.US", COST_SCALE_ANCHORS.US, US_ECONOMY.costScaleAnchors],
  ["TREASURY_PS_RATE_BY_COUNTRY.US", TREASURY_PS_RATE_BY_COUNTRY.US, US_ECONOMY.tax.treasuryPsRate],
  ["DEFAULT_STRATEGIC_SECTORS.US", DEFAULT_STRATEGIC_SECTORS.US, US_ECONOMY.strategicSectors],
  ["STATE_ADJACENCY.US", STATE_ADJACENCY.US, US_ADJACENCY_MAP],
  ["STATE_ADJACENCY.US (via geography)", STATE_ADJACENCY.US, US_GEOGRAPHY.adjacency],
  ["CONSCRIPTION_SEED.US", CONSCRIPTION_SEED.US, US_CONSCRIPTION],
  ["COUNTRY_MAP_REGISTRY.US", COUNTRY_MAP_REGISTRY.US, US_MAP_REGISTRY],
  ["COUNTRY_ANCHOR.US", COUNTRY_ANCHOR.US, US_MAP_ANCHOR],
  ["MEDIAN_INCOME_THRESHOLDS.US", MEDIAN_INCOME_THRESHOLDS.US, US_MEDIAN_INCOME_THRESHOLDS],
  ["POPULATION_MULTIPLIERS.US", POPULATION_MULTIPLIERS.US, US_POPULATION_MULTIPLIERS],
  ["CENSUS_BUNDLES.US", CENSUS_BUNDLES.US, US_GEOGRAPHY.censusBundles],
  ["SPAWN_ELECTIONS_REGISTRY.US", SPAWN_ELECTIONS_REGISTRY.US, US_ELECTIONS.spawn],
  ["cabinet positions reachable", US_INSTITUTIONS.cabinet.positions, CABINET_POSITIONS],
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
  ["COUNTRY_CURRENCY_MAP.US", COUNTRY_CURRENCY_MAP.US, US_ECONOMY.currencyCode],
  ["NATIONAL_POLICY_STATE_IDS.US", NATIONAL_POLICY_STATE_IDS.US, US_ECONOMY.nationalPolicyStateId],
  ["LEGISLATION_COUNTRY_SCOPES.US", LEGISLATION_COUNTRY_SCOPES.US, US_ECONOMY.legislationScope],
  ["PLAYER_PAYOUT_CAP_PER_TURN.US", PLAYER_PAYOUT_CAP_PER_TURN.US, US_ECONOMY.payoutCapPerTurn],
  [
    "SOVEREIGN_CORP_LEGAL_STRUCTURE.US",
    SOVEREIGN_CORP_LEGAL_STRUCTURE.US,
    US_ECONOMY.sovereignCorpLegalStructure,
  ],
  [
    "NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.US",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.US,
    US_ECONOMY.tax.neutralFederalSalesTax,
  ],
  [
    "NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.US",
    NEUTRAL_STATE_SALES_TAX_BY_COUNTRY.US,
    US_ECONOMY.tax.neutralStateSalesTax,
  ],
  ["MILITARY_COUNTRY_SCALE.US", MILITARY_COUNTRY_SCALE.US, US_MILITARY_SCALE],
  ["ENERGY_POSITION_BY_COUNTRY.US", ENERGY_POSITION_BY_COUNTRY.US, US_CABINET_SEAT_IDS.energy],
  [
    "INFRA_POSITION_BY_COUNTRY.US",
    INFRA_POSITION_BY_COUNTRY.US,
    US_CABINET_SEAT_IDS.infrastructure,
  ],
  ["DEFENSE_POSITION_BY_COUNTRY.US", DEFENSE_POSITION_BY_COUNTRY.US, US_CABINET_SEAT_IDS.defense],
  [
    "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.US",
    FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.US,
    US_CABINET_SEAT_IDS.foreignAffairs,
  ],
  [
    "TRADE_MINISTER_POSITION_BY_COUNTRY.US",
    TRADE_MINISTER_POSITION_BY_COUNTRY.US,
    US_CABINET_SEAT_IDS.tradeMinister,
  ],
  ["COUNTRY_CONTINENT.US", COUNTRY_CONTINENT.US, US_CONTINENT],
  ["COUNTRY_TO_ISO_NUMERIC.US", COUNTRY_TO_ISO_NUMERIC.US, US_ISO_NUMERIC],
  ["COUNTRY_REGIONS.US", COUNTRY_REGIONS.US, US_WORLD_REGION],
  ["COUNTRY_UN_MEMBER_SINCE.US", COUNTRY_UN_MEMBER_SINCE.US, US_UN_MEMBER_SINCE],
  ["NPP_CAPITAL_STATES.US", NPP_CAPITAL_STATES.US, US_NPP_CAPITAL_STATE],
  ["NATIONAL_ADDRESS_NAME.US", NATIONAL_ADDRESS_NAME.US, US_IDENTITY.addressNames.national],
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
if (failed === 0) console.log("Every US registry resolves, forwards, and matches.");
process.exitCode = failed === 0 ? 0 : 1;
