/**
 * Verifies every forwarded registry actually RESOLVES at runtime.
 *
 * ⚠️ WHY A SEPARATE CHECK. A circular import typechecks perfectly and hands back
 * `undefined` at module-init time. `countries.ts` now imports a value from
 * `jp/institutions.ts`, which imports the `CountryConfig` TYPE back from
 * `countries.ts`; type imports are erased, so this should hold -- but "should"
 * is not evidence, and COUNTRY_CONFIGS.JP is the most load-bearing object in the
 * game. If it silently became undefined, typecheck, lint and most unit tests
 * would all still pass.
 *
 * This is deliberately NOT a vitest file: vitest resolves modules through vite,
 * so it would not exercise the same resolution order the app uses.
 *
 *   npx tsx scripts/countries/verify-jp-runtime.ts
 */
import {
  COUNTRY_CONFIGS,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "../../src/lib/constants/countries";
import { ENERGY_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetEnergy";
import { INFRA_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetInfra";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "../../src/lib/constants/cabinetEstates";
import { GROUPS } from "../../src/lib/constants/cabinetPositionGroups";
import { ORDERS_BY_COUNTRY } from "../../src/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "../../src/lib/constants/cabinetMechanics";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
} from "../../src/lib/constants/military";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "../../src/lib/constants/internationalOrganizations";
import { LEGISLATIVE_PROCESS } from "../../src/lib/legislature/process";
import {
  ORDERS_OF_BATTLE,
  ORDERS_OF_BATTLE_BY_ERA,
} from "../../src/lib/seeds/reference/ordersOfBattle";
import { COUNTRY_ELECTION_PHASES, COUNTRY_BILL_PHASES } from "../../src/lib/turn/countryPhases";
import { SPAWN_ELECTIONS_REGISTRY } from "../../src/lib/turn/perpetualElections/registry";
import { CABINET_IDENTITY } from "../../src/lib/constants/cabinetIdentity";
import { NATIONAL_IDENTITY } from "../../src/lib/constants/nationalIdentity";
import { TREASURY_IDENTITY } from "../../src/lib/constants/treasuryIdentity";
import {
  COUNTRY_CURRENCY_MAP,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
} from "../../src/lib/constants/currencies";
import { COST_SCALE_ANCHORS } from "../../src/lib/budget/costs";
import { REP_ECON } from "../../src/lib/era/legislationCostCatalog";
import { COUNTRY_SECTOR_WEIGHTS } from "../../src/lib/seeds/reference/sectorSeedWeights";
import { NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY } from "../../src/lib/turn/gdpGrowth";
import { PLAYER_PAYOUT_CAP_PER_TURN } from "../../src/lib/treasury/payoutCapValues";
import { INITIAL_RATES } from "../../src/lib/constants/currencies";
import { COUNTRY_CONTINENT } from "../../src/lib/constants/countryContinents";
import { COUNTRY_TO_ISO_NUMERIC, ISO_NUMERIC_TO_COUNTRY } from "../../src/lib/constants/countryIso";
import { COUNTRY_REGIONS } from "../../src/lib/world/worldEntityManifest";
import { STATE_ADJACENCY } from "../../src/lib/constants/stateAdjacency";
import { CENSUS_BUNDLES } from "../../src/lib/seeds/regionCensusData";
import { RAW_BUNDLES } from "../../src/lib/states/conditions/seedMetricsLoader";
import { METRIC_PRESET_BUNDLES } from "../../src/lib/seeds/metricPresets";
import { CORE5_NORMALS } from "../../src/lib/era/metricCatalog";
import { REGION_ROSTERS } from "../../src/lib/demographics/substrateCoverage";
import { SHIPPING_PRESETS } from "../../src/lib/world/eraRoster";
import { CONSCRIPTION_SEED } from "../../src/lib/demographics/conscription";

type Check = [name: string, value: unknown, expectation?: (v: never) => boolean];

import { DOMAIN_BUCKET_AFFINITIES } from "../../src/lib/bucketAffinities";
import { UNION_NAMES_BY_ERA } from "../../src/lib/seeds/reference/unionNames";
import { COUNTRY_MODIFIER_PATCHES } from "../../src/lib/states/conditions/countryPatches";
import { COUNTRY_BUCKET_LABELS } from "../../src/lib/demographics/bucketLabelsByCountry";
import { COUNTRY_SECTOR_WEIGHTS_1953 } from "../../src/lib/seeds/reference/sectorSeedWeights1953";
import { MAJOR_DEFAULT_PARTIES } from "../../src/lib/seeds/defaultPartyTiers";
import { COUNTRY_READINESS_EXPECTATIONS } from "../../src/lib/constants/countryReadinessExpectations";
import { METRIC_ERA_WINDOWS, METRIC_BAND_CURVES } from "../../src/lib/era/metricCatalog";
import { MEDIAN_INCOME_THRESHOLDS } from "../../src/lib/utils/metricScoring";
import { COUNTRY_ANCHOR } from "../../src/lib/maps/countryAnchors";
import { COUNTRY_COMMAND_FLAVOR } from "../../src/lib/military/theaters";
import { GDP_DENOMINATION_1953 } from "../../src/lib/seeds/reference/gdpDenomination";

// ---- The folder itself, for the identity checks at the tail. ----
import { JP_IDENTITY } from "../../src/lib/countries/jp/identity";
import { JP_ECONOMY } from "../../src/lib/countries/jp/economy";
import { JP_GEOGRAPHY } from "../../src/lib/countries/jp/geography";
import { JP_INSTITUTIONS } from "../../src/lib/countries/jp/institutions";
import { JP_ELECTIONS } from "../../src/lib/countries/jp/elections";
import { JP_ERAS } from "../../src/lib/countries/jp/eras";
import {
  JP_CABINET_SEAT_IDS,
  JP_CONFIG,
  JP_ESTATE_PORTFOLIO,
  JP_LEGISLATIVE_PROCESS,
  JP_MILITARY_BRANCHES,
} from "../../src/lib/countries/jp/institutionsFacts";
import {
  JP_ADJACENCY_MAP,
  JP_CONTINENT,
  JP_CORE5_NORMALS,
  JP_ISO_NUMERIC,
  JP_MAP_ANCHOR,
} from "../../src/lib/countries/jp/geographyFacts";
import { JP_CABINET_POSITIONS } from "../../src/lib/countries/jp/cabinet/positions";
import { JP_MINISTERIAL_ORDERS } from "../../src/lib/countries/jp/cabinet/orders";
import { JP_CABINET_MECHANICS } from "../../src/lib/countries/jp/cabinet/mechanics";
import { JP_DOMAIN_BUCKET_AFFINITIES } from "../../src/lib/countries/jp/data/jpBucketAffinities";
import { JP_BUCKET_LABELS } from "../../src/lib/countries/jp/data/jpBucketLabels";
import { JP_MODIFIER_PATCHES } from "../../src/lib/countries/jp/data/jpModifierPatches";
import { JP_PARTY_TIERS } from "../../src/lib/countries/jp/data/jpPartyTiers";
import { JP_READINESS_EXPECTATIONS } from "../../src/lib/countries/jp/data/jpReadinessExpectations";
import { JP_SECTOR_WEIGHTS_1953 } from "../../src/lib/countries/jp/data/jpSectorWeights1953";
import {
  JP_UNION_NAMES_1953,
  JP_UNION_NAMES_MODERN,
} from "../../src/lib/countries/jp/data/jpUnionNames";

const checks: Check[] = [
  // ---- D7: registries whose Japan payload moved in the final sweep. ----
  // Each was a literal block until D7 step 4 and is now a forwarder, so each
  // has a NEW chance to resolve to undefined at module-init time.
  ["DOMAIN_BUCKET_AFFINITIES.JP", DOMAIN_BUCKET_AFFINITIES.JP],
  ["DOMAIN_BUCKET_AFFINITIES.JP.education", DOMAIN_BUCKET_AFFINITIES.JP?.education],
  ["UNION_NAMES_BY_ERA.2019.JP", UNION_NAMES_BY_ERA["2019"]?.JP],
  ["UNION_NAMES_BY_ERA.1953.JP", UNION_NAMES_BY_ERA["1953"]?.JP],
  ["COUNTRY_MODIFIER_PATCHES.JP", COUNTRY_MODIFIER_PATCHES.JP],
  ["COUNTRY_BUCKET_LABELS.JP", COUNTRY_BUCKET_LABELS.JP],
  ["COUNTRY_BUCKET_LABELS.JP.dims", COUNTRY_BUCKET_LABELS.JP?.dims],
  ["COUNTRY_SECTOR_WEIGHTS_1953.JP", COUNTRY_SECTOR_WEIGHTS_1953.JP],
  ["MAJOR_DEFAULT_PARTIES.JP", MAJOR_DEFAULT_PARTIES.JP],
  ["COUNTRY_READINESS_EXPECTATIONS.JP", COUNTRY_READINESS_EXPECTATIONS.JP],
  ["COUNTRY_READINESS_EXPECTATIONS.JP.extras", COUNTRY_READINESS_EXPECTATIONS.JP?.extras],
  ["METRIC_ERA_WINDOWS.nuclearSafety.JP", METRIC_ERA_WINDOWS.nuclearSafety?.countryOverrides?.JP],
  ["MEDIAN_INCOME_THRESHOLDS.JP", MEDIAN_INCOME_THRESHOLDS.JP],
  ["COUNTRY_ANCHOR.JP", COUNTRY_ANCHOR.JP],
  ["COUNTRY_COMMAND_FLAVOR.JP", COUNTRY_COMMAND_FLAVOR.JP],
  ["GDP_DENOMINATION_1953.JP", GDP_DENOMINATION_1953.JP],
  ["COUNTRY_CONFIGS.JP", COUNTRY_CONFIGS.JP],
  [
    "COUNTRY_CONFIGS.JP.legislature.lowerChamber.seats",
    COUNTRY_CONFIGS.JP?.legislature?.lowerChamber?.seats,
  ],
  ["ERA_COUNTRY_CONFIG_OVERRIDES.1953.JP", ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"]?.JP],
  ["ERA_COUNTRY_CONFIG_OVERRIDES.1991.JP", ERA_COUNTRY_CONFIG_OVERRIDES["1991-default"]?.JP],
  ["REGIONAL_BILL_ASSENT_OFFICE_KEY.JP", REGIONAL_BILL_ASSENT_OFFICE_KEY.JP],
  ["ENERGY_POSITION_BY_COUNTRY.JP", ENERGY_POSITION_BY_COUNTRY.JP],
  ["INFRA_POSITION_BY_COUNTRY.JP", INFRA_POSITION_BY_COUNTRY.JP],
  ["DEFENSE_POSITION_BY_COUNTRY.JP", DEFENSE_POSITION_BY_COUNTRY.JP],
  ["FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.JP", FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.JP],
  ["TRADE_MINISTER_POSITION_BY_COUNTRY.JP", TRADE_MINISTER_POSITION_BY_COUNTRY.JP],
  ["MILITARY_BRANCHES_BY_COUNTRY.JP", MILITARY_BRANCHES_BY_COUNTRY.JP],
  ["MILITARY_COUNTRY_SCALE.JP", MILITARY_COUNTRY_SCALE.JP],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.JP", ESTATE_PORTFOLIO_BY_COUNTRY.JP],
  ["GROUPS.JP", GROUPS.JP],
  ["ORDERS_BY_COUNTRY.JP", ORDERS_BY_COUNTRY.JP],
  ["MECHANICS_BY_COUNTRY.JP", MECHANICS_BY_COUNTRY.JP],
  ["LEGISLATIVE_PROCESS.JP", LEGISLATIVE_PROCESS.JP],
  ["ORDERS_OF_BATTLE.JP", ORDERS_OF_BATTLE.JP],
  ["COUNTRY_ELECTION_PHASES.JP", COUNTRY_ELECTION_PHASES.JP],
  ["COUNTRY_BILL_PHASES.JP", COUNTRY_BILL_PHASES.JP],
  ["SPAWN_ELECTIONS_REGISTRY.JP", SPAWN_ELECTIONS_REGISTRY.JP],
  // D2 registries, re-checked: a D3 cycle could break them too.
  ["CABINET_IDENTITY.JP", CABINET_IDENTITY.JP],
  ["NATIONAL_IDENTITY.JP", NATIONAL_IDENTITY.JP],
  // DERIVED from TREASURY_TEXT; proves the composition still runs.
  ["TREASURY_IDENTITY.JP (derived)", TREASURY_IDENTITY.JP],
];

// D4 -- economy and fiscal. Balance surfaces.
checks.push(
  ["COUNTRY_CURRENCY_MAP.JP", COUNTRY_CURRENCY_MAP.JP],
  ["ECONOMIC_BASELINES.JP", ECONOMIC_BASELINES.JP],
  ["MONETARY_BASELINES.JP", MONETARY_BASELINES.JP],
  ["COST_SCALE_ANCHORS.JP", COST_SCALE_ANCHORS.JP],
  ["REP_ECON.JP", REP_ECON.JP],
  ["COUNTRY_SECTOR_WEIGHTS.JP", COUNTRY_SECTOR_WEIGHTS.JP],
  ["PLAYER_PAYOUT_CAP_PER_TURN.JP", PLAYER_PAYOUT_CAP_PER_TURN.JP],
  // ⚠️ Relational, and it must STILL be here: INITIAL_RATES shares a file with
  // COUNTRY_CURRENCY_MAP, which moved. If forwarding took its neighbour along,
  // this is where that shows up.
  ["INITIAL_RATES.JP (must NOT have moved)", INITIAL_RATES.JP]
);

for (const year of ["1979", "1991", "1999", "2007", "2019", "2023"] as const) {
  checks.push([`ORDERS_OF_BATTLE_BY_ERA.${year}.JP`, ORDERS_OF_BATTLE_BY_ERA[year]?.JP]);
}

// D5 -- geography, regions, demographics.
checks.push(
  ["COUNTRY_CONTINENT.JP", COUNTRY_CONTINENT.JP],
  ["COUNTRY_TO_ISO_NUMERIC.JP", COUNTRY_TO_ISO_NUMERIC.JP],
  ["COUNTRY_REGIONS.JP", COUNTRY_REGIONS.JP],
  ["STATE_ADJACENCY.JP", STATE_ADJACENCY.JP],
  ["CENSUS_BUNDLES.JP", CENSUS_BUNDLES.JP],
  ["RAW_BUNDLES.JP", RAW_BUNDLES.JP],
  ["METRIC_PRESET_BUNDLES.JP", METRIC_PRESET_BUNDLES.JP],
  ["CONSCRIPTION_SEED.JP", CONSCRIPTION_SEED.JP],
  ["REGION_ROSTERS.JP", REGION_ROSTERS.JP]
);
for (const metric of [
  "gdpGrowth",
  "unemploymentRate",
  "lifeExpectancy",
  "violentCrimeRate",
  "povertyRate",
]) {
  checks.push([`CORE5_NORMALS.${metric}.JP`, CORE5_NORMALS[metric]?.JP]);
  // ⚠️ The `global` fallback belongs to every country and must still be here.
  checks.push([
    `CORE5_NORMALS.${metric}.global (must NOT have moved)`,
    CORE5_NORMALS[metric]?.global,
  ]);
}

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

// Spot-check values that a half-initialised cycle would leave structurally
// present but wrong.
const seats = COUNTRY_CONFIGS.JP?.legislature?.lowerChamber?.seats;
if (seats !== 465) {
  console.log(`FAIL  COUNTRY_CONFIGS.JP lower chamber seats = ${seats}, expected 465`);
  failed++;
}
const era1953 = ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"]?.JP as
  { legislature?: { lowerChamber?: { seats?: number } } } | undefined;
if (era1953?.legislature?.lowerChamber?.seats !== 466) {
  console.log(
    `FAIL  1953 override lower chamber = ${era1953?.legislature?.lowerChamber?.seats}, expected 466`
  );
  failed++;
}
// Balance surfaces, spot-checked by value. A half-initialised cycle leaves
// these structurally present but wrong, and a wrong GDP anchor silently
// rescales every legislation cost in the game.
if (REP_ECON.JP?.gdp !== 550_000_000_000_000) {
  console.log(`FAIL  REP_ECON.JP.gdp = ${REP_ECON.JP?.gdp}, expected 550000000000000`);
  failed++;
}
if (REP_ECON.JP?.population !== 126_000_000) {
  console.log(`FAIL  REP_ECON.JP.population = ${REP_ECON.JP?.population}`);
  failed++;
}
if (COUNTRY_CURRENCY_MAP.JP !== "JPY") {
  console.log(`FAIL  COUNTRY_CURRENCY_MAP.JP = ${COUNTRY_CURRENCY_MAP.JP}`);
  failed++;
}
if (NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP !== 10) {
  console.log(`FAIL  consumption tax = ${NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP}, expected 10`);
  failed++;
}
// Geography spot checks. A half-initialised cycle leaves these present but wrong.
if (COUNTRY_TO_ISO_NUMERIC.JP !== "392" || ISO_NUMERIC_TO_COUNTRY["392"] !== "JP") {
  console.log(
    `FAIL  ISO pair out of sync: ${COUNTRY_TO_ISO_NUMERIC.JP} / ${ISO_NUMERIC_TO_COUNTRY["392"]}`
  );
  failed++;
}
if (Object.keys(STATE_ADJACENCY.JP ?? {}).length !== 8) {
  console.log(
    `FAIL  STATE_ADJACENCY.JP has ${Object.keys(STATE_ADJACENCY.JP ?? {}).length} regions, expected 8`
  );
  failed++;
}
if (Object.keys(REGION_ROSTERS.JP ?? {}).length !== SHIPPING_PRESETS.length) {
  console.log(
    `FAIL  REGION_ROSTERS.JP has ${Object.keys(REGION_ROSTERS.JP ?? {}).length} eras, expected ${SHIPPING_PRESETS.length}`
  );
  failed++;
}
if (TREASURY_IDENTITY.JP?.budgetTitle !== "国家予算") {
  console.log(`FAIL  TREASURY_IDENTITY.JP.budgetTitle = ${TREASURY_IDENTITY.JP?.budgetTitle}`);
  failed++;
}

// ---- D7 value assertions. Present-but-wrong is the cycle failure mode. ----
if (COUNTRY_READINESS_EXPECTATIONS.JP?.seatMin !== 713) {
  console.log(
    `FAIL  readiness seatMin = ${COUNTRY_READINESS_EXPECTATIONS.JP?.seatMin}, expected 713`
  );
  failed++;
}
if (MAJOR_DEFAULT_PARTIES.JP?.length !== 4) {
  console.log(`FAIL  MAJOR_DEFAULT_PARTIES.JP has ${MAJOR_DEFAULT_PARTIES.JP?.length}, expected 4`);
  failed++;
}
// ⚠ UNION_NAMES_BY_ERA IS KEYED BY BARE YEAR ("2019"), not by preset id
// ("2019-default") like most era tables in this repo. A preset id here returns
// undefined rather than erroring.
// The 2007 union map SPREADS the modern one. Resolved against an uninitialised
// binding it comes back silently SHORT rather than absent, which no presence
// check catches.
{
  const modern = Object.keys(UNION_NAMES_BY_ERA["2019"]?.JP ?? {}).length;
  const y2007 = Object.keys(UNION_NAMES_BY_ERA["2007"]?.JP ?? {}).length;
  if (y2007 < modern) {
    console.log(
      `FAIL  2007 JP union map has ${y2007} sectors, modern has ${modern} -- spread lost`
    );
    failed++;
  }
}
// METRIC_BAND_CURVES is metric-first. Japan's moved slice is `uninsuredRate`,
// and SEVERAL other metrics also carry a JP band -- looking up "the first curve
// with a JP entry" finds a different metric and passes on the wrong data.
{
  const band = METRIC_BAND_CURVES.uninsuredRate?.byCountry?.JP;
  if (!band || band.length !== 3) {
    console.log(`FAIL  JP uninsuredRate band has ${band?.length} rows, expected 3`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// IS THERE STILL EXACTLY ONE COPY?
//
// ⚠ THIS IS THE CHECK THE REST OF THE FILE CANNOT MAKE. Everything above asks
// whether a registry RESOLVES. None of it asks whether it resolves to the
// FOLDER'S object or to a second one holding equal values. Deep equality passes
// either way, which is exactly how a forwarder quietly becomes a copy: correct
// on the day it is made, silently divergent after the first edit to one side.
//
// `===` is the whole point. For an object it is reference identity, so it fails
// the moment a registry holds its own copy; for a scalar it is value equality,
// which is the strongest statement available. An early D5 draft of geography.ts
// generated copies of every census bundle -- deep equality passed while Japan
// quietly had two sources for each one. This is what catches that class.
// ---------------------------------------------------------------------------
type Same = [label: string, registry: unknown, folder: unknown];
const sameObject: Same[] = [
  ["COUNTRY_CONFIGS.JP", COUNTRY_CONFIGS.JP, JP_CONFIG],
  ["COUNTRY_CONFIGS.JP (via institutions)", COUNTRY_CONFIGS.JP, JP_INSTITUTIONS.config],
  ["LEGISLATIVE_PROCESS.JP", LEGISLATIVE_PROCESS.JP, JP_LEGISLATIVE_PROCESS],
  ["CABINET_IDENTITY.JP", CABINET_IDENTITY.JP, JP_IDENTITY.cabinet],
  ["NATIONAL_IDENTITY.JP", NATIONAL_IDENTITY.JP, JP_IDENTITY.national],
  ["ESTATE_PORTFOLIO_BY_COUNTRY.JP", ESTATE_PORTFOLIO_BY_COUNTRY.JP, JP_ESTATE_PORTFOLIO],
  ["MILITARY_BRANCHES_BY_COUNTRY.JP", MILITARY_BRANCHES_BY_COUNTRY.JP, JP_MILITARY_BRANCHES],
  ["GROUPS.JP", GROUPS.JP, JP_INSTITUTIONS.cabinet.groups],
  ["ORDERS_BY_COUNTRY.JP", ORDERS_BY_COUNTRY.JP, JP_MINISTERIAL_ORDERS],
  ["MECHANICS_BY_COUNTRY.JP", MECHANICS_BY_COUNTRY.JP, JP_CABINET_MECHANICS],
  ["DEFENSE_POSITION_BY_COUNTRY.JP", DEFENSE_POSITION_BY_COUNTRY.JP, JP_CABINET_SEAT_IDS.defense],
  ["ENERGY_POSITION_BY_COUNTRY.JP", ENERGY_POSITION_BY_COUNTRY.JP, JP_CABINET_SEAT_IDS.energy],
  [
    "INFRA_POSITION_BY_COUNTRY.JP",
    INFRA_POSITION_BY_COUNTRY.JP,
    JP_CABINET_SEAT_IDS.infrastructure,
  ],
  ["STATE_ADJACENCY.JP", STATE_ADJACENCY.JP, JP_ADJACENCY_MAP],
  ["STATE_ADJACENCY.JP (via geography)", STATE_ADJACENCY.JP, JP_GEOGRAPHY.adjacency],
  ["COUNTRY_CONTINENT.JP", COUNTRY_CONTINENT.JP, JP_CONTINENT],
  ["COUNTRY_TO_ISO_NUMERIC.JP", COUNTRY_TO_ISO_NUMERIC.JP, JP_ISO_NUMERIC],
  ["COUNTRY_ANCHOR.JP", COUNTRY_ANCHOR.JP, JP_MAP_ANCHOR],
  ["COUNTRY_CURRENCY_MAP.JP", COUNTRY_CURRENCY_MAP.JP, JP_ECONOMY.currencyCode],
  ["ECONOMIC_BASELINES.JP", ECONOMIC_BASELINES.JP, JP_ECONOMY.economicBaseline],
  ["COST_SCALE_ANCHORS.JP", COST_SCALE_ANCHORS.JP, JP_ECONOMY.costScaleAnchors],
  ["REP_ECON.JP", REP_ECON.JP, JP_ECONOMY.repEcon],
  ["COUNTRY_SECTOR_WEIGHTS.JP", COUNTRY_SECTOR_WEIGHTS.JP, JP_ECONOMY.sectorWeights.base],
  ["PLAYER_PAYOUT_CAP_PER_TURN.JP", PLAYER_PAYOUT_CAP_PER_TURN.JP, JP_ECONOMY.payoutCapPerTurn],
  ["CENSUS_BUNDLES.JP", CENSUS_BUNDLES.JP, JP_GEOGRAPHY.censusBundles],
  ["CORE5_NORMALS.gdpGrowth.JP", CORE5_NORMALS.gdpGrowth?.JP, JP_CORE5_NORMALS["gdpGrowth"]],
  ["DOMAIN_BUCKET_AFFINITIES.JP", DOMAIN_BUCKET_AFFINITIES.JP, JP_DOMAIN_BUCKET_AFFINITIES],
  ["COUNTRY_BUCKET_LABELS.JP", COUNTRY_BUCKET_LABELS.JP, JP_BUCKET_LABELS],
  ["COUNTRY_MODIFIER_PATCHES.JP", COUNTRY_MODIFIER_PATCHES.JP, JP_MODIFIER_PATCHES],
  ["MAJOR_DEFAULT_PARTIES.JP", MAJOR_DEFAULT_PARTIES.JP, JP_PARTY_TIERS],
  [
    "COUNTRY_READINESS_EXPECTATIONS.JP",
    COUNTRY_READINESS_EXPECTATIONS.JP,
    JP_READINESS_EXPECTATIONS,
  ],
  ["COUNTRY_SECTOR_WEIGHTS_1953.JP", COUNTRY_SECTOR_WEIGHTS_1953.JP, JP_SECTOR_WEIGHTS_1953],
  ["UNION_NAMES_BY_ERA.2019.JP", UNION_NAMES_BY_ERA["2019"]?.JP, JP_UNION_NAMES_MODERN],
  ["UNION_NAMES_BY_ERA.1953.JP", UNION_NAMES_BY_ERA["1953"]?.JP, JP_UNION_NAMES_1953],
  ["COUNTRY_ELECTION_PHASES.JP", COUNTRY_ELECTION_PHASES.JP, JP_ELECTIONS.electionPhases],
  ["SPAWN_ELECTIONS_REGISTRY.JP", SPAWN_ELECTIONS_REGISTRY.JP, JP_ELECTIONS.spawn],
  [
    "ERA_COUNTRY_CONFIG_OVERRIDES.1953.JP",
    ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"]?.JP,
    JP_ERAS["1953-default"]?.config,
  ],
  [
    "ERA_COUNTRY_CONFIG_OVERRIDES.1991.JP",
    ERA_COUNTRY_CONFIG_OVERRIDES["1991-default"]?.JP,
    JP_ERAS["1991-default"]?.config,
  ],
  ["ORDERS_OF_BATTLE.JP", ORDERS_OF_BATTLE.JP, JP_INSTITUTIONS.military.ordersOfBattle],
  [
    "NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP",
    NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP,
    JP_ECONOMY.tax.neutralFederalSalesTax,
  ],
  ["cabinet positions reachable", JP_INSTITUTIONS.cabinet.positions, JP_CABINET_POSITIONS],
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
      `FAIL  ${label} is a SECOND COPY: equal values, different object. It no longer forwards.`
    );
    copies++;
    failed++;
  }
}
console.log(`${sameObject.length} forwarders checked for identity, ${copies} holding a copy.`);

console.log(`\n${checks.length} registries checked, ${failed} failed.`);
if (failed > 0) process.exit(1);
console.log("Every forwarded registry resolves at runtime.");
