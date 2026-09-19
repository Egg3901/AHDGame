/**
 * Repoints every shared registry at a country's folder, so the folder is the
 * one place its values are declared.
 *
 *   npx tsx scripts/countries/rewire-country.ts DE
 *   npx tsx scripts/countries/rewire-country.ts US UK --dry
 *
 * ⚠ THIS EXISTS BECAUSE HAND-REWIRING MISSED THIRTEEN REGISTRIES, TWICE. Japan
 * was rewired by hand and forwards everywhere. The United States and the United
 * Kingdom were rewired by hand too, and `COUNTRY_CONTINENT.US` was still the
 * literal `"North America"` sitting one line above `JP: JP_CONTINENT`, with the
 * same string repeated in `us/geographyFacts.ts`. Every one of the misses was a
 * SCALAR, and that is not a coincidence: `verify-country-runtime.ts` compares
 * scalars by value, so a duplicated `"840"` passes the harness on the day it is
 * made. It only becomes a defect later, when one of the two is edited.
 *
 * ⚠ AN ENTRY IS REPLACED, NEVER APPENDED. The script finds the country's
 * existing key inside the named registry and rewrites its value in place. If the
 * key is missing it says so and changes nothing, because a country that is
 * absent from a registry is a fact about the data (see the harness's
 * ABSENT_UPSTREAM) and inventing an entry would turn a real gap into a value.
 *
 * ⚠ IT PREFERS THE FACTS MODULES. `geographyFacts` and `institutionsFacts` have
 * no value imports; `geography` pulls every era of census and region data.
 * `countryContinents.ts` is reachable from the client, and pointing it at the
 * heavy module would ship 108 KB to the browser to read one string.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { escapeRegExp } from "./regexEscape";

interface Rewire {
  /** The registry object literal to edit. */
  readonly registry: string;
  /** The file it is declared in. */
  readonly file: string;
  /** Module inside the country folder, e.g. "geographyFacts". */
  readonly module: string;
  /** The binding to import, with CC standing in for the country id. */
  readonly binding: string;
  /** The expression to use as the value, with CC standing in for the id. */
  readonly expr: string;
}

