/**
 * Writes the pre-move snapshot of every registry a country's folder will absorb.
 *
 *   npx tsx scripts/countries/emit-country-snapshot.ts US
 *
 * ⚠ RUN THIS ONCE PER COUNTRY, BEFORE ANY REGISTRY IS REWIRED. The fixture it
 * writes is the only independent record of what the values were. Once a registry
 * forwards to the country folder, reading it back compares the new thing to
 * itself and the faithful-replacement harness passes vacuously. That failure is
 * not hypothetical: it happened in Plan C task C0.
 *
 * ⚠ NEVER REGENERATE ONE THAT EXISTS. If a later phase finds a registry missing
 * from a fixture, append that one entry by hand; after the move the live
 * registries no longer hold the pre-move values, so a re-emit silently rewrites
 * history to agree with whatever is there now. The script refuses by default.
 *
 * ⚠ THIS IS THE GENERALISED FORM OF `emit-jp-snapshot.ts`, recovered from
 * b5c0a2c1c^. Japan's was written as a one-off and deleted after use, which meant
 * country #2 would have started by rebuilding the registry list by hand -- and
 * that list rotting is the defect this plan has repeated most. The import block
 * below IS the list; it is the reason this file is long.
 *
 * The extractor is SHAPE-DRIVEN, not hand-written per registry, and it records
 * which shape it matched. A country does not sit at the same depth in every
 * registry: some are country-first, some preset-first, some metric-first, and
 * some use composite "JP:HOK" keys.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { REGION_DEMOGRAPHIC_CATEGORY_IDS } from "../../src/app/country/[code]/region/[id]/regionData";
import { REGION_NAME_MAPS } from "../../src/lib/admin/seed/seedSeats";
import { FULL_ERA_REGION_BUNDLES } from "../../src/lib/admin/seedDiagnostic/regionBundles";
import { NPP_CAPITAL_STATES } from "../../src/lib/admin/spawnNppCorporation";
import { COUNTRY_HISTORICAL_NAMES, COUNTRY_MODERN_NAMES } from "../../src/lib/banking/npcBanks";
import { COST_SCALE_ANCHORS } from "../../src/lib/budget/costs";
import { COUNTRY_MAP_REGISTRY } from "../../src/lib/commodity-map/commodityMapRegistry";
import { STATE_DISPLAY_NAMES } from "../../src/lib/commodity-map/commodityRegionMappings";
import { ENERGY_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetEnergy";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "../../src/lib/constants/cabinetEstates";
import { CABINET_IDENTITY } from "../../src/lib/constants/cabinetIdentity";
import { INFRA_POSITION_BY_COUNTRY } from "../../src/lib/constants/cabinetInfra";
import {
  COUNTRY_CONFIGS,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  NATIONAL_ADDRESS_NAME,
  REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "../../src/lib/constants/countries";
import { COUNTRY_CONTINENT } from "../../src/lib/constants/countryContinents";
import { COUNTRY_TO_ISO_NUMERIC, ISO_NUMERIC_TO_COUNTRY } from "../../src/lib/constants/countryIso";
import {
  COUNTRY_CURRENCY_MAP,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
} from "../../src/lib/constants/currencies";
import { ECONOMY_TEXT } from "../../src/lib/constants/economyIdentity";
import { EXECUTIVE_SEALS } from "../../src/lib/constants/executiveSeals";
import { EXECUTIVE_SURFACE } from "../../src/lib/constants/executiveSurface";
import { EXECUTIVE_TEXT, POLICY_TEXT } from "../../src/lib/constants/institutionIdentity";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "../../src/lib/constants/internationalOrganizations";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
} from "../../src/lib/constants/military";
import {
  MONETARY_BASELINES_1953,
  MONETARY_BASELINES_1971,
  MONETARY_BASELINES_1979,
  MONETARY_BASELINES_1991,
} from "../../src/lib/constants/monetaryEra";
import { NATIONAL_IDENTITY } from "../../src/lib/constants/nationalIdentity";
import { NATIONAL_STATS_IDENTITY } from "../../src/lib/constants/nationalStatsIdentity";
import { SURFACES } from "../../src/lib/constants/parliamentaryExecutiveSurface";
import { REGION_CENSUS_LABELS } from "../../src/lib/constants/regionCensusLabels";
import { STATE_ADJACENCY } from "../../src/lib/constants/stateAdjacency";
import { TREASURY_IDENTITY, TREASURY_TEXT } from "../../src/lib/constants/treasuryIdentity";
import { HAZARD_GROUPS } from "../../src/lib/crises/regionHazards";
import { CONSCRIPTION_SEED } from "../../src/lib/demographics/conscription";
import { REGION_ROSTERS } from "../../src/lib/demographics/substrateCoverage";
import { REP_ECON } from "../../src/lib/era/legislationCostCatalog";
import { CORE5_NORMALS, INCOME_ANCHORS } from "../../src/lib/era/metricCatalog";
import { LEGISLATIVE_PROCESS } from "../../src/lib/legislature/process";
import { LEGISLATION_COUNTRY_SCOPES } from "../../src/lib/policy/nationalPolicyRecords";
import { NATIONAL_POLICY_STATE_IDS } from "../../src/lib/policy/nationalStateId";
import { TREASURY_PS_RATE_BY_COUNTRY } from "../../src/lib/politicalStrength/strengthConstants";
import { TARGETS } from "../../src/lib/seeds/calibration/targets";
import { METRIC_PRESET_BUNDLES } from "../../src/lib/seeds/metricPresets";
import { POPULATION_ANCHOR_BUNDLES } from "../../src/lib/seeds/populationAnchors";
import { SOVEREIGN_CORP_LEGAL_STRUCTURE } from "../../src/lib/seeds/reference/budgets";
import { M2_TO_GDP_1953 } from "../../src/lib/seeds/reference/moneySupply";
import {
  ORDERS_OF_BATTLE,
  ORDERS_OF_BATTLE_BY_ERA,
} from "../../src/lib/seeds/reference/ordersOfBattle";
import { COUNTRY_SECTOR_WEIGHTS } from "../../src/lib/seeds/reference/sectorSeedWeights";
import { COUNTRY_SECTOR_WEIGHTS_1979 } from "../../src/lib/seeds/reference/sectorSeedWeights1979";
import { COUNTRY_SECTOR_WEIGHTS_1991 } from "../../src/lib/seeds/reference/sectorSeedWeights1991";
import { DEFAULT_STRATEGIC_SECTORS } from "../../src/lib/seeds/reference/strategicSectors";
import { CENSUS_BUNDLES } from "../../src/lib/seeds/regionCensusData";
import { COUNTRY_ERA1991_PATCHES } from "../../src/lib/states/conditions/countryEra1991Patches";
import { RAW_BUNDLES } from "../../src/lib/states/conditions/seedMetricsLoader";
import { PLAYER_PAYOUT_CAP_PER_TURN } from "../../src/lib/treasury/payoutCapValues";
import { COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES } from "../../src/lib/turn/countryPhases";
import {
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY,
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY,
} from "../../src/lib/turn/gdpGrowth";
import { NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY } from "../../src/lib/turn/partyOrg/pacingConstants";
import { SPAWN_ELECTIONS_REGISTRY } from "../../src/lib/turn/perpetualElections/registry";
import { COUNTRY_REGIONS, COUNTRY_UN_MEMBER_SINCE } from "../../src/lib/world/worldEntityManifest";
import { DOMAIN_BUCKET_AFFINITIES } from "../../src/lib/bucketAffinities";
import { GROUPS } from "../../src/lib/constants/cabinetPositionGroups";
import { MECHANICS_BY_COUNTRY } from "../../src/lib/constants/cabinetMechanics";
import { ORDERS_BY_COUNTRY } from "../../src/lib/constants/cabinetOrders";
import { COUNTRY_READINESS_EXPECTATIONS } from "../../src/lib/constants/countryReadinessExpectations";
import { INITIAL_RATES } from "../../src/lib/constants/currencies";
import { COUNTRY_BUCKET_LABELS } from "../../src/lib/demographics/bucketLabelsByCountry";
import { COUNTRY_ANCHOR } from "../../src/lib/maps/countryAnchors";
import { POPULATION_MULTIPLIERS } from "../../src/lib/seeds/reference/era1991PopulationMultipliers";
import { COUNTRY_COMMAND_FLAVOR } from "../../src/lib/military/theaters";
import { MAJOR_DEFAULT_PARTIES } from "../../src/lib/seeds/defaultPartyTiers";
import { GDP_DENOMINATION_1953 } from "../../src/lib/seeds/reference/gdpDenomination";
import { COUNTRY_SECTOR_WEIGHTS_1953 } from "../../src/lib/seeds/reference/sectorSeedWeights1953";
import { UNION_NAMES_BY_ERA } from "../../src/lib/seeds/reference/unionNames";
import { COUNTRY_MODIFIER_PATCHES } from "../../src/lib/states/conditions/countryPatches";
import { MEDIAN_INCOME_THRESHOLDS } from "../../src/lib/utils/metricScoring";

const COUNTRY = process.argv[2]?.toUpperCase();
if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY)) {
  console.error("usage: npx tsx scripts/countries/emit-country-snapshot.ts <COUNTRY_ID>");
  process.exit(1);
}
const OUT = `src/lib/countries/__snapshots__/${COUNTRY.toLowerCase()}.pre-move.json`;

if (existsSync(OUT)) {
  console.error(
    `${OUT} already exists. A snapshot is a PRE-move record and must never be ` +
      `re-emitted: after the move the live registries hold the post-move values, ` +
      `so re-emitting rewrites the baseline to agree with whatever is there now. ` +
      `Append a missing entry by hand instead, or delete the file deliberately.`
  );
  process.exit(1);
}

type Shape =
  | "country-first"
  | "nested-under-country"
  | "outer-keyed"
  | "composite-key"
  | "function-valued"
  | "value-keyed"
  | "absent";

interface Snapshot {
  readonly shape: Shape;
  readonly value: unknown;
  /** Present only when the registry holds functions, which toEqual cannot compare. */
  readonly functionKeys?: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fnKeys(v: unknown): string[] {
  if (typeof v === "function") return ["<self>"];
  if (!isObj(v)) return [];
  const out: string[] = [];
  for (const [k, inner] of Object.entries(v)) {
    if (typeof inner === "function") out.push(k);
    else for (const deeper of fnKeys(inner)) out.push(k + "." + deeper);
  }
  return out;
}

