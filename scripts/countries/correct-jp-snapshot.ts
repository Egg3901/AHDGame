/**
 * Corrects three snapshot entries that the D1 emitter recorded incompletely.
 *
 * ⚠️ THIS IS A CORRECTION, NOT A RE-EMIT. It rewrites only the three entries
 * named below, and only after asserting each registry still holds its pre-move
 * value. Every other entry is preserved byte-for-byte.
 *
 * TWO BUGS IN THE D1 EXTRACTOR:
 *
 * 1. `fnKeys` guarded on `isObj`, which returns FALSE for arrays. A registry
 *    holding functions inside an array was never flagged, and JSON.stringify
 *    then dropped them silently. COUNTRY_ELECTION_PHASES.JP is four
 *    `{ name, fn }` entries; it was recorded as four `{ name }` entries.
 *
 * 2. Function-valued entries were recorded with `value: null`, so their
 *    NON-function siblings were lost too. COUNTRY_BILL_PHASES.JP also carries
 *    `phaseName` and `emptyResult`; PARLIAMENTARY_CABINET_CONFIGS.JP is mostly
 *    ordinary data with a single nested `hero.titleFor` function.
 *
 * The fixture is the only record of what these values were before the move, so
 * an entry that quietly lost half its content is worse than no entry: the
 * harness would compare against the thin version and call the move faithful.
 *
 *   npx tsx scripts/countries/correct-jp-snapshot.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES } from "../../src/lib/turn/countryPhases";
import { SPAWN_ELECTIONS_REGISTRY } from "../../src/lib/turn/perpetualElections/registry";
import { REGION_ROSTERS } from "../../src/lib/demographics/substrateCoverage";
import { PARLIAMENTARY_CABINET_CONFIGS } from "../../src/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";

const OUT = "src/lib/countries/__snapshots__/jp.pre-move.json";
const COUNTRY = "JP";

const CORRECTIONS: Record<string, unknown> = {
  COUNTRY_ELECTION_PHASES: (COUNTRY_ELECTION_PHASES as Record<string, unknown>)[COUNTRY],
  COUNTRY_BILL_PHASES: (COUNTRY_BILL_PHASES as Record<string, unknown>)[COUNTRY],
  PARLIAMENTARY_CABINET_CONFIGS: (PARLIAMENTARY_CABINET_CONFIGS as Record<string, unknown>)[
    COUNTRY
  ],
  // A bare function. `value: null` was not wrong so much as useless -- the
  // marker says "a function lives here", which is what the harness compares.
  SPAWN_ELECTIONS_REGISTRY: (SPAWN_ELECTIONS_REGISTRY as Record<string, unknown>)[COUNTRY],
  // Seven era thunks. Recorded as `value: null` by the D1 extractor, which threw
  // away the era KEY SET along with the functions -- so a silently dropped era
  // would have compared clean against nothing.
  REGION_ROSTERS: (REGION_ROSTERS as Record<string, unknown>)[COUNTRY],
};

/** Walks objects AND arrays. The D1 version stopped at arrays. */
function findFunctions(v: unknown, path: string[] = []): string[] {
  if (typeof v === "function") return [path.join(".") || "<self>"];
  if (Array.isArray(v)) return v.flatMap((item, i) => findFunctions(item, [...path, String(i)]));
  if (typeof v === "object" && v !== null) {
    return Object.entries(v).flatMap(([k, inner]) => findFunctions(inner, [...path, k]));
  }
  return [];
}

/** Replaces each function with a marker so the surrounding data survives. */
function preserveShape(v: unknown): unknown {
  if (typeof v === "function") return "<function>";
  if (Array.isArray(v)) return v.map(preserveShape);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, preserveShape(inner)]));
  }
  return v;
}

/**
 * ⚠️ REGISTRIES THAT HAVE ALREADY MOVED. Correcting one of these would read the
 * POST-move value and overwrite the only record of what was there before.
 *
 * SPAWN_ELECTIONS_REGISTRY was forwarded in D3. Re-running this script after
 * that read the forwarded value; it happened to serialise identically because
 * both are bare functions, but that was luck, not safety. The script now refuses
 * rather than relying on it.
 */
const ALREADY_MOVED = new Set([
  "SPAWN_ELECTIONS_REGISTRY",
  "COUNTRY_ELECTION_PHASES",
  "COUNTRY_BILL_PHASES",
]);

const snapshot = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>;

for (const [name, live] of Object.entries(CORRECTIONS)) {
  if (ALREADY_MOVED.has(name)) {
    console.log(`refused ${name}: already forwarded, so the live value is POST-move`);
    continue;
  }
  if (!(name in snapshot)) throw new Error(`${name} is not in the fixture; append it instead.`);
  if (live === undefined) throw new Error(`${name}: no Japan entry in the live registry.`);

  const functionKeys = findFunctions(live);
  if (functionKeys.length === 0) {
    throw new Error(`${name}: expected functions and found none. Re-check before correcting.`);
  }

  snapshot[name] = {
    shape: "function-valued",
    // Data preserved, functions marked. Previously this was `null`, which threw
    // away every non-function sibling.
    value: preserveShape(live),
    functionKeys,
  };
  console.log(
    `corrected ${name}: ${functionKeys.length} function(s) at ${functionKeys.join(", ")}`
  );
}

writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log(`\nfixture still holds ${Object.keys(snapshot).length} registries.`);
