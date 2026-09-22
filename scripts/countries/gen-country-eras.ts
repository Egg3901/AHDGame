/**
 * Writes `src/lib/countries/<cc>/eras/*.ts` and their index from the pre-move
 * snapshot.
 *
 *   npx tsx scripts/countries/gen-country-eras.ts US
 *
 * ⚠ ONE FILE PER SHIPPING PRESET, COUNTED FROM `SHIPPING_PRESETS` AND NEVER FROM
 * A LITERAL. Japan's first revision listed five and silently dropped 1999 and
 * 2007, for which it carries real region, census and demographic data; upstream
 * then added 2027 and every hard-coded "seven" had to be hunted down. This reads
 * the roster, so a new preset produces a new file instead of a silent gap.
 *
 * ⚠ THE SNAPSHOT IS JSON, SO IT CANNOT CARRY AN EXPLICITLY-`undefined` KEY, AND
 * THAT LOSS IS SILENT AND LOAD-BEARING. `JSON.stringify` drops
 * `upperElectionSystem: undefined` entirely, so a generated era file omits the
 * key -- and because `getCountryConfig` shallow-merges, an omitted key LEAVES
 * THE BASE VALUE IN PLACE where the explicit `undefined` CLEARED it. Spain,
 * Sweden and Turkey each lost their 1953 "no elected upper chamber" that way and
 * silently regained one; only `countries.test.ts` caught it. After generating,
 * diff the era override against the registry with KEY PRESENCE compared, not
 * just values -- a JSON-canonicalising diff reports them identical.
 *
 * ⚠ AN ERA WITH NO OVERRIDE SAYS SO BY ABSENCE OF THE FIELD, NOT BY AN EMPTY
 * OBJECT. `getCountryConfig` is a SHALLOW merge, so `config: {}` is not "no
 * override" -- it is an override supplying nothing, and any field the base had
 * is still there only by luck of the merge order. The file still exists (every
 * preset gets one) but omits what it does not change.
 *
 * ⚠ AND THE MERGE IS SHALLOW, WHICH IS WHY A PARTIAL `legislature` IS A TRAP. An
 * era override that supplies `legislature` REPLACES the base one wholesale --
 * every field it omits is gone, not inherited. Japan's 1953 override carries the
 * full 466/248 chamber pair for exactly this reason. The snapshot holds whatever
 * the live registry had, so this generator reproduces it faithfully; do not
 * "tidy" a repeated field out of one afterwards.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { SHIPPING_PRESETS } from "../../src/lib/world/eraRoster";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const FORCE = process.argv.includes("--force");

if (!COUNTRY || !/^[A-Z]{2,3}$/.test(COUNTRY)) {
  console.error("usage: npx tsx scripts/countries/gen-country-eras.ts <COUNTRY_ID> [--force]");
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
const DIR = `src/lib/countries/${lower}/eras`;

if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT} does not exist. Emit it before rewiring any registry.`);
  process.exit(1);
}
if (existsSync(DIR) && !FORCE) {
  console.error(`${DIR} exists. Pass --force to overwrite it.`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;

/** Outer-keyed: preset -> this country's value. */
function outer(name: string): Record<string, unknown> {
  const e = snap[name];
  if (!e || e.shape === "absent") return {};
  if (e.shape !== "outer-keyed") {
    throw new Error(`${name} has shape "${e.shape}", expected "outer-keyed".`);
  }
  return (e.value ?? {}) as Record<string, unknown>;
}

const configOverrides = outer("ERA_COUNTRY_CONFIG_OVERRIDES");
const ordersByEra = outer("ORDERS_OF_BATTLE_BY_ERA");

mkdirSync(DIR, { recursive: true });

const written: Array<{ preset: string; symbol: string; parts: string[] }> = [];

for (const preset of SHIPPING_PRESETS) {
  const year = preset.slice(0, 4);
  const symbol = `${COUNTRY}_${year}`;
  const config = configOverrides[preset] ?? null;
  const orders = ordersByEra[preset] ?? null;

  const parts: string[] = [];
  const body: string[] = [`  preset: ${JSON.stringify(preset)},`];

  if (config !== null && config !== undefined) {
    parts.push("config");
    body.push(`  config: ${JSON.stringify(config, null, 2).replace(/\n/g, "\n  ")},`);
  }
  if (orders !== null && orders !== undefined) {
    parts.push("ordersOfBattle");
    body.push(
      `  institutions: {\n    military: {\n      ordersOfBattle: ${JSON.stringify(
        orders,
        null,
        2
      ).replace(/\n/g, "\n      ")},\n    },\n  },`
    );
  }

  const notes: string[] = [];
  if (!parts.includes("config")) {
    notes.push(
      ` * No config override: this era uses ${COUNTRY}'s base configuration. The field\n` +
        ` * is ABSENT rather than an empty object, because \`getCountryConfig\` merges\n` +
        ` * shallowly and \`config: {}\` reads as an override that supplies nothing.`
    );
  }
  if (!parts.includes("ordersOfBattle")) {
    notes.push(
      ` * No per-era orders of battle: this era falls back to the base set rather\n` +
        ` * than inventing an empty one.`
    );
  }

  const out = `import type { CountryEraOverride } from "../../contract";

/**
 * ${COUNTRY}, ${year}.
 *
 * ⚠ GENERATED from \`__snapshots__/${lower}.pre-move.json\`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts ${COUNTRY} --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
${notes.length ? " *\n" + notes.join("\n *\n") + "\n" : ""} */
export const ${symbol}: CountryEraOverride = {
${body.join("\n")}
};
`;
  writeFileSync(`${DIR}/${year}.ts`, out, "utf8");
  written.push({ preset, symbol, parts });
}

const imports = written.map((w) => `import { ${w.symbol} } from "./${w.preset.slice(0, 4)}";`);
const entries = written.map((w) => `  ${JSON.stringify(w.preset)}: ${w.symbol},`);
const withConfig = written.filter((w) => w.parts.includes("config")).map((w) => w.preset);

const index = `import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
${imports.join("\n")}

/**
 * ${COUNTRY}'s per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in \`SHIPPING_PRESETS\` gets a file -- ${SHIPPING_PRESETS.length} of them. The count is
 * asserted against the roster in \`contract.test.ts\` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving ${COUNTRY} without an era.
 *
 * ⚠ ${
   withConfig.length === 0
     ? `${COUNTRY} HAS NO CONFIG OVERRIDE IN ANY ERA. Every preset uses the base config.`
     : `CONFIG OVERRIDES: ${withConfig.join(", ")}. \`getCountryConfig\` merges SHALLOWLY,
 * so an override supplying \`legislature\` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.`
 }
 */
export const ${COUNTRY}_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
${entries.join("\n")}
};
`;
writeFileSync(`${DIR}/index.ts`, index, "utf8");

console.log(`wrote ${written.length} era files + index to ${DIR}`);
for (const w of written) {
  console.log(`  ${w.preset.padEnd(16)} ${w.parts.length ? w.parts.join(" + ") : "(base only)"}`);
}