/**
 * Find the country wherever it sits. Order matters: a direct country key wins, then
 * composite "JP:HOK"-style keys, then an outer key (preset or metric) whose values
 * carry the country. `global` and other siblings are deliberately NOT captured -- they do
 * not belong to the country and must not move.
 */
function extract(name: string, registry: unknown): Snapshot {
  // ⚠ THERE IS DELIBERATELY NO RULE THAT MATCHES ON THE REGISTRY'S NAME.
  //
  // Japan's emitter opened with `/^JP[_A-Z]|^JAPAN/.test(name)` to catch
  // JP_ADJACENCY, which is keyed HOK/TOH/KAN and so has no "JP" key of its own.
  // That was safe only because no other registry here starts with "JP".
  // Parameterised by country id it misfires for six of them: CABINET_IDENTITY
  // reads as Canada's whole table, DEFAULT_STRATEGIC_SECTORS and
  // DEFENSE_POSITION_BY_COUNTRY as Germany's, ESTATE_PORTFOLIO_BY_COUNTRY as
  // Spain's, INCOME_ANCHORS and INFRA_POSITION_BY_COUNTRY as India's,
  // PLAYER_PAYOUT_CAP_PER_TURN as Poland's, and the TREASURY_*/TRADE_* group as
  // Turkey's -- each one capturing 24 countries' data as that one country's.
  //
  // The rule is not needed. Every registry in the list below is country-KEYED,
  // and a whole-country table is reached through its parent: STATE_ADJACENCY.JP
  // IS JP_ADJACENCY, by reference. The country-first rule already has it. So
  // dropping the name rule removes the false-friend class outright, rather than
  // blacklisting the six names that happen to collide today.
  if (typeof registry === "function") {
    return { shape: "function-valued", value: null, functionKeys: ["<self>"] };
  }
  if (!isObj(registry)) return { shape: "absent", value: registry ?? null };

  if (COUNTRY in registry) {
    const value = registry[COUNTRY];
    const fns = fnKeys(value);
    return fns.length
      ? { shape: "function-valued", value: null, functionKeys: fns }
      : { shape: "country-first", value: value ?? null };
  }

  const composite = Object.keys(registry).filter((k) => k.startsWith(COUNTRY + ":"));
  if (composite.length) {
    const value: Record<string, unknown> = {};
    for (const k of composite) value[k] = registry[k];
    return { shape: "composite-key", value };
  }

  const outer: Record<string, unknown> = {};
  const fns: string[] = [];
  for (const [k, inner] of Object.entries(registry)) {
    if (!isObj(inner)) continue;
    if (COUNTRY in inner) {
      outer[k] = inner[COUNTRY] ?? null;
      for (const f of fnKeys(inner[COUNTRY])) fns.push(k + "." + f);
    } else {
      const sub = Object.keys(inner).filter((kk) => kk.startsWith(COUNTRY + ":"));
      if (sub.length) {
        const bag: Record<string, unknown> = {};
        for (const kk of sub) bag[kk] = (inner as Record<string, unknown>)[kk];
        outer[k] = bag;
      }
    }
  }
  if (Object.keys(outer).length) {
    return fns.length
      ? { shape: "function-valued", value: outer, functionKeys: fns }
      : { shape: "outer-keyed", value: outer };
  }

  // Inverse maps hold the country as a VALUE, not a key: ISO_NUMERIC_TO_COUNTRY is
  // { "392": "JP" }. The plan says move the pair together, so capture both ends.
  const inverse = Object.entries(registry).filter(([, v]) => v === COUNTRY);
  if (inverse.length) return { shape: "value-keyed", value: Object.fromEntries(inverse) };

  return { shape: "absent", value: null };
}

