/**
 * Writes `src/lib/countries/<cc>/institutionsFacts.ts` from the pre-move
 * snapshot.
 *
 *   npx tsx scripts/countries/gen-country-institutions.ts US
 *
 * ⚠ GENERATED FROM THE SNAPSHOT, NOT TRANSCRIBED. `COUNTRY_CONFIGS.US` alone is
 * 185 lines of nested configuration; hand-copying it is exactly how the plan's
 * one stated risk arrives.
 *
 * ⚠ IT WRITES ONLY THE FACTS MODULE, NEVER `institutions.ts`. The facts module
 * is pure data with no value imports, so it is safe to regenerate. The composing
 * module wires in the cabinet, which differs per country in ways a snapshot
 * cannot express -- Japan's `groups` are inline, the US has its own positions
 * file -- so it is written once by hand and left alone.
 *
 * ⚠ THE FACTS MODULE MUST STAY FREE OF VALUE IMPORTS. Registries that need one
 * seat id or the legislative process import from here, not from
 * `institutions.ts`, which pulls the cabinet -- 1,915 lines of mechanics for the
 * US. `clientSafeLeafModules.test.ts` enforces it.
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
  console.error(
    "usage: npx tsx scripts/countries/gen-country-institutions.ts <COUNTRY_ID> [--force]"
  );
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
const OUT = `src/lib/countries/${lower}/institutionsFacts.ts`;

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
  if (!e) throw new Error(`${name} is not in ${SNAPSHOT}. Add it to the emitter and re-emit.`);
  if (e.shape === "absent") {
    throw new Error(
      `${name} has no ${COUNTRY} entry. An unexported registry also snapshots as ` +
        `"absent" -- run check-snapshot-imports.ts before believing this.`
    );
  }
  if (e.shape !== "country-first") {
    throw new Error(`${name} has shape "${e.shape}", expected "country-first".`);
  }
  return JSON.stringify(e.value, null, 2);
}

/**
 * A registry entry the country may legitimately have no row in.
 *
 * ≠ `v()`. `v()` throws, which is right for a field the contract requires: a
 * missing `COUNTRY_CONFIGS` row is a broken conversion, not a fact about the
 * country. This is for the fields the contract marks optional, where absence is
 * the data -- China has no `REGIONAL_BILL_ASSENT_OFFICE_KEY`, and a generator
 * that defaulted it would write someone else's office into China's folder.
 */
function maybe(name: string): string | null {
  const e = snap[name];
  if (!e || e.shape === "absent") return null;
  if (e.value === null || e.value === undefined) return null;
  if (e.shape === "function-valued") return null;
  return JSON.stringify(e.value, null, 2);
}

const assentKey = maybe("REGIONAL_BILL_ASSENT_OFFICE_KEY");
const legislativeProcess = maybe("LEGISLATIVE_PROCESS");
const cabinetGroups = maybe("GROUPS");
const estatePortfolio = maybe("ESTATE_PORTFOLIO_BY_COUNTRY");
const ordersOfBattle = maybe("ORDERS_OF_BATTLE");

/** A seat id that may legitimately be absent (ENERGY and INFRA are `Partial`). */
function seat(name: string): string {
  const e = snap[name];
  if (!e || e.shape === "absent") return "undefined";
  return JSON.stringify(e.value);
}

