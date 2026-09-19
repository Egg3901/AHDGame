/**
 * Writes `src/lib/countries/<cc>/identity.ts` from that country's pre-move
 * snapshot.
 *
 *   npx tsx scripts/countries/gen-country-identity.ts US "United States"
 *
 * ⚠ GENERATED FROM THE SNAPSHOT, NOT TRANSCRIBED. The plan's single stated risk
 * is transcription error, and several hundred lines of hand-copying is how that
 * risk arrives. Japan's identity module was generated for this reason and so is
 * every other country's. If a value here is wrong, the snapshot is wrong, and
 * the snapshot came out of the live registry.
 *
 * ⚠ THIS IS A GENERATOR, AND GENERATORS HERE HAVE A HISTORY OF BEING DELETED.
 * Japan's six lived in a scratch directory and went with it, so country #2 began
 * by reconstructing them. It is committed for that reason alone. Re-running it
 * for a country that already has a folder OVERWRITES hand edits, so it refuses
 * unless `--force` is passed.
 *
 * ⚠ AN ABSENT REGISTRY IS OMITTED, NEVER DEFAULTED. `SURFACES`,
 * `REGION_CENSUS_LABELS` and `STATE_DISPLAY_NAMES` have no US entry, and the
 * three matching fields are optional in the contract for that reason. Writing a
 * plausible value for one of them would author a fallback into an authored
 * value -- the same "second source that is correct today" this work exists to
 * remove, pointing the other way. Read `__snapshots__/README.md` before deciding
 * that an absence is a gap.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const DISPLAY_NAME = process.argv[3];
const FORCE = process.argv.includes("--force");

if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY) || !DISPLAY_NAME) {
  console.error(
    'usage: npx tsx scripts/countries/gen-country-identity.ts <COUNTRY_ID> "<Display Name>" [--force]'
  );
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
const OUT = `src/lib/countries/${lower}/identity.ts`;

if (!existsSync(SNAPSHOT)) {
  console.error(
    `${SNAPSHOT} does not exist. Emit it first, BEFORE rewiring any registry:\n` +
      `  npx tsx scripts/countries/check-snapshot-imports.ts\n` +
      `  npx tsx scripts/countries/emit-country-snapshot.ts ${COUNTRY}`
  );
  process.exit(1);
}
if (existsSync(OUT) && !FORCE) {
  console.error(`${OUT} exists. Pass --force to overwrite it, losing any hand edits.`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;

/** A required registry. Throws rather than emitting a field with no value. */
function v(name: string): string {
  const e = snap[name];
  if (!e) throw new Error(`${name} is not in ${SNAPSHOT}. Add it to the emitter and re-emit.`);
  if (e.shape === "absent") {
    throw new Error(
      `${name} has no ${COUNTRY} entry. If that is correct, this field belongs in the ` +
        `optional set; if it is not, check the registry is exported -- an unexported ` +
        `one snapshots as "absent". Run check-snapshot-imports.ts.`
    );
  }
  if (e.shape !== "country-first") {
    throw new Error(`${name} has shape "${e.shape}", expected "country-first".`);
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

const cabinetValue = maybe("CABINET_IDENTITY");
const sealValue = maybe("EXECUTIVE_SEALS");
const statsValue = maybe("NATIONAL_STATS_IDENTITY");
const economyTextValue = maybe("ECONOMY_TEXT");
const parliamentarySurface = maybe("SURFACES");
const regionCensusLabels = maybe("REGION_CENSUS_LABELS");
const stateDisplayNames = maybe("STATE_DISPLAY_NAMES");
const historicalNames = maybe("COUNTRY_HISTORICAL_NAMES");
const modernNames = maybe("COUNTRY_MODERN_NAMES");

const lines: string[] = [];
const fields: string[] = [];

function required(decl: string, type: string, registry: string, doc?: string) {
  if (doc) lines.push(doc);
  lines.push(`const ${decl}: ${type} = ${v(registry)};\n`);
  fields.push(`  ${decl},`);
}

function optional(
  decl: string,
  type: string,
  value: string | null,
  doc: string,
  absentDoc: string
) {
  if (value === null) {
    lines.push(`/**\n * ${absentDoc}\n */\n// (${decl} is deliberately absent for ${COUNTRY}.)\n`);
    return;
  }
  lines.push(`/** ${doc} */`);
  lines.push(`const ${decl}: ${type} = ${value};\n`);
  fields.push(`  ${decl},`);
}

optional(
  "cabinet",
  "CabinetIdentity",
  cabinetValue,
  "The cabinet's page labels and glyph.",
  "No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell."
);
required("national", "NationalIdentity", "NATIONAL_IDENTITY");
optional(
  "stats",
  "StatsIdentity",
  statsValue,
  "The country's national-statistics labels.",
  "No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;\n" +
    " * authoring that default here would make the fallback look chosen."
);
required(
  "treasuryText",
  'Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft">',
  "TREASURY_TEXT",
  "/** The authored text only. The palette is pulled from `national` downstream. */"
);
optional(
  "economyText",
  'Omit<EconomyIdentity, "accent">',
  economyTextValue,
  "The authored economy copy. The accent is pulled from `national` downstream.",
  "No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT."
);
required("executiveText", "IdentityText", "EXECUTIVE_TEXT");
required("policyText", "IdentityText", "POLICY_TEXT");
optional(
  "executiveSeal",
  "ExecutiveSeal",
  sealValue,
  "The executive seal.",
  "No EXECUTIVE_SEALS row. getSeal returns null, and the UI omits the seal."
);
required("executiveSurface", "ExecutiveSurfaceConfig", "EXECUTIVE_SURFACE");

optional(
  "parliamentarySurface",
  "ParliamentaryExecutiveSurface",
  parliamentarySurface,
  "The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol of the same name that is a different thing.",
  `No parliamentary executive surface. \`SURFACES\` has no ${COUNTRY} entry, and for a\n * presidential country that is correct rather than missing: there is no\n * parliamentary executive for a surface to describe. \`contract.test.ts\` requires\n * this field of parliamentary countries only.`
);
optional(
  "regionCensusLabels",
  "CensusLabelSet",
  regionCensusLabels,
  "Census category labels for region pages.",
  `No census label set. \`REGION_CENSUS_LABELS\` has no ${COUNTRY} entry and consumers\n * fall back to the generic labels -- the same text every unlisted country gets,\n * not ${COUNTRY} data behind a ${COUNTRY}-specific branch. Authoring one here would turn a\n * default into an authored value.`
);
optional(
  "stateDisplayNames",
  "Record<string, string>",
  stateDisplayNames,
  "Region display names (STATE_DISPLAY_NAMES), used by the commodity map.",
  `No region display names. \`STATE_DISPLAY_NAMES\` has no ${COUNTRY} entry; the map\n * falls back to \`compactRegionCode(countryId, stateId)\`, which derives from the\n * state id rather than naming anything. There is no value here to move.`
);
optional(
  "historicalNames",
  "readonly string[]",
  historicalNames,
  "NPC bank names, pre-modernisation.",
  `No historical NPC bank names.`
);
optional(
  "modernNames",
  "readonly string[]",
  modernNames,
  "NPC bank names, post-modernisation.",
  `No modern NPC bank names.`
);

/*
 * ⚠ OPTIONAL, BECAUSE THE READER ALREADY HAS A FALLBACK. China has no entry
 * in `NATIONAL_ADDRESS_NAME`, and its only consumer reads
 * `NATIONAL_ADDRESS_NAME[countryId] ?? "Address to the Nation"`. Emitting the
 * fallback into the folder would turn a country that DECLINES to name its
 * address into one that names it "Address to the Nation" -- an invented value
 * that reads as authored and can never be told from a real one again.
 */
const addressName = maybe("NATIONAL_ADDRESS_NAME");

const out = `${cabinetValue ? 'import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";' : ""}
${economyTextValue ? 'import type { EconomyIdentity } from "@/lib/constants/economyIdentity";' : ""}
${sealValue ? 'import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";' : ""}
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
${statsValue ? 'import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";' : ""}${
  parliamentarySurface
    ? '\nimport type { ParliamentaryExecutiveSurface } from "@/lib/constants/parliamentaryExecutiveSurface";'
    : ""
}${
  regionCensusLabels
    ? '\nimport type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";'
    : ""
}
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * ${DISPLAY_NAME}'s names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of \`__snapshots__/${lower}.pre-move.json\`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts ${COUNTRY} "${DISPLAY_NAME}" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (\`treasuryIdentity.ts\`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

${lines.join("\n")}
export const ${COUNTRY}_IDENTITY: CountryIdentity = {
  displayName: ${JSON.stringify(DISPLAY_NAME)},
${fields.join("\n")}
${
  addressName
    ? `  addressNames: { national: ${addressName} },
`
    : ""
}
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, "utf8");
console.log(`wrote ${OUT}`);
console.log(`  fields written : ${fields.length + 2}`);
const omitted = [
  ["parliamentarySurface", parliamentarySurface],
  ["regionCensusLabels", regionCensusLabels],
  ["stateDisplayNames", stateDisplayNames],
  ["historicalNames", historicalNames],
  ["modernNames", modernNames],
].filter(([, val]) => val === null);
if (omitted.length) {
  console.log(`  omitted (absent in the snapshot, NOT defaulted):`);
  for (const [name] of omitted) console.log(`    ${String(name)}`);
  console.log(`  Confirm each against __snapshots__/README.md before accepting the file.`);
}
