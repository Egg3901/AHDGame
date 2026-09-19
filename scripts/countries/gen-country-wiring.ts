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
import { escapeRegExp } from "./regexEscape";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const DISPLAY = process.argv[3];
const FORCE = process.argv.includes("--force");
/*
 * ⚠ `institutions.ts` AND `elections.ts` ARE HAND-WRITTEN FOR TEN COUNTRIES.
 * Regenerating geography for all of them with `--force` would overwrite those
 * too -- the seat tables, the spawner ordering, the reasoned omissions. This
 * flag regenerates ONLY geography.ts and index.ts.
 */
const GEOGRAPHY_ONLY = process.argv.includes("--geography-only");

if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY) || !DISPLAY) {
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
/**
 * ⚠ THE SEED DIRECTORY IS NOT ALWAYS THE COUNTRY ID. Ukraine's id is `UKR` and
 * its seed files are `src/lib/seeds/ua/uaRegions.ts` -- directory and symbol
 * prefix both `ua`. Assuming `seeds/<id>` found nothing for it, which would have
 * produced a folder with no regions rather than an error.
 */
const SEED_PREFIX: Record<string, string> = { ukr: "ua" };
const seedPrefix = SEED_PREFIX[cc] ?? cc;

const DATA_DIRS = [`${DIR}/data`, `src/lib/seeds/${seedPrefix}`];

function findModule(stem: string): string | null {
  for (const dir of DATA_DIRS) {
    if (existsSync(`${dir}/${stem}.ts`)) {
      return dir.startsWith(DIR) ? `./data/${stem}` : `@/lib/seeds/${seedPrefix}/${stem}`;
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
      /*
       * ⚠ THE EXPORT NEED NOT BE NAMED AFTER THE MODULE. `usStates.ts`
       * exports `states`, not `usStates`, so matching only the stem found
       * nothing for the bare (non-year) era and the US lost its 2019 bundle.
       */
      const unprefixed = stem.replace(/^[a-z]{2,3}/, "");
      const lowered = unprefixed.charAt(0).toLowerCase() + unprefixed.slice(1);
      const bare = names.find((n) => n === stem || n === base || n === lowered);
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

/**
 * Module-stem overrides, for countries that do not use `<cc>Regions` naming.
 *
 * ⚠ THE UNITED STATES CALLS THEM `usStates*` AND `usStateCensusData*`, and
 * its EXPORTS drop the country prefix entirely -- `usStates1953.ts` exports
 * `states1953`. Assuming the common naming made the generator derive zero region
 * eras for the country with fifty-one of them, and the first version of the
 * empty-regions guard did not fire because `usRegions.ts` does not exist. It
 * wrote a US geography with empty censusBundles, regionBundles and regionNames.
 */
const STEM_OVERRIDE: Record<string, { regions?: string; census?: string }> = {
  us: { regions: "usStates", census: "usStateCensusData" },
};
const stems = STEM_OVERRIDE[cc] ?? {};

const census = eraStems(stems.census ?? `${seedPrefix}RegionCensusData`, censusPresets);
const metrics = eraStems(`${seedPrefix}MetricPresets`, metricPresets);
const anchors = eraStems(`${seedPrefix}PopulationAnchors`, anchorPresets);
const regions = eraStems(stems.regions ?? `${seedPrefix}Regions`, regionPresets);

const rawStem = `${seedPrefix}StateMetrics`;
const rawMod = findModule(rawStem);
const rawExport = exportsOf(rawStem)[0];

const imports = new Map<string, Set<string>>();
const addImport = (mod: string, name: string) => {
  if (!imports.has(mod)) imports.set(mod, new Set());
  imports.get(mod)!.add(name);
};

const factsNames = [
  "ADJACENCY_MAP",
  "INCOME_ANCHORS",
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

/**
 * Region modules on disk but no preset keys: refuse rather than emit a stub.
 *
 * ⚠ THE PRESET KEYS COME FROM A DIAGNOSTIC REGISTRY THAT DOES NOT COVER EVERY
 * COUNTRY. `FULL_ERA_REGION_BUNDLES` lives in `admin/seedDiagnostic/` and is
 * `Partial`; Russia has `ruRegions.ts` and `ruRegions1953.ts`, authored and
 * seeded, and no row in it. The generator therefore derived ZERO region eras and
 * was about to write `regionNames: {}` and `regionBundles: {}` -- an empty map
 * for a country with fourteen regions, which typechecks and is silently wrong.
 *
 * Where the diagnostic registry is blank, the seed runner
 * (`admin/seed/seed<CC>.ts`) is the authority, so the mapping is passed in
 * explicitly:
 *
 *     --regions "1953-default=ruRegions1953,1979-default=ruRegions,2019-default=ruRegions"
 */
const REGION_OVERRIDE = (() => {
  const flag = process.argv.find((a) => a.startsWith("--regions="));
  const raw = flag
    ? flag.slice("--regions=".length)
    : process.argv[process.argv.indexOf("--regions") + 1];
  if (!flag && !process.argv.includes("--regions")) return null;
  const pairs = (raw ?? "").split(",").filter(Boolean);
  const out: Array<[string, string, string]> = [];
  for (const pair of pairs) {
    const [preset, stem] = pair.split("=");
    const mod = findModule(stem);
    if (!mod) {
      console.error(`--regions names ${stem}, which is not on disk.`);
      process.exit(1);
    }
    const picked = exportsOf(stem).find((n) => n === stem) ?? exportsOf(stem)[0];
    if (!picked) {
      console.error(`${stem} exports nothing this generator can use.`);
      process.exit(1);
    }
    out.push([preset, mod, picked]);
  }
  return out;
})();

/*
 * ⚠ THE OVERRIDE IS A FALLBACK, NOT AN OVERRIDE. It exists for countries the
 * diagnostic registry does not cover. Passing one to a country the registry DOES
 * cover replaces the authoritative preset list with whatever was typed on the
 * command line -- which is exactly what happened: a blanket
 * `1953/1979/2019` was handed to all 29 during a mass regeneration and the
 * United Kingdom went from SEVEN region eras to three, silently, in a commit
 * about something else. `regionBundles` shrank and nothing failed, because three
 * correct entries are not a type error.
 */
if (REGION_OVERRIDE && regions.length > 0) {
  console.error(
    `--regions was passed, but FULL_ERA_REGION_BUNDLES already declares ` +
      `${regions.length} region era(s) for ${COUNTRY}: ` +
      `${regions.map(([p]) => p).join(", ")}.
` +
      `The registry is authoritative where it has a row. Drop --regions.`
  );
  process.exit(1);
}

if (REGION_OVERRIDE) {
  /*
   * ⚠ THE IMPORTS ARE BUILT BEFORE THIS POINT, so replacing the list is not
   * enough -- the first override emitted `ruRegions.map(...)` with no import of
   * `ruRegions` and the module threw `ReferenceError` on load. It failed loudly,
   * which is the good case; the same mistake one line earlier would have been a
   * silently empty map.
   */
  regions.splice(0, regions.length, ...REGION_OVERRIDE);
  for (const [, mod, name] of REGION_OVERRIDE) addImport(mod, name);
}

/*
 * ⚠ THE FIRST VERSION ONLY REFUSED WHEN `<cc>Regions.ts` EXISTED, and that
 * hole bit immediately. The United States names its modules `usStates*` and
 * `usStateCensusData*`, so `findModule("usRegions")` returned null, the guard
 * stayed quiet, and regenerating wrote a US geography with EMPTY censusBundles,
 * regionBundles and regionNames -- for the country with fifty-one of them.
 *
 * Zero regions is now always a refusal. A country that genuinely has none must
 * say so with `--no-regions`, which is a claim someone has to type.
 */
if (regions.length === 0 && !process.argv.includes("--no-regions")) {
  console.error(
    `No region eras were derived for ${COUNTRY}, so regionNames, regionBundles and\n` +
      `censusBundles would all be written EMPTY. Either FULL_ERA_REGION_BUNDLES has no\n` +
      `${COUNTRY} row, or this country does not use the ${seedPrefix}Regions naming --\n` +
      `the United States calls its modules usStates* and usStateCensusData*.\n\n` +
      `Read src/lib/admin/seed/seed${COUNTRY}.ts and pass the mapping:\n` +
      `  --regions "1953-default=${seedPrefix}Regions1953,2019-default=${seedPrefix}Regions"\n` +
      `or, if this country genuinely has no regions, say so with --no-regions.`
  );
  process.exit(1);
}

/**
 * A geography field that exists only when the facts module declares it.
 *
 * ⚠ EVERY OPTIONAL FIELD NEEDS THIS, NOT JUST THE TWO THAT HAD IT. The template
 * hard-coded `conscription:` and `populationMultipliers:` while the facts
 * generator had already learnt to omit them, so Russia's geography referenced
 * `RU_CONSCRIPTION`, which does not exist. It threw `ReferenceError` on load --
 * loud, and caught by the runtime harness rather than by typecheck, because
 * eslint's `no-undef` is off for TypeScript and `tsc` sees the facts module's
 * missing export only where it is imported, which this template also omits.
 */
/**
 * Geography values that live in the SNAPSHOT rather than in the facts module.
 *
 * ⚠ THESE WERE JAPAN-ONLY FOR THE WHOLE ROLLOUT. `incomeAnchors`,
 * `calibrationTargets`, `era1991Patches`, `hazardGroups` and
 * `demographicCategoryIds` are all optional on the contract and all were carried
 * by exactly one folder -- Japan's, written by hand -- because no generator
 * emitted them. Every other country's values stayed in their registries,
 * unchecked and unforwarded. They are values, not wiring, so they belong in the
 * heavy module beside the bundles.
 */
function snapValue(name: string): string | null {
  const e = snap[name];
  if (!e || e.shape === "absent") return null;
  if (e.value === null || e.value === undefined) return null;
  if (e.shape === "function-valued") return null;
  return JSON.stringify(e.value, null, 2);
}

const calibrationTargets = snapValue("TARGETS");
const era1991Patches = snapValue("COUNTRY_ERA1991_PATCHES");
const hazardGroups = snapValue("HAZARD_GROUPS");
const demographicCategoryIds = snapValue("REGION_DEMOGRAPHIC_CATEGORY_IDS");

const snapField = (field: string, value: string | null): string =>
  value
    ? `
  ${field}: ${value},`
    : "";

const opt = (field: string, suffix: string): string =>
  factsNames.includes(`${COUNTRY}_${suffix}`) ? `\n  ${field}: ${COUNTRY}_${suffix},` : "";

/*
 * ⚠ BUILT AFTER THE OVERRIDE, NOT BEFORE. Adding the region imports first
 * left the ORIGINAL modules imported when an override replaced the list --
 * `ukRegions2007` and `ukRegions2023` sat unused in the UK's geography, which
 * lint reported and which is the visible half of the preset regression above.
 */
for (const [, mod, name] of [...census, ...metrics, ...anchors, ...regions]) addImport(mod, name);
if (rawMod && rawExport) addImport(rawMod, rawExport);

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
${opt("isoNumeric", "ISO_NUMERIC")}${opt("unMemberSince", "UN_MEMBER_SINCE")}
  worldRegion: ${COUNTRY}_WORLD_REGION,
  nppCapitalState: ${COUNTRY}_NPP_CAPITAL_STATE,${opt("nonPartyIndependentBias", "NON_PARTY_INDEPENDENT_BIAS")}${opt("conscription", "CONSCRIPTION")}${opt("populationMultipliers", "POPULATION_MULTIPLIERS")}${opt("core5Normals", "CORE5_NORMALS")}
  adjacency: ${COUNTRY}_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ${rawExport ?? "[]"},
  mapRegistry: ${COUNTRY}_MAP_REGISTRY,${opt("incomeAnchors", "INCOME_ANCHORS")}${snapField("calibrationTargets", calibrationTargets)}${snapField("era1991Patches", era1991Patches)}${snapField("hazardGroups", hazardGroups)}${snapField("demographicCategoryIds", demographicCategoryIds)}
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

/* ---------------------------------------------------------------------------
 * institutions.ts
 *
 * ⚠ GENERATED BY DISCOVERY AFTER SIX COUNTRIES WERE WRITTEN BY HAND. The six
 * differed only in which pieces exist: whether there is a `<cc>CabinetOrders.ts`,
 * whether the facts module declares an estate portfolio, a legislative process,
 * a set of cabinet groups. Fifteen countries remain and the registries covering
 * them are thin, so hand-writing thirty more files is thirty more chances to
 * import a binding that is not there. What exists is read off disk and off the
 * facts module; what does not is omitted with a reason.
 * ------------------------------------------------------------------------- */
const factsHas = (name: string): boolean =>
  readFileSync(`${DIR}/institutionsFacts.ts`, "utf8").includes(`export const ${COUNTRY}_${name}`);

/** `constants/<cc>Cabinet.ts` and friends, wherever they now live. */
function cabinetModule(stem: string): string | null {
  for (const p of [`${DIR}/cabinet/${cc}${stem}.ts`, `src/lib/constants/${cc}${stem}.ts`]) {
    if (existsSync(p)) {
      return p.startsWith(DIR) ? `./cabinet/${cc}${stem}` : `@/lib/constants/${cc}${stem}`;
    }
  }
  return null;
}

/** The exports of `constants/<cc><stem>.ts`, wherever it now lives. */
function cabinetExports(stem: string): string[] {
  for (const p of [`${DIR}/cabinet/${cc}${stem}.ts`, `src/lib/constants/${cc}${stem}.ts`]) {
    if (existsSync(p)) {
      return [...readFileSync(p, "utf8").matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map(
        (m) => m[1]
      );
    }
  }
  return [];
}

const cabinetPositionsMod = cabinetModule("Cabinet");
/**
 * ⚠ THE ORDERS ARE NOT ALWAYS IN A FILE OF THEIR OWN. Scotland and Wales
 * declare `SCO_MINISTERIAL_ORDERS` inside `scoCabinet.ts` rather than a separate
 * `scoCabinetOrders.ts`, so looking only for the latter emitted a folder with no
 * cabinet orders for two countries that have them. Fall back to the positions
 * module when it exports the binding.
 */
const cabinetOrdersMod =
  cabinetModule("CabinetOrders") ??
  (cabinetPositionsMod && cabinetExports("Cabinet").includes(`${COUNTRY}_MINISTERIAL_ORDERS`)
    ? cabinetPositionsMod
    : null);
const cabinetMechanicsMod = cabinetModule("CabinetMechanics");

const instFacts = [
  "CABINET_GROUPS",
  "CABINET_SEAT_IDS",
  "CONFIG",
  "ESTATE_PORTFOLIO",
  "LEGISLATIVE_PROCESS",
  "MILITARY_BRANCHES",
  "MILITARY_SCALE",
  "ORDERS_OF_BATTLE",
  "REGIONAL_BILL_ASSENT_OFFICE_KEY",
].filter(factsHas);

const instField = (field: string, suffix: string): string =>
  instFacts.includes(suffix)
    ? `
  ${field}: ${COUNTRY}_${suffix},`
    : "";

/** The same, one level deeper, for the `military:` block. */
const nested = (field: string, suffix: string): string =>
  instFacts.includes(suffix) ? `\n    ${field}: ${COUNTRY}_${suffix},` : "";

const cabinetEntry = (field: string, mod: string | null, binding: string): string =>
  mod
    ? `
    ${field}: ${binding},`
    : "";

const institutions = `import type { CountryInstitutions } from "../contract";
${[
  cabinetPositionsMod
    ? `import { ${COUNTRY}_CABINET_POSITIONS } from "${cabinetPositionsMod}";`
    : "",
  cabinetOrdersMod ? `import { ${COUNTRY}_MINISTERIAL_ORDERS } from "${cabinetOrdersMod}";` : "",
  cabinetMechanicsMod
    ? `import { ${COUNTRY}_CABINET_MECHANICS } from "${cabinetMechanicsMod}";`
    : "",
]
  .filter(Boolean)
  .join("\n")}
import {
${instFacts.map((n) => `  ${COUNTRY}_${n},`).join("\n")}
} from "./institutionsFacts";

/**
 * ${DISPLAY}'s institutions.
 *
 * ⚠️ THE FACTS LIVE IN \`./institutionsFacts\`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no ${COUNTRY} row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const ${COUNTRY}_INSTITUTIONS: CountryInstitutions = {${instField("config", "CONFIG")}${instField("legislativeProcess", "LEGISLATIVE_PROCESS")}${instField("regionalBillAssentOfficeKey", "REGIONAL_BILL_ASSENT_OFFICE_KEY")}${instField("positions", "CABINET_SEAT_IDS")}${instField("estatePortfolio", "ESTATE_PORTFOLIO")}
  military: {${nested("branches", "MILITARY_BRANCHES")}${nested("scale", "MILITARY_SCALE")}${nested("ordersOfBattle", "ORDERS_OF_BATTLE")}
  },
  cabinet: {${cabinetEntry("positions", cabinetPositionsMod, `${COUNTRY}_CABINET_POSITIONS`)}${cabinetEntry("orders", cabinetOrdersMod, `${COUNTRY}_MINISTERIAL_ORDERS`)}${cabinetEntry("mechanics", cabinetMechanicsMod, `${COUNTRY}_CABINET_MECHANICS`)}${
    instFacts.includes("CABINET_GROUPS")
      ? `
    groups: ${COUNTRY}_CABINET_GROUPS,`
      : ""
  }
  },
};
`;

const OUT_INST = `${DIR}/institutions.ts`;
if (GEOGRAPHY_ONLY) {
  console.log(`${OUT_INST} left alone (--geography-only).`);
} else if (!existsSync(OUT_INST) || FORCE) {
  writeFileSync(OUT_INST, institutions, "utf8");
  console.log(`wrote ${OUT_INST}`);
} else {
  console.log(`${OUT_INST} exists, left alone (pass --force to regenerate).`);
}

/* ---------------------------------------------------------------------------
 * elections.ts
 *
 * ⚠ ONLY FOR THE PHASE-DRIVEN SHAPE, AND IT REFUSES ANYTHING ELSE. Nineteen
 * countries remain and every one of them is wired the same way: no row in
 * `SPAWN_ELECTIONS_REGISTRY`, a list of entries in `COUNTRY_ELECTION_PHASES`,
 * and spawners that live in files SHARED between countries --
 * `easternBloc.ts` serves nine, `betaParliaments.ts` serves eight. Nothing moves
 * into a folder; the phases are read out of `countryPhases.ts`, which is the one
 * place that already says which phases a country runs and in what order.
 *
 * A country with a `spawn` row, or with seat tables, is NOT written here: those
 * were hand-written for the first ten because the seat sources differ wildly
 * (a denormalised table, two era-keyed tables, a live region field, or nothing)
 * and guessing between them is how a chamber ends up with the wrong size.
 * ------------------------------------------------------------------------- */
const PHASES_FILE = "src/lib/turn/countryPhases.ts";

function phaseEntries(): Array<[string, string]> {
  const src = readFileSync(PHASES_FILE, "utf8");
  const start = src.search(new RegExp(`^  ${escapeRegExp(COUNTRY)}: \\[`, "m"));
  if (start < 0) return [];
  /*
   * ⚠ BRACKET-MATCHED, BECAUSE A ONE-LINE ENTRY HAS NO `\n  ],` TO FIND. Poland
   * is written `PL: [{ name: "plSejmElections", fn: ensurePLElections }],` on a
   * single line. Searching forward for a multi-line terminator ran straight past
   * it into the next countries' blocks, and Poland's generated elections.ts came
   * back with FOURTEEN phases -- its own plus Czechoslovakia's, Hungary's,
   * Romania's, Bulgaria's and Yugoslavia's. It typechecked, and it would have
   * run five other countries' elections under Poland's id every turn.
   */
  const open = src.indexOf("[", start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === "[") depth++;
    else if (src[end] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(open, end + 1);
  return [...body.matchAll(/\{\s*name:\s*"([^"]+)",\s*fn:\s*([A-Za-z0-9_]+)\s*\}/g)].map(
    (m) => [m[1], m[2]] as [string, string]
  );
}

const phases = phaseEntries();
const hasSpawnRow = snap.SPAWN_ELECTIONS_REGISTRY?.shape !== "absent";
const OUT_ELEC = `${DIR}/elections.ts`;

if (GEOGRAPHY_ONLY) {
  console.log(`${OUT_ELEC} left alone (--geography-only).`);
} else if (existsSync(OUT_ELEC) && !FORCE) {
  console.log(`${OUT_ELEC} exists, left alone (pass --force to regenerate).`);
} else if (hasSpawnRow || phases.length === 0) {
  console.log(
    `${OUT_ELEC} NOT generated: ${
      hasSpawnRow
        ? "this country has a SPAWN_ELECTIONS_REGISTRY row"
        : "no COUNTRY_ELECTION_PHASES entries were found"
    }. Write it by hand.`
  );
} else {
  const elections = `import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
${phases.map(([, fn]) => `  ${fn},`).join("\n")}
} from "@/lib/turn/perpetualElections";

/**
 * ${DISPLAY}'s elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach \`getDb\`.
 *
 * ⚠️ NO \`spawn\`, AND NOTHING RELOCATED. ${DISPLAY} has no row in
 * \`SPAWN_ELECTIONS_REGISTRY\`; these phases run through
 * \`COUNTRY_ELECTION_PHASES\`, in this order. Adding a \`spawn\` would run them a
 * second time each turn. The spawner functions stay where they are because their
 * files are shared between countries -- moving one into this folder would take
 * the others' elections with it.
 *
 * ⚠️ NO \`seats\`. There is no seat table for ${DISPLAY} anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty \`byChamber\` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [
${phases.map(([name, fn]) => `  { name: ${JSON.stringify(name)}, fn: ${fn} },`).join("\n")}
];

export const ${COUNTRY}_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
`;
  writeFileSync(OUT_ELEC, elections, "utf8");
  console.log(`wrote ${OUT_ELEC} (${phases.length} phases)`);
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
  `\n  institutions      : ${instFacts.length} facts, cabinet ` +
    `${
      [
        cabinetPositionsMod && "positions",
        cabinetOrdersMod && "orders",
        cabinetMechanicsMod && "mechanics",
      ]
        .filter(Boolean)
        .join("/") || "none"
    }` +
    `\n\nStill to write by hand: elections.ts -- the spawners and any seat tables.`
);
