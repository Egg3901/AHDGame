/**
 * Writes the four modules a country folder needs that a snapshot cannot express:
 * `geography.ts`, `institutions.ts`, `elections.ts` and `index.ts`.
 *
 *   npx tsx scripts/countries/gen-country-wiring.ts DE "Germany"
 *
 * ⚠ THE SNAPSHOT HOLDS VALUES; THIS FILE HOLDS WIRING. `geography.ts` must
 * REFERENCE the authored census and region modules rather than inline the
 * snapshot's copy of them -- an early revision of Japan's inlined them, deep
 * equality passed, and Japan quietly had two sources for every region. So this
 * generator discovers the modules on disk and emits imports.
 *
 * ⚠ IT DISCOVERS, IT DOES NOT ASSUME. Every module and export name is found by
 * reading the tree; a country missing one gets that key omitted rather than a
 * guessed import that fails at build time. What it cannot find, it reports, and
 * the omission is visible rather than silent.
 *
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT, NOT FROM THE FILENAMES. `deRegions`
 * is the 2019 bundle and `deRegions1953` is the 1953 one, but which presets a
 * country actually authors is recorded in CENSUS_BUNDLES and friends. Reading
 * the snapshot means a country that authors only three eras gets three keys,
 * not eight with five inventions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const DISPLAY = process.argv[3];
const FORCE = process.argv.includes("--force");

if (!COUNTRY || !/^[A-Z]{2}$/.test(COUNTRY) || !DISPLAY) {
  console.error(
    'usage: npx tsx scripts/countries/gen-country-wiring.ts <CC> "<Display Name>" [--force]'
  );
  process.exit(1);
}

const cc = COUNTRY.toLowerCase();
const DIR = `src/lib/countries/${cc}`;
const SNAPSHOT = `src/lib/countries/__snapshots__/${cc}.pre-move.json`;
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;

/** Where this country's authored data lives, in preference order. */
const DATA_DIRS = [`${DIR}/data`, `src/lib/seeds/${cc}`];

function findModule(stem: string): string | null {
  for (const dir of DATA_DIRS) {
    if (existsSync(`${dir}/${stem}.ts`)) {
      return dir.startsWith(DIR) ? `./data/${stem}` : `@/lib/seeds/${cc}/${stem}`;
    }
  }
  return null;
}

function exportsOf(stem: string): string[] {
  for (const dir of DATA_DIRS) {
    const p = `${dir}/${stem}.ts`;
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    return [...src.matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  }
  return [];
}

/** Preset -> the stem that holds it, e.g. "1953-default" -> "deRegions1953". */
function eraStems(base: string, presets: string[]): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const preset of presets) {
    const year = preset.slice(0, 4);
    for (const stem of [`${base}${year}`, base]) {
      const mod = findModule(stem);
      if (!mod) continue;
      const names = exportsOf(stem);
      // Prefer an export whose name carries the year, else the bare one.
      const exact = names.find((n) => n.endsWith(year));
      const bare = names.find((n) => n === stem || n === base);
      const picked = stem.endsWith(year) ? (exact ?? bare) : (exact ?? bare);
      if (picked) {
        out.push([preset, mod, picked]);
        break;
      }
    }
  }
  return out;
}

function presetsOf(registry: string): string[] {
  const e = snap[registry];
  if (!e || e.shape === "absent" || !e.value || typeof e.value !== "object") return [];
  return Object.keys(e.value as object);
}

const censusPresets = presetsOf("CENSUS_BUNDLES");
const metricPresets = presetsOf("METRIC_PRESET_BUNDLES");
const anchorPresets = presetsOf("POPULATION_ANCHOR_BUNDLES");
const regionPresets = presetsOf("FULL_ERA_REGION_BUNDLES");

const census = eraStems(`${cc}RegionCensusData`, censusPresets);
const metrics = eraStems(`${cc}MetricPresets`, metricPresets);
const anchors = eraStems(`${cc}PopulationAnchors`, anchorPresets);
const regions = eraStems(`${cc}Regions`, regionPresets);

