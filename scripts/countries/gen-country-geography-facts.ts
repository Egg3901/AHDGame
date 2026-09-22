/**
 * Writes `src/lib/countries/<cc>/geographyFacts.ts` from the pre-move snapshot.
 *
 *   npx tsx scripts/countries/gen-country-geography-facts.ts US
 *
 * ⚠ THIS GENERATOR EXISTS BECAUSE THE HAND-WRITTEN VERSION WAS WRONG SIX TIMES
 * IN ONE FILE. A first draft of `us/geographyFacts.ts` was typed out from
 * memory of the registry shapes. Checked against the snapshot it had:
 *
 *   nonPartyIndependentBias   0.06          actual 2.3333333333333335
 *   medianIncomeThresholds    {good, bad}   actual {best, worst}, both values wrong
 *   core5Normals              {era: "1953"} actual {year: 1953}, every value wrong
 *   mapAnchor                 [-98, 39]     actual [-98.5, 39.8]
 *   worldRegion               "Americas"    actual "americas"
 *   adjacency                 {} (a stub)   actual 51 states
 *
 * Every one typechecks. Two are plausible numbers that are simply not this
 * country's. That is the transcription risk the plan names as its single
 * largest, arriving exactly as predicted, in the module that looked small enough
 * to type by hand.
 *
 * ⚠ THE OUTPUT MUST STAY FREE OF VALUE IMPORTS. It is the light half of the
 * geography pair; `geography.ts` pulls every era of census and metric data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const FORCE = process.argv.includes("--force");

if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY)) {
  console.error("usage: npx tsx scripts/countries/gen-country-geography-facts.ts <CC> [--force]");
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
const OUT = `src/lib/countries/${lower}/geographyFacts.ts`;

if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT} does not exist. Emit it before rewiring any registry.`);
  process.exit(1);
}
if (existsSync(OUT) && !FORCE) {
  console.error(`${OUT} exists. Pass --force to overwrite it.`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;

function v(name: string): string {
  const e = snap[name];
  if (!e) throw new Error(`${name} is not in ${SNAPSHOT}.`);
  if (e.shape === "absent") {
    throw new Error(
      `${name} has no ${COUNTRY} entry. An unexported registry also snapshots as ` +
        `"absent" -- run check-snapshot-imports.ts before believing this.`
    );
  }
  return JSON.stringify(e.value, null, 2);
}

/**
 * Legitimately absent for some countries; emitted as an omitted key, never a default.
 *
 * ⚠ A NULL VALUE IS AN ABSENCE, AND A `function-valued` SHAPE IS NOT DATA AT
 * ALL. The extractor records `registry[COUNTRY] ?? null`, so a key present with
 * an explicit `undefined` -- `DE: undefined, // FRG admitted 1973` -- arrives
 * here as null. Separately, an entry CONTAINING FUNCTIONS cannot be serialised,
 * so the emitter marks it `function-valued` and stores null; Germany's map
 * config has a `featureIdExtractor` arrow and lands in exactly that state.
 * Emitting either as the literal `null` produced `Type 'null' is not assignable`
 * -- the right answer for both is to omit the key and say so.
 */
function maybe(name: string): string | null {
  const e = snap[name];
  if (!e || e.shape === "absent") return null;
  if (e.value === null || e.value === undefined) return null;
  if (e.shape === "function-valued") return null;
  return JSON.stringify(e.value, null, 2);
}

/** The inverse ISO map is `{ "840": "US" }`; the folder wants just the code. */
const isoInverse = snap.ISO_NUMERIC_TO_COUNTRY?.value as Record<string, string> | undefined;
const isoCodes = isoInverse ? Object.keys(isoInverse) : [];
const isoForward = JSON.parse(v("COUNTRY_TO_ISO_NUMERIC")) as string;

/**
 * ⚠ THREE OUTCOMES, NOT TWO, AND ONLY ONE OF THEM IS AN ERROR.
 *
 *   agree   the forward code maps back to this country. The ordinary case.
 *   shared  the forward code is real but maps back to SOMEONE ELSE. Scotland
 *           and Wales both carry "826", which is the United Kingdom's, because
 *           neither has an ISO code of its own. The pair is not broken; the
 *           code simply is not theirs to own.
 *   none    no code at all. The Baltic States carry "", which is not an ISO
 *           code and must not be written into a folder as though it were.
 *
 * The first version threw on all three, which would have stopped three real
 * countries dead on a fact about ISO rather than about this codebase.
 */
const isoShared = isoForward !== "" && isoCodes.length === 0;
const isoNone = isoForward === "";
if (!isoNone && !isoShared && (isoCodes.length !== 1 || isoCodes[0] !== isoForward)) {
  throw new Error(
    `The ISO pair disagrees: COUNTRY_TO_ISO_NUMERIC says "${isoForward}" but ` +
      `ISO_NUMERIC_TO_COUNTRY holds ${JSON.stringify(isoCodes)}. They are two ` +
      `registries describing one fact and must be moved together.`
  );
}

