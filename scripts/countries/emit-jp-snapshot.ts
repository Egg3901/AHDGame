/**
 * ONE-OFF EMITTER -- writes the pre-move snapshot of every registry Japan's
 * folder will absorb.
 *
 * ⚠️ RUN THIS ONCE, BEFORE ANY REGISTRY IS REWIRED. The fixture it writes is the
 * only independent record of what the values were. Once a registry forwards to
 * the country folder, reading it back compares the new thing to itself, and the
 * faithful-replacement harness passes vacuously. That failure is not
 * hypothetical: it happened in Plan C task C0.
 *
 * ⚠️ NEVER REGENERATE. If a later phase finds a registry missing from the
 * fixture, append that one entry by hand; do not re-emit the file, because after
 * D2 the live registries no longer hold the pre-move values.
 *
 * The extractor is SHAPE-DRIVEN, not hand-written per registry, and it records
 * which shape it matched. Japan does not sit at the same depth in every
 * registry: some are country-first, some preset-first, some metric-first, and
 * some use composite "JP:HOK" keys. A hand-written extractor per registry is the
 * kind of list that has rotted repeatedly in this plan.
 *
 *   npx tsx scripts/countries/emit-jp-snapshot.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
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
import { JP_ADJACENCY, STATE_ADJACENCY } from "../../src/lib/constants/stateAdjacency";
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

const COUNTRY = "JP";
const OUT = "src/lib/countries/__snapshots__/jp.pre-move.json";

type Shape =
  | "country-first"
  | "nested-under-country"
  | "outer-keyed"
  | "composite-key"
  | "function-valued"
  | "whole-registry"
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
 * Find Japan wherever it sits. Order matters: a direct JP key wins, then
 * composite "JP:REGION" keys, then an outer key (preset or metric) whose values
 * carry JP. `global` and other siblings are deliberately NOT captured -- they do
 * not belong to Japan and must not move.
 */
function extract(name: string, registry: unknown): Snapshot {
  // A JP_-prefixed registry IS Japan's, in full. It has no "JP" key because
  // every key is one of Japan's regions -- JP_ADJACENCY is keyed HOK, TOH, KAN.
  if (/^JP[_A-Z]|^JAPAN/.test(name) && isObj(registry)) {
    return { shape: "whole-registry", value: registry };
  }
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

  // Inverse maps hold JP as a VALUE, not a key: ISO_NUMERIC_TO_COUNTRY is
  // { "392": "JP" }. The plan says move the pair together, so capture both ends.
  const inverse = Object.entries(registry).filter(([, v]) => v === COUNTRY);
  if (inverse.length) return { shape: "value-keyed", value: Object.fromEntries(inverse) };

  return { shape: "absent", value: null };
}

const REGISTRIES: Record<string, unknown> = {
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
  JP_ADJACENCY,
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
  console.log("\nNO JAPAN ENTRY (" + absent.length + ") -- verify each is genuinely absent:");
  for (const [name] of absent) console.log("  " + name);
}
