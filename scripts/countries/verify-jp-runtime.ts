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

type Check = [name: string, value: unknown, expectation?: (v: never) => boolean];

const checks: Check[] = [
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

for (const year of ["1979", "1991", "1999", "2007", "2019", "2023"] as const) {
  checks.push([`ORDERS_OF_BATTLE_BY_ERA.${year}.JP`, ORDERS_OF_BATTLE_BY_ERA[year]?.JP]);
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
if (TREASURY_IDENTITY.JP?.budgetTitle !== "国家予算") {
  console.log(`FAIL  TREASURY_IDENTITY.JP.budgetTitle = ${TREASURY_IDENTITY.JP?.budgetTitle}`);
  failed++;
}

console.log(`\n${checks.length} registries checked, ${failed} failed.`);
if (failed > 0) process.exit(1);
console.log("Every forwarded registry resolves at runtime.");