const rawStem = `${cc}StateMetrics`;
const rawMod = findModule(rawStem);
const rawExport = exportsOf(rawStem)[0];

const imports = new Map<string, Set<string>>();
const addImport = (mod: string, name: string) => {
  if (!imports.has(mod)) imports.set(mod, new Set());
  imports.get(mod)!.add(name);
};
for (const [, mod, name] of [...census, ...metrics, ...anchors, ...regions]) addImport(mod, name);
if (rawMod && rawExport) addImport(rawMod, rawExport);

const factsNames = [
  "ADJACENCY_MAP",
  "CONSCRIPTION",
  "CONTINENT",
  "CORE5_NORMALS",
  "ISO_NUMERIC",
  "MAP_REGISTRY",
  "NON_PARTY_INDEPENDENT_BIAS",
  "NPP_CAPITAL_STATE",
  "POPULATION_MULTIPLIERS",
  "UN_MEMBER_SINCE",
  "WORLD_REGION",
]
  .map((n) => `${COUNTRY}_${n}`)
  .filter((n) => readFileSync(`${DIR}/geographyFacts.ts`, "utf8").includes(`export const ${n}`));

/**
 * Where `<CC>_MAP_REGISTRY` lives.
 *
 * ⚠ IT IS NOT ALWAYS IN THE FACTS. A country whose map entry carries a
 * `featureIdExtractor` cannot be snapshotted -- JSON has no function -- so its
 * block is relocated as source into `data/<cc>MapConfig.ts` and the facts file
 * omits it. Looking in only one place emitted an import of a binding that did
 * not exist.
 */
const mapFromData = existsSync(`${DIR}/data/${cc}MapConfig.ts`);
if (!mapFromData && !factsNames.includes(`${COUNTRY}_MAP_REGISTRY`)) {
  console.error(
    `Neither ${DIR}/geographyFacts.ts nor ${DIR}/data/${cc}MapConfig.ts declares ` +
      `${COUNTRY}_MAP_REGISTRY. Relocate the block before wiring the geography.`
  );
  process.exit(1);
}

const block = (entries: Array<[string, string, string]>) =>
  entries.map(([preset, , name]) => `  ${JSON.stringify(preset)}: ${name},`).join("\n");

const geography = `import type { CountryGeography } from "../contract";
${[...imports]
  .map(([mod, names]) => `import { ${[...names].sort().join(", ")} } from "${mod}";`)
  .sort()
  .join("\n")}
import {
${factsNames.map((n) => `  ${n},`).join("\n")}
} from "./geographyFacts";${mapFromData ? `\nimport { ${COUNTRY}_MAP_REGISTRY } from "./data/${cc}MapConfig";` : ""}

/**
 * Where ${DISPLAY} is, and who lives there.
 *
 * ⚠ HEAVY. Every era of census, metric and region data is imported as a VALUE. A
 * registry that needs one string imports \`./geographyFacts\` instead, which has
 * no value imports at all -- \`countryContinents.ts\` once held \`JP: "Asia"\` at
 * zero cost, was repointed at a heavy module, and began pulling 108 KB into
 * every client bundle that read a continent.
 *
 * ⚠ EVERY BUNDLE IS REFERENCED, NEVER INLINED, and \`===\` is what proves it. An
 * early revision of Japan's geography generated copies from the snapshot; deep
 * equality passed and Japan had two sources for every region.
 *
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. ${DISPLAY} authors ${census.length} census
 * eras, ${metrics.length} metric eras, ${anchors.length} anchor eras and ${regions.length} region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
${regions.length ? `  ${regions[regions.length - 1][2]}.map((region) => [region._id, region.name])` : "  []"}
);

const censusBundles = {
${block(census)}
};

const metricPresetBundles = {
${block(metrics)}
};

const populationAnchors = {
${block(anchors)}
};

const regionBundles = {
${block(regions)}
};

export const ${COUNTRY}_GEOGRAPHY: CountryGeography = {
  continent: ${COUNTRY}_CONTINENT,
  isoNumeric: ${COUNTRY}_ISO_NUMERIC,${factsNames.includes(`${COUNTRY}_UN_MEMBER_SINCE`) ? `\n  unMemberSince: ${COUNTRY}_UN_MEMBER_SINCE,` : ""}
  worldRegion: ${COUNTRY}_WORLD_REGION,
  nppCapitalState: ${COUNTRY}_NPP_CAPITAL_STATE,${factsNames.includes(`${COUNTRY}_NON_PARTY_INDEPENDENT_BIAS`) ? `\n  nonPartyIndependentBias: ${COUNTRY}_NON_PARTY_INDEPENDENT_BIAS,` : ""}
  adjacency: ${COUNTRY}_ADJACENCY_MAP,
  regionNames,
  conscription: ${COUNTRY}_CONSCRIPTION,
  populationMultipliers: ${COUNTRY}_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ${rawExport ?? "[]"},
  mapRegistry: ${COUNTRY}_MAP_REGISTRY,
  core5Normals: ${COUNTRY}_CORE5_NORMALS,
};
`;

