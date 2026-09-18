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
import { CONVERTED } from "../../src/lib/countries/singleCountryData";

type Dict = Record<string, unknown>;
const d = (o: unknown) => o as Dict;

/** Every registry that carries a per-country key, by the name a reader greps for. */
const REGISTRIES: Record<string, Dict> = {
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
};

function at(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? o : d(o)[k]), root);
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && v !== null && Object.keys(v).length === 0);

async function verify(cc: string): Promise<boolean> {
  const mod = (await import(`../../src/lib/countries/${cc.toLowerCase()}/index`)) as Dict;
  const folder = mod[cc];
  if (!folder) {
    console.log(`FAIL  the ${cc} folder's barrel exports no \`${cc}\``);
    return false;
  }
  const exempt = ABSENT_UPSTREAM[cc] ?? {};

  let resolved = 0;
  let forwarders = 0;
  let scalars = 0;
  let failed = 0;

  for (const [name, registry] of Object.entries(REGISTRIES)) {
    const value = registry[cc];
    const why = exempt[name];
    const path = FOLDER_PATH[name];

    if (isEmpty(value)) {
      if (why) {
        const side = path ? at(folder, path) : undefined;
        if (!isEmpty(side)) {
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
    if (side === undefined) {
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

  console.log(
    `${cc}: ${resolved}/${Object.keys(REGISTRIES).length} registries resolve, ` +
      `${forwarders} forwarders identical, ${scalars} scalars match, ${failed} failures.`
  );
  return failed === 0;
}

const args = process.argv.slice(2);
const targets = args.includes("--all") ? [...CONVERTED] : args.map((a) => a.toUpperCase());
if (targets.length === 0) {
  console.error("usage: npx tsx scripts/countries/verify-country-runtime.ts <CC>... | --all");
  process.exit(1);
}

/*
 * Wrapped rather than a top-level `await`: tsx transforms this file to CJS,
 * where top-level await is a transform error rather than a runtime one.
 */
async function main(): Promise<void> {
  let ok = true;
  for (const cc of targets) ok = (await verify(cc)) && ok;
  if (ok) console.log(`\nEvery registry resolves, forwards and matches for ${targets.join(", ")}.`);
  process.exitCode = ok ? 0 : 1;
}

void main();
