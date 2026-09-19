/**
 * Appends ONE registry entry to an existing pre-move snapshot.
 *
 *   npx tsx scripts/countries/append-snapshot-entry.ts US POPULATION_MULTIPLIERS
 *
 * ⚠ THIS IS THE SANCTIONED ALTERNATIVE TO RE-EMITTING, AND THE DISTINCTION
 * MATTERS. A snapshot is a PRE-move record: once a registry forwards to a
 * country folder, re-emitting reads the folder back out and writes down whatever
 * is there now, so the fixture stops being independent evidence and becomes a
 * copy of the thing it was supposed to check. `emit-country-snapshot.ts` refuses
 * to overwrite for that reason.
 *
 * But a registry genuinely missed at emit time has to get in somehow. This adds
 * exactly one key, refuses to overwrite a key that already exists, and refuses
 * outright if the registry already forwards into a country folder -- which is
 * the case where the value would no longer be a pre-move one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { escapeRegExp } from "./regexEscape";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
  readonly functionKeys?: readonly string[];
}

const COUNTRY = process.argv[2]?.toUpperCase();
const REGISTRY = process.argv[3];

if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY) || !REGISTRY) {
  console.error("usage: npx tsx scripts/countries/append-snapshot-entry.ts <CC> <REGISTRY_NAME>");
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT} does not exist. Emit it first.`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;
if (snap[REGISTRY]) {
  console.error(
    `${REGISTRY} is already in ${SNAPSHOT} with shape "${snap[REGISTRY].shape}". ` +
      `Overwriting it would replace a pre-move value with a current one, which is ` +
      `the whole failure this script exists to avoid. Delete the key by hand if ` +
      `that is genuinely what you want.`
  );
  process.exit(1);
}

async function main() {
  // Resolve the registry through the emitter's own import list, so the name and
  // the module path cannot drift apart.
  const emitter = readFileSync("scripts/countries/emit-country-snapshot.ts", "utf8");
  const match = emitter.match(
    new RegExp(
      `^import\\s*\\{[^}]*\\b${escapeRegExp(REGISTRY)}\\b[^}]*\\}\\s*from\\s*"([^"]+)";`,
      "m"
    )
  );
  if (!match) {
    console.error(
      `${REGISTRY} is not imported by the emitter. Add it there first -- that list ` +
        `is the record of which registries a country folder absorbs, and an entry ` +
        `appended here without one is invisible to the next country.`
    );
    process.exit(1);
  }
  const from = match[1];

  // ⚠ THE CHECK IS PER-COUNTRY, NOT PER-FILE, AND THE FIRST DRAFT WAS NOT.
  // A multi-country registry can already forward ANOTHER country without this
  // one having moved: `stateDemographics1991.ts` imports `JP_GEOGRAPHY` because
  // Japan's entry was rewired, while the US entry beside it is still a literal
  // that has never been touched. Refusing on any `@/lib/countries/` import
  // blocked a legitimate append and would have blocked one for every country
  // after the first.
  const source = readFileSync(from.replace(/^\.\.\/\.\.\//, "") + ".ts", "utf8");
  if (new RegExp(`@/lib/countries/${escapeRegExp(lower)}/`).test(source)) {
    console.error(
      `${from} already imports from ${lower}/, so ${REGISTRY} may already forward ` +
        `for ${COUNTRY} and its value would not be a PRE-move one. Snapshot this ` +
        `registry before the rewire, or accept that it cannot be evidence.`
    );
    process.exit(1);
  }

  const mod = (await import(from)) as Record<string, unknown>;
  const registry = mod[REGISTRY];
  if (registry === undefined) {
    console.error(
      `${REGISTRY} imports as undefined from ${from}. An unexported registry does ` +
        `this silently -- run check-snapshot-imports.ts.`
    );
    process.exit(1);
  }

  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  let entry: Entry;
  if (isObj(registry) && COUNTRY in registry) {
    entry = { shape: "country-first", value: registry[COUNTRY] ?? null };
  } else {
    console.error(
      `${REGISTRY} has no ${COUNTRY} key at the top level. This script only handles ` +
        `the country-first shape; anything else should go through the emitter so the ` +
        `shape is recorded the same way as every other entry.`
    );
    process.exit(1);
  }

  snap[REGISTRY] = entry;
  const ordered = Object.fromEntries(Object.entries(snap).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(SNAPSHOT, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  console.log(`appended ${REGISTRY} to ${SNAPSHOT}`);
  console.log(`  shape : ${entry.shape}`);
  console.log(`  value : ${JSON.stringify(entry.value).slice(0, 120)}`);
  console.log(`  total : ${Object.keys(ordered).length} registries`);
}

void main();
