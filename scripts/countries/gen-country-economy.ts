/**
 * Writes `src/lib/countries/<cc>/economy.ts` from the pre-move snapshot.
 *
 *   npx tsx scripts/countries/gen-country-economy.ts US
 *
 * ⚠ GENERATED FROM THE SNAPSHOT, NOT TRANSCRIBED.
 *
 * ⚠ CURRENCY IDENTITY BELONGS TO THE COUNTRY; THE EXCHANGE RATE DOES NOT.
 * `COUNTRY_CURRENCY_MAP.US = "USD"` is the United States' own fact and moves.
 * A JPY/USD rate is a fact about a PAIR of countries in a YEAR, and stays in the
 * rate tables beside the rates it has to stay consistent with. `INITIAL_RATES`
 * is in the snapshot as evidence only and this generator never reads it.
 *
 * ⚠ LOCAL-CURRENCY VALUES ARE NOT COMPARABLE ACROSS COUNTRIES. The NPP investing
 * floor is 80,000 for the US and 34,000 for Japan; those are dollars and yen,
 * roughly two orders of magnitude apart in real terms. Nothing here should be
 * nudged toward its neighbours.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Entry {
  readonly shape: string;
  readonly value: unknown;
}

const COUNTRY = process.argv[2]?.toUpperCase();
const FORCE = process.argv.includes("--force");

if (!COUNTRY || !/^[A-Z]{2}$/.test(COUNTRY)) {
  console.error("usage: npx tsx scripts/countries/gen-country-economy.ts <COUNTRY_ID> [--force]");
  process.exit(1);
}

const lower = COUNTRY.toLowerCase();
const SNAPSHOT = `src/lib/countries/__snapshots__/${lower}.pre-move.json`;
const OUT = `src/lib/countries/${lower}/economy.ts`;

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

const eraMonetary: Array<[string, string | null]> = [
  ["1953", maybe("MONETARY_BASELINES_1953")],
  ["1971", maybe("MONETARY_BASELINES_1971")],
  ["1979", maybe("MONETARY_BASELINES_1979")],
  ["1991", maybe("MONETARY_BASELINES_1991")],
];
const eraSectors: Array<[string, string | null]> = [
  ["1953", maybe("COUNTRY_SECTOR_WEIGHTS_1953")],
  ["1979", maybe("COUNTRY_SECTOR_WEIGHTS_1979")],
  ["1991", maybe("COUNTRY_SECTOR_WEIGHTS_1991")],
];

const monetaryEntries = eraMonetary
  .filter(([, value]) => value !== null)
  .map(([era, value]) => `    "${era}": ${value},`)
  .join("\n");
const sectorEntries = eraSectors
  .filter(([, value]) => value !== null)
  .map(([era, value]) => `      "${era}": ${value},`)
  .join("\n");

/**
 * Optional in the contract and legitimately absent for some countries.
 *
 * ⚠ `PLAYER_PAYOUT_CAP_PER_TURN` IS `Partial` AND GERMANY HAS NO ENTRY. An
 * earlier version read it with the REQUIRED accessor, which throws on absent --
 * so the first country without a cap could not be generated at all. A country
 * with no entry takes the shared default; inventing a number here would turn
 * that fallback into an authored value.
 */
const payoutCap = maybe("PLAYER_PAYOUT_CAP_PER_TURN");
const sovereignStructure = maybe("SOVEREIGN_CORP_LEGAL_STRUCTURE");
const m2ToGdp = maybe("M2_TO_GDP_1953");

const absentMonetary = eraMonetary.filter(([, value]) => value === null).map(([era]) => era);
const absentSectors = eraSectors.filter(([, value]) => value === null).map(([era]) => era);

const out = `import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * ${COUNTRY}'s money.
 *
 * ⚠ GENERATED FROM \`__snapshots__/${lower}.pre-move.json\`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts ${COUNTRY} --force
 *
 * ⚠ THE EXCHANGE RATE IS NOT HERE, DELIBERATELY. Currency IDENTITY is this
 * country's fact and moved; a rate is a fact about a PAIR of countries in a
 * YEAR, and belongs beside the rates it must stay consistent with. Moving one
 * into a country folder would give it a value whose meaning only exists relative
 * to the table it left.
 *
 * ⚠ EVERY FIGURE BELOW IS IN LOCAL CURRENCY and is not comparable to another
 * country's. Do not reconcile one toward its neighbours.${
   absentMonetary.length
     ? `\n *\n * ⚠ NO MONETARY BASELINE FOR ${absentMonetary.join(", ")}: ${COUNTRY} has no entry in\n * those era tables and takes the base baseline. The key is ABSENT rather than\n * defaulted, because inventing one would turn a fallback into an authored value.`
     : ""
 }${
   absentSectors.length
     ? `\n *\n * ⚠ NO SECTOR WEIGHTS FOR ${absentSectors.join(", ")}, for the same reason.`
     : ""
 }
 */

const currencyCode = ${v("COUNTRY_CURRENCY_MAP")} as CurrencyCode;
const nationalPolicyStateId = ${v("NATIONAL_POLICY_STATE_IDS")};
const legislationScope = ${v("LEGISLATION_COUNTRY_SCOPES")};
const economicBaseline = ${v("ECONOMIC_BASELINES")};
const baselineMonetary = ${v("MONETARY_BASELINES")};
const sectorWeightsBase = ${v("COUNTRY_SECTOR_WEIGHTS")};
const repEcon = ${v("REP_ECON")};
const costScaleAnchors = ${v("COST_SCALE_ANCHORS")};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to \`string\`, and \`CorporationType[]\` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ${v("DEFAULT_STRATEGIC_SECTORS")} as CorporationType[];
const treasuryPsRate = ${v("TREASURY_PS_RATE_BY_COUNTRY")};

export const ${COUNTRY}_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
${monetaryEntries}
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
${sectorEntries}
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    neutralFederalSalesTax: ${v("NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY")},
    neutralStateSalesTax: ${v("NEUTRAL_STATE_SALES_TAX_BY_COUNTRY")},
    treasuryPsRate,
  },
${
  payoutCap
    ? `  payoutCapPerTurn: ${payoutCap},
`
    : ""
}${
  sovereignStructure
    ? `  sovereignCorpLegalStructure: ${sovereignStructure} as LegalStructureId,
`
    : ""
}${
  m2ToGdp
    ? `  m2ToGdp1953: ${m2ToGdp},
`
    : ""
}};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. \`GDP_DENOMINATION_1953\` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const ${COUNTRY}_GDP_DENOMINATION_1953 = ${v("GDP_DENOMINATION_1953")};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, "utf8");
console.log(`wrote ${OUT}`);
console.log(`  currency          : ${JSON.parse(v("COUNTRY_CURRENCY_MAP")) as string}`);
console.log(
  `  monetary eras     : ${
    eraMonetary
      .filter(([, x]) => x)
      .map(([e]) => e)
      .join(", ") || "none"
  }`
);
console.log(
  `  sector-weight eras: ${
    eraSectors
      .filter(([, x]) => x)
      .map(([e]) => e)
      .join(", ") || "none"
  }`
);
if (absentMonetary.length || absentSectors.length) {
  console.log(`  omitted (absent, NOT defaulted):`);
  for (const era of absentMonetary) console.log(`    monetary ${era}`);
  for (const era of absentSectors) console.log(`    sectors  ${era}`);
  console.log(`  Confirm each against __snapshots__/README.md before accepting.`);
}