const REGISTRIES: Record<string, unknown> = {
  // ⚠ THESE FIFTEEN WERE ABSENT FROM JAPAN'S EMITTER AND ARE NOT OPTIONAL.
  //
  // `verify-jp-runtime.ts` asserts the folder owns each of them -- GROUPS.JP,
  // MECHANICS_BY_COUNTRY.JP, ORDERS_BY_COUNTRY.JP and the rest are in its
  // identity block, checked with `===` -- yet none was ever snapshotted. Japan
  // survived that because its generators imported these straight from source at
  // a time when source still held the pre-move values. The fixture is supposed
  // to be the INDEPENDENT record, and for these fifteen it was not a record at
  // all; had a generator gone wrong here there was nothing to compare against.
  //
  // ⚠ INITIAL_RATES IS RECORDED AS EVIDENCE AND MUST NOT MOVE. An exchange rate
  // is a fact about a PAIR of countries in a year, not a fact the country owns,
  // and it belongs next to the rates it has to stay consistent with. It is here
  // so a later reader can prove it did not change, not so a folder can absorb it.
  COUNTRY_ANCHOR,
  COUNTRY_BUCKET_LABELS,
  COUNTRY_COMMAND_FLAVOR,
  COUNTRY_MODIFIER_PATCHES,
  COUNTRY_READINESS_EXPECTATIONS,
  COUNTRY_SECTOR_WEIGHTS_1953,
  DOMAIN_BUCKET_AFFINITIES,
  GDP_DENOMINATION_1953,
  GROUPS,
  INITIAL_RATES,
  MAJOR_DEFAULT_PARTIES,
  MECHANICS_BY_COUNTRY,
  MEDIAN_INCOME_THRESHOLDS,
  POPULATION_MULTIPLIERS,
  ORDERS_BY_COUNTRY,
  UNION_NAMES_BY_ERA,
  CABINET_IDENTITY,
  CENSUS_BUNDLES,
  CONSCRIPTION_SEED,
  CORE5_NORMALS,
  COST_SCALE_ANCHORS,
  COUNTRY_BILL_PHASES,
  COUNTRY_CONFIGS,
  COUNTRY_CONTINENT,
  COUNTRY_CURRENCY_MAP,
  COUNTRY_ELECTION_PHASES,
  COUNTRY_ERA1991_PATCHES,
  COUNTRY_HISTORICAL_NAMES,
  COUNTRY_MAP_REGISTRY,
  COUNTRY_MODERN_NAMES,
  COUNTRY_REGIONS,
  COUNTRY_SECTOR_WEIGHTS,
  COUNTRY_SECTOR_WEIGHTS_1979,
  COUNTRY_SECTOR_WEIGHTS_1991,
  COUNTRY_TO_ISO_NUMERIC,
  COUNTRY_UN_MEMBER_SINCE,
  DEFAULT_STRATEGIC_SECTORS,
  DEFENSE_POSITION_BY_COUNTRY,
  ECONOMIC_BASELINES,
  ECONOMY_TEXT,
  ENERGY_POSITION_BY_COUNTRY,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  ESTATE_PORTFOLIO_BY_COUNTRY,
  EXECUTIVE_SEALS,
  EXECUTIVE_SURFACE,
  EXECUTIVE_TEXT,
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  FULL_ERA_REGION_BUNDLES,
  HAZARD_GROUPS,
  INCOME_ANCHORS,
  INFRA_POSITION_BY_COUNTRY,
  ISO_NUMERIC_TO_COUNTRY,
  LEGISLATION_COUNTRY_SCOPES,
  LEGISLATIVE_PROCESS,
  M2_TO_GDP_1953,
  METRIC_PRESET_BUNDLES,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
  MONETARY_BASELINES,
  MONETARY_BASELINES_1953,
  MONETARY_BASELINES_1971,
  MONETARY_BASELINES_1979,
  MONETARY_BASELINES_1991,
  NATIONAL_ADDRESS_NAME,
  NATIONAL_IDENTITY,
  NATIONAL_POLICY_STATE_IDS,
  NATIONAL_STATS_IDENTITY,
  NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY,
  NEUTRAL_STATE_SALES_TAX_BY_COUNTRY,
  NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY,
  NPP_CAPITAL_STATES,
  ORDERS_OF_BATTLE,
  ORDERS_OF_BATTLE_BY_ERA,
  PLAYER_PAYOUT_CAP_PER_TURN,
  POLICY_TEXT,
  POPULATION_ANCHOR_BUNDLES,
  RAW_BUNDLES,
  REGIONAL_BILL_ASSENT_OFFICE_KEY,
  REGION_CENSUS_LABELS,
  REGION_DEMOGRAPHIC_CATEGORY_IDS,
  REGION_NAME_MAPS,
  REGION_ROSTERS,
  REP_ECON,
  SOVEREIGN_CORP_LEGAL_STRUCTURE,
  SPAWN_ELECTIONS_REGISTRY,
  STATE_ADJACENCY,
  STATE_DISPLAY_NAMES,
  SURFACES,
  TARGETS,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
  TREASURY_IDENTITY,
  TREASURY_PS_RATE_BY_COUNTRY,
  TREASURY_TEXT,
};

const snapshot: Record<string, Snapshot> = {};
for (const [name, registry] of Object.entries(REGISTRIES)) {
  snapshot[name] = extract(name, registry);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

const byShape = new Map<Shape, number>();
for (const s of Object.values(snapshot)) byShape.set(s.shape, (byShape.get(s.shape) ?? 0) + 1);
console.log("wrote " + OUT);
console.log("registries: " + Object.keys(snapshot).length);
for (const [shape, n] of [...byShape].sort()) console.log("  " + shape + ": " + n);
const absent = Object.entries(snapshot).filter(([, s]) => s.shape === "absent");
if (absent.length) {
  console.log(`\nNO ${COUNTRY} ENTRY (${absent.length}) -- verify each is genuinely absent:`);
  for (const [name] of absent) console.log("  " + name);
}