const OUT_GEO = `${DIR}/geography.ts`;
if (existsSync(OUT_GEO) && !FORCE) {
  console.error(`${OUT_GEO} exists. Pass --force to overwrite.`);
} else {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(OUT_GEO, geography, "utf8");
  console.log(`wrote ${OUT_GEO}`);
}

const barrel = `import type { CountryFolder } from "../contract";
import { ${COUNTRY}_IDENTITY } from "./identity";
import { ${COUNTRY}_INSTITUTIONS } from "./institutions";
import { ${COUNTRY}_ELECTIONS } from "./elections";
import { ${COUNTRY}_ECONOMY } from "./economy";
import { ${COUNTRY}_GEOGRAPHY } from "./geography";
import { ${COUNTRY}_ERAS } from "./eras";

/**
 * ${DISPLAY}'s country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. \`./elections\` reaches \`getDb\` through the
 * continuity spawners, so a \`"use client"\` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take \`./identity\` or
 * \`./geographyFacts\`, never this file and never \`./geography\`.
 */
export const ${COUNTRY}: CountryFolder = {
  id: ${JSON.stringify(COUNTRY)},
  identity: ${COUNTRY}_IDENTITY,
  institutions: ${COUNTRY}_INSTITUTIONS,
  elections: ${COUNTRY}_ELECTIONS,
  economy: ${COUNTRY}_ECONOMY,
  geography: ${COUNTRY}_GEOGRAPHY,
  eras: ${COUNTRY}_ERAS,
};

export { ${COUNTRY}_IDENTITY } from "./identity";
export { ${COUNTRY}_INSTITUTIONS } from "./institutions";
export { ${COUNTRY}_ELECTIONS } from "./elections";
export { ${COUNTRY}_ECONOMY } from "./economy";
export { ${COUNTRY}_GEOGRAPHY } from "./geography";
export { ${COUNTRY}_ERAS } from "./eras";
`;
const OUT_BARREL = `${DIR}/index.ts`;
if (!existsSync(OUT_BARREL) || FORCE) {
  writeFileSync(OUT_BARREL, barrel, "utf8");
  console.log(`wrote ${OUT_BARREL}`);
}

console.log(`  census eras  : ${census.map(([p]) => p.slice(0, 4)).join(", ") || "none"}`);
console.log(`  metric eras  : ${metrics.map(([p]) => p.slice(0, 4)).join(", ") || "none"}`);
console.log(`  anchor eras  : ${anchors.map(([p]) => p.slice(0, 4)).join(", ") || "none"}`);
console.log(`  region eras  : ${regions.map(([p]) => p.slice(0, 4)).join(", ") || "none"}`);
console.log(`  rawMetrics   : ${rawExport ?? "NOT FOUND -- geography will have an empty array"}`);
console.log(
  `\nStill to write by hand: institutions.ts (wires the cabinet) and elections.ts (wires the spawners).`
);