const R: Rewire[] = [
  // ---- identity -----------------------------------------------------------
  r("COUNTRY_CONFIGS", "src/lib/constants/countries.ts", "institutionsFacts", "CC_CONFIG"),
  r(
    "NATIONAL_ADDRESS_NAME",
    "src/lib/constants/countries.ts",
    "identity",
    "CC_IDENTITY",
    /*
     * ⚠ `?.`, BECAUSE `addressNames` IS OPTIONAL ON THE CONTRACT. China has no
     * row in this registry and omits the field, so the access has to tolerate
     * its absence -- and `NATIONAL_ADDRESS_NAME` is `Partial`, so `undefined` is
     * a legal value for it. Without the `?.` every country added after China
     * fails typecheck on a line the tool wrote.
     */
    "CC_IDENTITY.addressNames?.national"
  ),
  r(
    "CABINET_IDENTITY",
    "src/lib/constants/cabinetIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.cabinet"
  ),
  r(
    "NATIONAL_IDENTITY",
    "src/lib/constants/nationalIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.national"
  ),
  r(
    "NATIONAL_STATS_IDENTITY",
    "src/lib/constants/nationalStatsIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.stats"
  ),
  r(
    "TREASURY_TEXT",
    "src/lib/constants/treasuryIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.treasuryText"
  ),
  r(
    "ECONOMY_TEXT",
    "src/lib/constants/economyIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.economyText"
  ),
  r(
    "EXECUTIVE_TEXT",
    "src/lib/constants/institutionIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.executiveText"
  ),
  r(
    "POLICY_TEXT",
    "src/lib/constants/institutionIdentity.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.policyText"
  ),
  r(
    "EXECUTIVE_SEALS",
    "src/lib/constants/executiveSeals.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.executiveSeal"
  ),
  r(
    "EXECUTIVE_SURFACE",
    "src/lib/constants/executiveSurface.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.executiveSurface"
  ),
  r(
    "COUNTRY_HISTORICAL_NAMES",
    "src/lib/banking/npcBanks.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.historicalNames"
  ),
  r(
    "COUNTRY_MODERN_NAMES",
    "src/lib/banking/npcBanks.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.modernNames"
  ),

  // ---- institutions -------------------------------------------------------
  r(
    "LEGISLATIVE_PROCESS",
    "src/lib/legislature/process.ts",
    "institutionsFacts",
    "CC_LEGISLATIVE_PROCESS"
  ),
  r(
    "ESTATE_PORTFOLIO_BY_COUNTRY",
    "src/lib/constants/cabinetEstates.ts",
    "institutionsFacts",
    "CC_ESTATE_PORTFOLIO"
  ),
  r(
    "GROUPS",
    "src/lib/constants/cabinetPositionGroups.ts",
    "institutionsFacts",
    "CC_CABINET_GROUPS"
  ),
  r(
    "ENERGY_POSITION_BY_COUNTRY",
    "src/lib/constants/cabinetEnergy.ts",
    "institutionsFacts",
    "CC_CABINET_SEAT_IDS",
    "CC_CABINET_SEAT_IDS.energy"
  ),
  r(
    "INFRA_POSITION_BY_COUNTRY",
    "src/lib/constants/cabinetInfra.ts",
    "institutionsFacts",
    "CC_CABINET_SEAT_IDS",
    "CC_CABINET_SEAT_IDS.infrastructure"
  ),
  r(
    "DEFENSE_POSITION_BY_COUNTRY",
    "src/lib/constants/military.ts",
    "institutionsFacts",
    "CC_CABINET_SEAT_IDS",
    "CC_CABINET_SEAT_IDS.defense"
  ),
  r(
    "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY",
    "src/lib/constants/internationalOrganizations.ts",
    "institutionsFacts",
    "CC_CABINET_SEAT_IDS",
    "CC_CABINET_SEAT_IDS.foreignAffairs"
  ),
  r(
    "TRADE_MINISTER_POSITION_BY_COUNTRY",
    "src/lib/constants/internationalOrganizations.ts",
    "institutionsFacts",
    "CC_CABINET_SEAT_IDS",
    "CC_CABINET_SEAT_IDS.tradeMinister"
  ),
  r(
    "MILITARY_BRANCHES_BY_COUNTRY",
    "src/lib/constants/military.ts",
    "institutionsFacts",
    "CC_MILITARY_BRANCHES"
  ),
  r(
    "MILITARY_COUNTRY_SCALE",
    "src/lib/constants/military.ts",
    "institutionsFacts",
    "CC_MILITARY_SCALE"
  ),
  r(
    "ORDERS_OF_BATTLE",
    "src/lib/seeds/reference/ordersOfBattle.ts",
    "institutionsFacts",
    "CC_ORDERS_OF_BATTLE"
  ),

  // ---- economy ------------------------------------------------------------
  r(
    "COUNTRY_CURRENCY_MAP",
    "src/lib/constants/currencies.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.currencyCode"
  ),
  r(
    "ECONOMIC_BASELINES",
    "src/lib/constants/currencies.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.economicBaseline"
  ),
  r(
    "MONETARY_BASELINES",
    "src/lib/constants/currencies.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.monetary.baseline"
  ),
  r(
    "COUNTRY_SECTOR_WEIGHTS",
    "src/lib/seeds/reference/sectorSeedWeights.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.sectorWeights.base"
  ),
  r(
    "REP_ECON",
    "src/lib/era/legislationCostCatalog.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.repEcon"
  ),
  r(
    "COST_SCALE_ANCHORS",
    "src/lib/budget/costs.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.costScaleAnchors"
  ),
  r(
    "NATIONAL_POLICY_STATE_IDS",
    "src/lib/policy/nationalStateId.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.nationalPolicyStateId"
  ),
  r(
    "LEGISLATION_COUNTRY_SCOPES",
    "src/lib/policy/nationalPolicyRecords.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.legislationScope"
  ),
  r(
    "TREASURY_PS_RATE_BY_COUNTRY",
    "src/lib/politicalStrength/strengthConstants.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.tax.treasuryPsRate"
  ),
  r(
    "PLAYER_PAYOUT_CAP_PER_TURN",
    "src/lib/treasury/payoutCapValues.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.payoutCapPerTurn"
  ),
  r(
    "DEFAULT_STRATEGIC_SECTORS",
    "src/lib/seeds/reference/strategicSectors.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.strategicSectors"
  ),
  r(
    "SOVEREIGN_CORP_LEGAL_STRUCTURE",
    "src/lib/seeds/reference/budgets.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.sovereignCorpLegalStructure"
  ),
  r(
    "NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY",
    "src/lib/turn/gdpGrowth.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.tax.neutralFederalSalesTax"
  ),
  r(
    "NEUTRAL_STATE_SALES_TAX_BY_COUNTRY",
    "src/lib/turn/gdpGrowth.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.tax.neutralStateSalesTax"
  ),

  // ---- geography ----------------------------------------------------------
  r(
    "COUNTRY_CONTINENT",
    "src/lib/constants/countryContinents.ts",
    "geographyFacts",
    "CC_CONTINENT"
  ),
  r(
    "COUNTRY_TO_ISO_NUMERIC",
    "src/lib/constants/countryIso.ts",
    "geographyFacts",
    "CC_ISO_NUMERIC"
  ),
  r("COUNTRY_REGIONS", "src/lib/world/worldEntityManifest.ts", "geographyFacts", "CC_WORLD_REGION"),
  r(
    "COUNTRY_UN_MEMBER_SINCE",
    "src/lib/world/worldEntityManifest.ts",
    "geographyFacts",
    "CC_UN_MEMBER_SINCE"
  ),
  r(
    "NPP_CAPITAL_STATES",
    "src/lib/admin/spawnNppCorporation.ts",
    "geographyFacts",
    "CC_NPP_CAPITAL_STATE"
  ),
  r("STATE_ADJACENCY", "src/lib/constants/stateAdjacency.ts", "geographyFacts", "CC_ADJACENCY_MAP"),
  r(
    "CONSCRIPTION_SEED",
    "src/lib/demographics/conscription.ts",
    "geographyFacts",
    "CC_CONSCRIPTION"
  ),
  /*
   * ⚠ EASY TO FORGET, BECAUSE GERMANY FORWARDED WITHOUT IT. Germany's map
   * config had to be RELOCATED as source (it carries a function), and relocating
   * it forwarded the registry as a side effect -- so the absence of this row went
   * unnoticed until China, whose config is plain data, came through and left
   * `COUNTRY_MAP_REGISTRY.CN` as a second copy. The runtime harness is what said
   * so; the rewire tool reported nothing, because a row that is not in this
   * table cannot report anything.
   */
  r(
    "COUNTRY_MAP_REGISTRY",
    "src/lib/commodity-map/commodityMapRegistry.ts",
    "geographyFacts",
    "CC_MAP_REGISTRY"
  ),
  r("COUNTRY_ANCHOR", "src/lib/maps/countryAnchors.ts", "geographyFacts", "CC_MAP_ANCHOR"),
  r(
    "MEDIAN_INCOME_THRESHOLDS",
    "src/lib/utils/metricScoring.ts",
    "geographyFacts",
    "CC_MEDIAN_INCOME_THRESHOLDS"
  ),
  r(
    "POPULATION_MULTIPLIERS",
    "src/lib/seeds/reference/era1991PopulationMultipliers.ts",
    "geographyFacts",
    "CC_POPULATION_MULTIPLIERS"
  ),
  r(
    "CENSUS_BUNDLES",
    "src/lib/seeds/regionCensusData.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.censusBundles"
  ),

  /* ---- era siblings and bundle wrappers ------------------------------------
   *
   * ⚠ THESE WERE DUPLICATES NOBODY WAS CHECKING. The harness covered 53
   * registries; the snapshot captures 93. In the 40 it did not cover, 34 still
   * held per-country values -- 495 country-entries. Most were WRAPPER-ONLY: the
   * registry's `{ "1953-default": bundle }` object was a second container around
   * the SAME inner objects the folder holds. `CN_ECONOMY.sectorWeights.byEra`
   * and `COUNTRY_SECTOR_WEIGHTS_1953.CN` were deep-equal and not the same
   * object, which is the exact state this whole rework exists to remove.
   *
   * Each row below was proved before it was written: the folder's value at the
   * path was compared against the registry's for every converted country, by
   * key set and then by reference per key. Nothing here differed.
   */
  r(
    "COUNTRY_SECTOR_WEIGHTS_1979",
    "src/lib/seeds/reference/sectorSeedWeights1979.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.sectorWeights.byEra["1979"]'
  ),
  r(
    "COUNTRY_SECTOR_WEIGHTS_1991",
    "src/lib/seeds/reference/sectorSeedWeights1991.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.sectorWeights.byEra["1991"]'
  ),
  r(
    "MONETARY_BASELINES_1953",
    "src/lib/constants/monetaryEra.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.monetary.byEra["1953"]'
  ),
  r(
    "MONETARY_BASELINES_1971",
    "src/lib/constants/monetaryEra.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.monetary.byEra["1971"]'
  ),
  r(
    "MONETARY_BASELINES_1979",
    "src/lib/constants/monetaryEra.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.monetary.byEra["1979"]'
  ),
  r(
    "MONETARY_BASELINES_1991",
    "src/lib/constants/monetaryEra.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.monetary.byEra["1991"]'
  ),
  r(
    "SURFACES",
    "src/lib/constants/parliamentaryExecutiveSurface.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.parliamentarySurface"
  ),
  r(
    "REGION_CENSUS_LABELS",
    "src/lib/constants/regionCensusLabels.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.regionCensusLabels"
  ),
  r(
    "STATE_DISPLAY_NAMES",
    "src/lib/commodity-map/commodityRegionMappings.ts",
    "identity",
    "CC_IDENTITY",
    "CC_IDENTITY.stateDisplayNames"
  ),
  r(
    "METRIC_PRESET_BUNDLES",
    "src/lib/seeds/metricPresets.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.metricPresets"
  ),
  r(
    "POPULATION_ANCHOR_BUNDLES",
    "src/lib/seeds/populationAnchors.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.populationAnchors"
  ),
  r(
    "FULL_ERA_REGION_BUNDLES",
    "src/lib/admin/seedDiagnostic/regionBundles.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.regionBundles"
  ),
  r(
    "REGION_NAME_MAPS",
    "src/lib/admin/seed/seedSeats.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.regionNames"
  ),

  /* ---- the last tranche -----------------------------------------------------
   *
   * ⚠ THESE TWO NEEDED NO CONTRACT CHANGE AT ALL. `geography.rawMetrics` and
   * `geography.nonPartyIndependentBias` have been folder fields since the
   * contract was written, and every folder already populates them -- Japan
   * forwarded to both, and nobody wired the other 28 countries. The data was
   * single-sourced in the folder and duplicated in the registry at the same
   * time, which is the state that looks finished from either side alone.
   */
  r(
    "RAW_BUNDLES",
    "src/lib/states/conditions/seedMetricsLoader.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.rawMetrics"
  ),
  r(
    "NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY",
    "src/lib/turn/partyOrg/pacingConstants.ts",
    "geographyFacts",
    "CC_NON_PARTY_INDEPENDENT_BIAS"
  ),
  r(
    "GDP_DENOMINATION_1953",
    "src/lib/seeds/reference/gdpDenomination.ts",
    "economy",
    "CC_ECONOMY",
    "CC_ECONOMY.gdpDenomination1953"
  ),
  r(
    "COUNTRY_SECTOR_WEIGHTS_1953",
    "src/lib/seeds/reference/sectorSeedWeights1953.ts",
    "economy",
    "CC_ECONOMY",
    'CC_ECONOMY.sectorWeights.byEra["1953"]'
  ),
  r(
    "REGIONAL_BILL_ASSENT_OFFICE_KEY",
    "src/lib/constants/countries.ts",
    "institutionsFacts",
    "CC_REGIONAL_BILL_ASSENT_OFFICE_KEY"
  ),
  /*
   * ⚠ THE FACTS MODULE, NOT THE GEOGRAPHY. `metricCatalog.ts` is
   * CLIENT-REACHABLE. Pointing it at `CC_GEOGRAPHY` shipped seventeen countries'
   * census, metric and region bundles to the browser, and
   * `clientSafeLeafModules.test.ts` failed with all seventeen named.
   */
  r("INCOME_ANCHORS", "src/lib/era/metricCatalog.ts", "geographyFacts", "CC_INCOME_ANCHORS"),
  r(
    "TARGETS",
    "src/lib/seeds/calibration/targets.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.calibrationTargets"
  ),
  r(
    "COUNTRY_ERA1991_PATCHES",
    "src/lib/states/conditions/countryEra1991Patches.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.era1991Patches"
  ),
  r(
    "HAZARD_GROUPS",
    "src/lib/crises/regionHazards.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.hazardGroups"
  ),
  r(
    "REGION_DEMOGRAPHIC_CATEGORY_IDS",
    "src/app/country/[code]/region/[id]/regionData.ts",
    "geography",
    "CC_GEOGRAPHY",
    "CC_GEOGRAPHY.demographicCategoryIds"
  ),

  // ---- elections ----------------------------------------------------------
  r(
    "SPAWN_ELECTIONS_REGISTRY",
    "src/lib/turn/perpetualElections/registry.ts",
    "elections",
    "CC_ELECTIONS",
    "CC_ELECTIONS.spawn"
  ),
];