const unMemberSince = maybe("COUNTRY_UN_MEMBER_SINCE");
const mapRegistry = maybe("COUNTRY_MAP_REGISTRY");
const nonPartyBias = maybe("NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY");
const medianIncome = maybe("MEDIAN_INCOME_THRESHOLDS");
const core5 = maybe("CORE5_NORMALS");
const popMultipliers = maybe("POPULATION_MULTIPLIERS");
const conscription = maybe("CONSCRIPTION_SEED");
const incomeAnchors = maybe("INCOME_ANCHORS");

const out = `import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
${
  mapRegistry
    ? 'import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";'
    : "// No CountryMapConfig import: this country's map config is relocated source,\n" +
      "// so nothing here is typed by it."
}
import type { Continent } from "@/lib/constants/countryContinents";${
  conscription ? '\nimport type { ConscriptionPolicy } from "@/lib/demographics/conscription";' : ""
}
${core5 || incomeAnchors ? 'import type { NormalAnchor } from "@/lib/era/metricCatalog";' : ""}
${medianIncome ? 'import type { ScoreThreshold } from "@/lib/utils/metricScoring";' : ""}
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where ${COUNTRY} is.
 *
 * ⚠ GENERATED FROM \`__snapshots__/${lower}.pre-move.json\`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts ${COUNTRY} --force
 *
 * A hand-written draft of this file got six values wrong, including an
 * independent-bias of 0.06 where the registry says 2.33 and a threshold object
 * with the wrong KEYS. All six typechecked. Do not edit values here by hand.
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair;
 * \`geography.ts\` imports every era of census, metric and region data as values.
 * A registry that forwards to the heavy module for one string ships all of it to
 * the browser -- which shipped once already, when \`countryContinents.ts\` started
 * pulling 108 KB per bundle for a continent name.
 *
 * ⚠ THE ISO PAIR IS TWO REGISTRIES DESCRIBING ONE FACT.
 * \`COUNTRY_TO_ISO_NUMERIC\` maps ${COUNTRY} to the code and
 * \`ISO_NUMERIC_TO_COUNTRY\` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const ${COUNTRY}_CONTINENT: Continent = ${v("COUNTRY_CONTINENT")};

${
  isoNone
    ? `/* No ${COUNTRY}_ISO_NUMERIC: this entity has no ISO 3166-1 code, and the registry
   says so with an empty string rather than a number. Writing "" into the folder
   would put a value where there is none. */`
    : isoShared
      ? `/**
 * ISO 3166-1 numeric -- SHARED, not owned. \`ISO_NUMERIC_TO_COUNTRY\` maps this
 * code back to a DIFFERENT country, because ${COUNTRY} has no code of its own and
 * carries its parent state's. A lookup by code will not return ${COUNTRY}.
 */
export const ${COUNTRY}_ISO_NUMERIC = ${v("COUNTRY_TO_ISO_NUMERIC")};`
      : `/** ISO 3166-1 numeric. \`ISO_NUMERIC_TO_COUNTRY\` holds the inverse entry. */
export const ${COUNTRY}_ISO_NUMERIC = ${v("COUNTRY_TO_ISO_NUMERIC")};`
}
${unMemberSince ? `\nexport const ${COUNTRY}_UN_MEMBER_SINCE = ${unMemberSince};\n` : ""}
export const ${COUNTRY}_WORLD_REGION: WorldEntityRegion = ${v("COUNTRY_REGIONS")};

/** Where an NPP corporation is seated when it has no other home. */
export const ${COUNTRY}_NPP_CAPITAL_STATE = ${v("NPP_CAPITAL_STATES")};

${
  nonPartyBias
    ? `/** Independent-bias nudge for the non-party bucket. */
