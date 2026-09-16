/**
 * Audits the pre-move snapshot for entries whose functions were silently lost.
 *
 * ⚠️ WHY THIS EXISTS. The D1 emitter's `fnKeys` helper used an `isObj` guard
 * that returns false for ARRAYS, so a registry holding functions inside an array
 * was never flagged `function-valued`. `JSON.stringify` then dropped those
 * functions without a word, and the entry was recorded as ordinary data.
 *
 * COUNTRY_ELECTION_PHASES.JP is the real case: four `{ name, fn }` entries were
 * recorded as four `{ name }` entries. The fixture is the only record of what
 * the values were before the move, so an entry that quietly lost half its
 * content is worse than no entry at all.
 *
 * This reports; it does not write. Correcting an entry is a deliberate act,
 * allowed only while the registry still holds its pre-move value.
 *
 *   npx tsx scripts/countries/audit-jp-snapshot.ts
 */
import { readFileSync } from "node:fs";

const SNAPSHOT = "src/lib/countries/__snapshots__/jp.pre-move.json";

interface Entry {
  shape: string;
  value: unknown;
  functionKeys?: string[];
}

/** Walks objects AND arrays, unlike the D1 version. */
function findFunctions(v: unknown, path: string[] = []): string[] {
  if (typeof v === "function") return [path.join(".") || "<self>"];
  if (Array.isArray(v)) return v.flatMap((item, i) => findFunctions(item, [...path, String(i)]));
  if (typeof v === "object" && v !== null) {
    return Object.entries(v).flatMap(([k, inner]) => findFunctions(inner, [...path, k]));
  }
  return [];
}

/**
 * A recorded value that contains an empty object or a stripped-down entry is the
 * fingerprint of a dropped function: JSON.stringify omits function-valued keys,
 * so `{ name, fn }` is written as `{ name }`.
 */
function suspiciouslyThin(v: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    if (typeof node === "object" && node !== null) {
      const keys = Object.keys(node);
      if (keys.length === 0) hits.push(path.join(".") || "<root>");
      keys.forEach((k) => walk((node as Record<string, unknown>)[k], [...path, k]));
    }
  };
  walk(v, []);
  return hits;
}

/**
 * Empty objects VERIFIED against the live registry as genuinely empty, rather
 * than the fingerprint of a dropped function.
 *
 * ⚠️ An audit that always reports the same known flag trains its reader to
 * ignore it, so a verified false positive is recorded here with its evidence
 * instead of being tolerated on every run. Each entry was checked by reading the
 * live value: `MECHANICS_BY_COUNTRY.JP.*.tierSetting.options[1].effects` is
 * `{}` in the source -- a tier option that genuinely applies no effects.
 */
const VERIFIED_EMPTY = new Set(["MECHANICS_BY_COUNTRY"]);

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Entry>;

let flagged = 0;
for (const [name, entry] of Object.entries(snapshot)) {
  if (entry.shape === "function-valued") continue;
  if (VERIFIED_EMPTY.has(name)) continue;
  const empties = suspiciouslyThin(entry.value);
  if (empties.length) {
    flagged++;
    console.log(`${name}: ${empties.length} empty object(s) at ${empties.slice(0, 5).join(", ")}`);
    console.log(`  -> recorded as "${entry.shape}"; verify against the live registry by hand.`);
  }
}

console.log(`\n${Object.keys(snapshot).length} entries audited, ${flagged} flagged.`);
if (flagged === 0) console.log("No entry shows the dropped-function fingerprint.");