function r(registry: string, file: string, module: string, binding: string, expr?: string): Rewire {
  return { registry, file, module, binding, expr: expr ?? binding };
}

/**
 * The value of `key` inside the object literal `registry`, as a source span.
 *
 * ⚠ BRACE-MATCHED, NOT LINE-MATCHED. Most entries are one line, but
 * `ECONOMIC_BASELINES.DE` is a nested object forty lines long and
 * `ORDERS_OF_BATTLE.UK` is an array of arrays. A line-based replace would leave
 * the tail of the old value behind as syntax errors, or -- worse, because it
 * compiles -- as the tail of the NEXT country's entry.
 */
/**
 * The source with every comment blanked out, character for character.
 *
 * ⚠ AN APOSTROPHE IN A COMMENT IS A QUOTE TO A NAIVE SCANNER. `ORDERS_OF_BATTLE`
 * documents Germany's entry with "The Bundeswehr's establishment shape", and the
 * scanner read that apostrophe as the start of a string literal, then skipped
 * everything up to the next one -- swallowing the `DE:` key and reporting
 * Germany as ABSENT FROM A REGISTRY IT HAS SIXTEEN LINES IN. A miss like that is
 * silent: nothing fails, the entry simply keeps its literal forever.
 *
 * Blanking preserves offsets, so spans found here slice correctly out of the
 * original text.
 */