export const ${COUNTRY}_NON_PARTY_INDEPENDENT_BIAS = ${nonPartyBias};`
    : `/* No ${COUNTRY}_NON_PARTY_INDEPENDENT_BIAS: the registry has no ${COUNTRY} entry, and
   \`nonPartyIndependentBias\` is optional in the contract. A country with no nudge
   is not a country nudged by zero. */`
}

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const ${COUNTRY}_MAP_ANCHOR: [number, number] = ${v("COUNTRY_ANCHOR")};

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
${medianIncome ? `export const ${COUNTRY}_MEDIAN_INCOME_THRESHOLDS: ScoreThreshold = ${medianIncome};` : `/* No ${COUNTRY}_MEDIAN_INCOME_THRESHOLDS: no row in the registry. */`}
${
  conscription
    ? `\n/** Conscription policy at seed time. */\nexport const ${COUNTRY}_CONSCRIPTION: ConscriptionPolicy = ${conscription};\n`
    : ""
}
/**
 * Core-5 metric normals, keyed by metric.
 *
 * ⚠ THE REGISTRY IS METRIC-FIRST, NOT COUNTRY-FIRST. \`CORE5_NORMALS\` is read as
 * \`CORE5_NORMALS.gdpGrowth.${COUNTRY}\`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed \`year\`,
 * a NUMBER -- not \`era\`, a string.
 */
${core5 ? `export const ${COUNTRY}_CORE5_NORMALS: Record<string, NormalAnchor[]> = ${core5};` : `/* No ${COUNTRY}_CORE5_NORMALS: the metric-first registry carries no ${COUNTRY} anchors. */`}

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR ${COUNTRY} THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map \`CA\`, \`DE\` and \`IN\` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const ${COUNTRY}_ADJACENCY_MAP: AdjacencyMap = ${v("STATE_ADJACENCY")};

${
  mapRegistry
    ? `/**
 * Map registry: where the country's map lives and how its features map to
 * region ids.
 *
 * ⚠ THIS IS NOT A COUPLE OF FIELDS. A hand-written draft of the geography
 * module stubbed it as \`{ countryId, anchor }\` and would have broken the map
 * outright: the real record carries \`name\`, \`overviewPath\`, \`mapPath\`,
 * \`hasRegionMap\`, \`geoUrl\` and a \`featureIdToStateId\` table with one entry per
 * region. Guessing the shape of a config object is the same failure as guessing
 * a value, and it typechecks just as readily behind a cast.
 */
export const ${COUNTRY}_MAP_REGISTRY: CountryMapConfig = ${mapRegistry};`
    : `/*
 * No \`${COUNTRY}_MAP_REGISTRY\` here, deliberately.
 *
 * ⚠ THE SNAPSHOT COULD NOT HOLD IT. ${COUNTRY}'s entry in COUNTRY_MAP_REGISTRY
 * carries a \`featureIdExtractor\` function, which JSON cannot express, so the
 * emitter recorded the shape as \`function-valued\` with a null value. Emitting
 * that null would have produced a map config of \`null\` that satisfies a cast
 * and breaks the map at runtime.
 *
 * The block is RELOCATED as source instead -- see \`./data/${lower}MapConfig.ts\`.
 */`
}

/**
 * 1991-era cohort multipliers.
 *
 * ⚠ 1991 ONLY. \`POPULATION_MULTIPLIERS\` lives in \`stateDemographics1991.ts\`
 * and describes how that era's cohorts differ from the modern ones. It says
 * nothing about any other preset, and a country missing from it passes through
 * unchanged at 1.0 rather than taking someone else's numbers.
 */
${
  incomeAnchors
    ? `/**
 * Income anchors by year.
 *
 * ⚠ IN THE LIGHT MODULE ON PURPOSE. \`metricCatalog.ts\` reads these and is
 * CLIENT-REACHABLE. Pointing it at \`geography.ts\` instead shipped seventeen
 * countries' census, metric and region bundles into the browser -- the same
 * failure \`countryContinents.ts\` had when it started pulling 108 KB for one
 * string.
 */
export const ${COUNTRY}_INCOME_ANCHORS: NormalAnchor[] = ${incomeAnchors};`
    : `/* No ${COUNTRY}_INCOME_ANCHORS: the registry has no ${COUNTRY} row. */`
}

/*
 * ⚠ THESE TWO ARE INDEPENDENT, AND NESTING THEM COST ELEVEN COUNTRIES. The
 * income-anchor block was first written INSIDE the population-multiplier
 * ternary, so a country with anchors but no 1991 cohort row -- France, Austria,
 * East Germany and eight others -- emitted neither. Typecheck caught it only
 * because metricCatalog.ts had already been repointed at the missing export.
 */
${
  popMultipliers
    ? `export const ${COUNTRY}_POPULATION_MULTIPLIERS: Record<string, number> = ${popMultipliers};`
    : `/* No ${COUNTRY}_POPULATION_MULTIPLIERS: the 1991 cohort table has no ${COUNTRY} row, so that era passes through at 1.0. */`
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, "utf8");
const adjacency = JSON.parse(v("STATE_ADJACENCY")) as Record<string, unknown>;
console.log(`wrote ${OUT}`);
console.log(
  `  iso             : ${isoNone ? "none (omitted)" : isoShared ? `${isoForward} (shared, not owned)` : `${isoForward} (pair agrees)`}`
);
console.log(`  adjacency keys  : ${Object.keys(adjacency).length}`);
console.log(
  `  core5 metrics   : ${core5 ? Object.keys(JSON.parse(core5) as object).join(", ") : "none"}`
);
if (!unMemberSince) console.log(`  omitted         : UN_MEMBER_SINCE (absent, not defaulted)`);
if (!mapRegistry)
  console.log(
    `  RELOCATE        : COUNTRY_MAP_REGISTRY is function-valued. Move ${COUNTRY}'s block out of
` +
      `                    src/lib/commodity-map/commodityMapRegistry.ts into
` +
      `                    src/lib/countries/${lower}/data/${lower}MapConfig.ts and forward it.`
  );
if (!conscription) console.log(`  omitted         : CONSCRIPTION_SEED (absent, not defaulted)`);