const out = `import type { Branch } from "@/lib/constants/military";
${cabinetGroups ? 'import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";' : ""}
import type { CountryConfig } from "@/lib/constants/countries";
${legislativeProcess ? 'import type { LegislativeProcess } from "@/lib/legislature/process";' : ""}
${ordersOfBattle ? 'import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";' : ""}

/**
 * ${COUNTRY}'s institutions, as pure data.
 *
 * ⚠ GENERATED FROM \`__snapshots__/${lower}.pre-move.json\`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts ${COUNTRY} --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while \`institutions.ts\` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. \`clientSafeLeafModules.test.ts\` enforces it.
 */

export const ${COUNTRY}_CONFIG: CountryConfig = ${v("COUNTRY_CONFIGS")};

${
  legislativeProcess
    ? `export const ${COUNTRY}_LEGISLATIVE_PROCESS: LegislativeProcess = ${legislativeProcess};`
    : `/* No ${COUNTRY}_LEGISLATIVE_PROCESS: the registry has no ${COUNTRY} row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */`
}

${ordersOfBattle ? `export const ${COUNTRY}_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = ${ordersOfBattle};` : `/* No ${COUNTRY}_ORDERS_OF_BATTLE: no row; getOrderOfBattle returns null. */`}

export const ${COUNTRY}_MILITARY_BRANCHES: Branch[] = ${v("MILITARY_BRANCHES_BY_COUNTRY")};

${estatePortfolio ? `export const ${COUNTRY}_ESTATE_PORTFOLIO: Record<string, string> = ${estatePortfolio};` : `/* No ${COUNTRY}_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */`}

/**
 * Cabinet seat ids: which of this country's positions fills a cross-country
 * role.
 *
 * ⚠ THE FIVE ARE NOT TYPED ALIKE, AND THE FORWARDERS ARE WHAT EXPOSE IT. ENERGY
 * and INFRA live in \`Partial<Record<..., string>>\`, so they are
 * \`string | undefined\`; DEFENSE, FOREIGN_AFFAIRS and TRADE_MINISTER live in
 * \`Record<..., string | null>\`, so they are required and nullable. Declaring
 * all five the same way compiles here and fails at every forwarder.
 */
export const ${COUNTRY}_CABINET_SEAT_IDS = {
  energy: ${seat("ENERGY_POSITION_BY_COUNTRY")},
  infrastructure: ${seat("INFRA_POSITION_BY_COUNTRY")},
  defense: ${v("DEFENSE_POSITION_BY_COUNTRY")},
  foreignAffairs: ${v("FOREIGN_AFFAIRS_POSITION_BY_COUNTRY")},
  tradeMinister: ${v("TRADE_MINISTER_POSITION_BY_COUNTRY")},
} as const;

/** Military scale multiplier. */
export const ${COUNTRY}_MILITARY_SCALE = ${v("MILITARY_COUNTRY_SCALE")};

/** Which office assents to regional bills. */
${
  assentKey
    ? `export const ${COUNTRY}_REGIONAL_BILL_ASSENT_OFFICE_KEY = ${assentKey};`
    : `/* No ${COUNTRY}_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no ${COUNTRY} entry.
   * \`regionalBillAssentOfficeKey\` is optional in the contract, and a country whose
   * regional bills need no assent office is not the same as one defaulting to
   * someone else’s. */`
}

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. \`CabinetGroup\` is a union of bucket names, and
 * JSON.parse widens every one of them to \`string\`. Without it the object is
 * \`Record<string, string>\`, which is not assignable to \`Record<string, CabinetGroup>\`
 * and fails only under \`npm run typecheck\` -- eslint and the test suite both pass.
 */
${
  cabinetGroups
    ? `export const ${COUNTRY}_CABINET_GROUPS: Record<string, CabinetGroup> = ${cabinetGroups};`
    : `/* No ${COUNTRY}_CABINET_GROUPS: the registry has no ${COUNTRY} row, and its only
   reader already falls back to "Centre" per position. */`
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, "utf8");
console.log(`wrote ${OUT}`);
console.log(
  `  config keys        : ${Object.keys(JSON.parse(v("COUNTRY_CONFIGS")) as object).length}`
);
console.log(
  `  military branches  : ${(JSON.parse(v("MILITARY_BRANCHES_BY_COUNTRY")) as unknown[]).length}`
);
console.log(
  `  orders of battle   : ${ordersOfBattle ? (JSON.parse(ordersOfBattle) as unknown[]).length : "none (no row)"}`
);
console.log(
  `  cabinet groups     : ${cabinetGroups ? Object.keys(JSON.parse(cabinetGroups) as object).length : "none (no row)"}`
);
console.log(`\nNow write ${dirname(OUT)}/institutions.ts by hand: it wires the cabinet.`);