/** The source with string CONTENTS blanked, offsets preserved. */
function maskStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) {
        out += quote;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function maskComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function findEntry(raw: string, registry: string, key: string): [number, number] | null {
  const src = maskComments(raw);
  const decl = src.search(new RegExp(`(const|let)\\s+${registry}\\b`));
  if (decl < 0) return null;
  /*
   * ⚠ THE INITIALISER'S BRACE, NOT THE FIRST ONE. `export const REP_ECON:
   * Record<string, { gdp: number }> = {` opens a brace inside the TYPE, and
   * taking that one walked the type annotation instead of the object --
   * reporting three registries Japan demonstrably forwards as "absent". The
   * control run is what caught it: a country known to be fully rewired must
   * come back with nothing to do.
   */
  const eq = src.indexOf("=", decl);
  const open = eq < 0 ? -1 : src.indexOf("{", eq);
  if (open < 0) return null;

  let depth = 0;
  let i = open;
  let inStr: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && src.startsWith(key, i)) {
      // A key match must be a KEY: preceded by a boundary, followed by a colon.
      const before = src[i - 1];
      const after = src.slice(i + key.length).match(/^\s*:/);
      if (after && (before === "\n" || before === " " || before === "," || before === '"')) {
        const colon = src.indexOf(":", i + key.length);
        let j = colon + 1;
        let d2 = 0;
        let s2: string | null = null;
        for (; j < src.length; j++) {
          const ch = src[j];
          if (s2) {
            if (ch === "\\") j++;
            else if (ch === s2) s2 = null;
            continue;
          }
          if (ch === '"' || ch === "'" || ch === "`") {
            s2 = ch;
            continue;
          }
          if (ch === "{" || ch === "[" || ch === "(") d2++;
          else if (ch === "}" || ch === "]" || ch === ")") {
            if (d2 === 0) break;
            d2--;
          } else if (ch === "," && d2 === 0) break;
        }
        return [colon + 1, j];
      }
    }
  }
  return null;
}

function ensureImport(src: string, binding: string, from: string): string {
  if (new RegExp(`\\b${escapeRegExp(binding)}\\b[^\\n]*from "${escapeRegExp(from)}"`).test(src))
    return src;
  if (src.includes(`from "${from}"`)) {
    // Same module already imported: widen the existing clause.
    return src.replace(
      new RegExp(`import \\{([^}]*)\\} from "${escapeRegExp(from)}";`),
      (_m, names: string) =>
        `import { ${names.trim().replace(/,$/, "")}, ${binding} } from "${from}";`
    );
  }
  const imports = [...src.matchAll(/^import [\s\S]*?;\n/gm)];
  const line = `import { ${binding} } from "${from}";\n`;
  if (imports.length === 0) return line + src;
  const last = imports[imports.length - 1];
  return (
    src.slice(0, last.index! + last[0].length) + line + src.slice(last.index! + last[0].length)
  );
}

/**
 * Deletes what the rewire orphaned: the literal the registry used to point at.
 *
 * ⚠ THE ORPHAN IS THE WHOLE POINT, AND LINT DOES NOT SEE IT. Rewiring
 * `STATE_ADJACENCY.DE` to the folder left `const DE_ADJACENCY: AdjacencyMap =
 * {...}` sitting three hundred lines above, unreferenced -- a second copy of
 * exactly the data this work exists to de-duplicate, and `no-unused-vars`
 * reported nothing. Leaving it would have been worse than not rewiring at all:
 * two declarations, one of them invisible and free to drift.
 *
 * ⚠ ONE OCCURRENCE MEANS DEAD. A name that appears exactly once in the file,
 * outside comments and strings, appears only in its own declaration. That is
 * conservative: anything still referenced anywhere is left alone, so the pass
 * can never remove something load-bearing.
 */
function pruneOrphans(raw: string, _CC: string): [string, string[]] {
  const removed: string[] = [];
  let src = raw;
  for (let pass = 0; pass < 4; pass++) {
    const masked = maskComments(src);
    const names = new Set<string>();
    /*
     * ⚠ NOT JUST `<CC>_` NAMES. Repointing the eight economy-tier countries'
     * EXECUTIVE_SURFACE entries orphaned `PRESIDENTIAL_ACTS` in
     * `executiveSurface.ts` -- a local const several of them shared, whose name
     * carries no country at all. Scanning only `<CC>_` names left it for lint to
     * find. Every top-level const is a candidate now; the one-occurrence rule
     * and the export check are what keep that safe.
     */
    for (const m of masked.matchAll(/^(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm))
      names.add(m[1]);
    for (const m of masked.matchAll(/^import \{([^}]*)\} from/gm))
      for (const n of m[1].split(",")) {
        const t = n
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (t) names.add(t);
      }

    let cut = false;
    for (const name of names) {
      /*
       * ⚠ STRINGS ARE MASKED TOO, BECAUSE A MODULE PATH CONTAINS ITS OWN BINDING.
       * `import { walRegionCensusData } from "@/lib/seeds/wal/walRegionCensusData"`
       * mentions the name TWICE -- once as the binding, once inside the path --
       * so the one-occurrence rule never fired, and dozens of unused imports
       * survived every prune. Lint found them; the prune never could.
       */
      const uses = [...maskStrings(masked).matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))]
        .length;
      if (uses !== 1) continue;

      const declRe = new RegExp(`^(?:export\\s+)?(?:const|let)\\s+${escapeRegExp(name)}\\b`, "m");
      const dm = declRe.exec(masked);
      if (dm) {
        if (/^export/.test(dm[0])) continue; // exported: other files may use it
        const end = endOfStatement(masked, dm.index);
        src = src.slice(0, dm.index) + src.slice(end);
        removed.push(name);
        cut = true;
        break;
      }
      const im = new RegExp(
        `^import \\{[^}]*\\b${escapeRegExp(name)}\\b[^}]*\\} from "[^"]+";\\n`,
        "m"
      ).exec(masked);
      if (im) {
        const clause = src.slice(im.index, im.index + im[0].length);
        const inner = /\{([^}]*)\}/.exec(clause)![1];
        const kept = inner
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !new RegExp(`\\b${escapeRegExp(name)}$`).test(s));
        const next = kept.length === 0 ? "" : clause.replace(/\{[^}]*\}/, `{ ${kept.join(", ")} }`);
        src = src.slice(0, im.index) + next + src.slice(im.index + im[0].length);
        removed.push(name);
        cut = true;
        break;
      }
    }
    if (!cut) break;
  }
  return [src, removed];
}

/** The end of the `const X = ...;` statement beginning at `start`. */
function endOfStatement(masked: string, start: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = start; i < masked.length; i++) {
    const c = masked[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) {
      return masked[i + 1] === "\n" ? i + 2 : i + 1;
    }
  }
  return masked.length;
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const countries = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
if (countries.length === 0) {
  console.error("usage: npx tsx scripts/countries/rewire-country.ts <CC>... [--dry]");
  process.exit(1);
}

let changed = 0;
let already = 0;
let absent = 0;
let orphans = 0;

for (const CC of countries) {
  const cc = CC.toLowerCase();
  const byFile = new Map<string, Rewire[]>();
  for (const w of R) {
    if (!byFile.has(w.file)) byFile.set(w.file, []);
    byFile.get(w.file)!.push(w);
  }

  for (const [file, entries] of byFile) {
    if (!existsSync(file)) {
      console.log(`SKIP  ${file} does not exist`);
      continue;
    }
    let src = readFileSync(file, "utf8");
    const before = src;

    for (const w of entries) {
      const expr = w.expr.replace(/CC/g, CC);
      const binding = w.binding.replace(/CC/g, CC);
      const from = `@/lib/countries/${cc}/${w.module}`;
      const span = findEntry(src, w.registry, CC);
      if (!span) {
        /*
         * ⚠ "NO COLON" IS TWO DIFFERENT FACTS. Either the country has no entry
         * at all, which is a real gap this tool must not paper over, or the
         * entry is ES shorthand -- `LEGISLATIVE_PROCESS` holds `JP,` next to a
         * `const JP = JP_LEGISLATIVE_PROCESS` above it. Rewriting shorthand to
         * `JP: ...` would orphan that const and break lint, so it is reported
         * for a human rather than guessed at.
         */
        const shorthand = new RegExp(`\\n\\s*${escapeRegExp(CC)},`).test(
          src.slice(src.search(new RegExp(`(const|let)\\s+${w.registry}\\b`)))
        );
        console.log(
          shorthand
            ? `  shorthand ${w.registry}.${CC} -- \`${CC},\` with a local const; rewire that const by hand`
            : `  absent   ${w.registry}.${CC} -- no entry, leaving the gap as it is`
        );
        absent++;
        continue;
      }
      const current = src.slice(span[0], span[1]).trim();
      /*
       * ⚠ ANY ROUTE INTO THE FOLDER COUNTS AS DONE -- BUT IT MUST REACH THE
       * FOLDER. `JP_GEOGRAPHY.conscription` and `JP_CONSCRIPTION` are the same
       * object by two names, and rewriting one into the other is churn that
       * reads like a fix in the diff. A name alone is not evidence, though:
       * `STATE_ADJACENCY.DE` read `DE: DE_ADJACENCY`, which looks exactly like a
       * forwarder and is a const declared forty lines above in the same file.
       * So the identifier is resolved: it counts only if it is IMPORTED from
       * this country's folder.
       */
      const head = /^([A-Za-z0-9_$]+)/.exec(current)?.[1];
      const fromFolder =
        head !== undefined &&
        new RegExp(
          `import \\{[^}]*\\b${escapeRegExp(head)}\\b[^}]*\\} from "@/lib/countries/${escapeRegExp(cc)}/`,
          "s"
        ).test(src);
      if (current === expr || fromFolder) {
        already++;
        continue;
      }

      /*
       * ⚠ THE FOLDER MUST ACTUALLY EXPORT IT. `COUNTRY_UN_MEMBER_SINCE.DE` is
       * `undefined` with a comment saying the FRG was admitted in 1973, so
       * `de/geographyFacts.ts` deliberately declares no `DE_UN_MEMBER_SINCE`.
       * Rewiring the entry anyway would import a binding that does not exist --
       * and because `no-undef` is off for TypeScript, only `npm run typecheck`
       * would have caught it.
       */
      const modFile = `src/lib/countries/${cc}/${w.module}.ts`;
      if (
        !existsSync(modFile) ||
        !readFileSync(modFile, "utf8").includes(`export const ${binding}`)
      ) {
        console.log(`  no binding ${w.registry}.${CC} -- ${modFile} declares no ${binding}`);
        absent++;
        continue;
      }

      src = src.slice(0, span[0]) + ` ${expr}` + src.slice(span[1]);
      src = ensureImport(src, binding, from);
      console.log(
        `  rewired  ${w.registry}.${CC} -> ${expr}` +
          (current.length > 60 ? ` (was ${current.length} chars)` : ` (was ${current})`)
      );
      changed++;
    }

    /*
     * The prune runs whether or not this pass rewired anything: an orphan left
     * by an EARLIER run is still an orphan, and the tool is meant to be
     * re-runnable until it reports nothing to do.
     */
    const [pruned, removed] = pruneOrphans(src, CC);
    for (const name of removed) console.log(`  pruned   ${name} from ${file} (now unreferenced)`);
    orphans += removed.length;
    src = pruned;

    if (src !== before && !DRY) writeFileSync(file, src, "utf8");
  }
}

console.log(
  `\n${changed} entries rewired, ${already} already forwarding, ${absent} absent from their ` +
    `registry, ${orphans} orphaned declarations pruned.` +
    (DRY ? " (dry run, nothing written)" : "")
);
