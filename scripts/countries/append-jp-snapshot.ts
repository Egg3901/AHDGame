/**
 * APPENDS registries to the pre-move snapshot that the original emitter missed.
 *
 * ⚠️ THIS IS NOT A RE-EMIT. The plan is explicit: the fixture is written once,
 * before anything moves, and never regenerated -- after a phase rewires a
 * registry, the live value is the POST-move value and re-emitting would quietly
 * replace the only independent record of what was there before. When a later
 * phase finds a registry missing, it appends that one entry and nothing else.
 *
 * ⚠️ APPEND ONLY WHAT HAS NOT MOVED YET. Every entry added here must still be
 * holding its original literal. Existing entries are preserved byte-for-byte and
 * the script refuses to overwrite one.
 *
 * Why these four were missing: the emitter's symbol list was extracted from the
 * plan's `Registries:` lines and tables. These four are named only inside a
 * warning paragraph in D3 Step 2 -- the same reason the plan itself calls them
 * the registries "the filter could not see".
 *
 *   npx tsx scripts/countries/append-jp-snapshot.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ORDERS_BY_COUNTRY } from "../../src/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "../../src/lib/constants/cabinetMechanics";
import { GROUPS } from "../../src/lib/constants/cabinetPositionGroups";
import { PARLIAMENTARY_CABINET_CONFIGS } from "../../src/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";
import {
  JP_GOVERNOR_SEATS,
  JP_SANGIIN_SEATS,
  JP_SHUGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
} from "../../src/lib/constants/states";

const COUNTRY = "JP";
const OUT = "src/lib/countries/__snapshots__/jp.pre-move.json";

const ADDITIONS: Record<string, unknown> = {
  ORDERS_BY_COUNTRY,
  MECHANICS_BY_COUNTRY,
  GROUPS,
  PARLIAMENTARY_CABINET_CONFIGS,
  // Japan's canonical chamber seat tables. They live in constants/states.ts,
  // which is not Japan-named and carries no `JP:` key, so four earlier coverage
  // rules and the original emitter's symbol list all missed them.
  JP_SHUGIIN_SEATS,
  JP_SANGIIN_SEATS,
  JP_GOVERNOR_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fnKeys(v: unknown): string[] {
  if (typeof v === "function") return ["<self>"];
  if (!isObj(v)) return [];
  const out: string[] = [];
  for (const [k, inner] of Object.entries(v)) {
    if (typeof inner === "function") out.push(k);
    else for (const deeper of fnKeys(inner)) out.push(k + "." + deeper);
  }
  return out;
}

/** Same shape rules as the original emitter, so entries stay comparable. */
function extract(
  name: string,
  registry: unknown
): { shape: string; value: unknown; functionKeys?: string[] } {
  // A JP_-prefixed registry IS Japan's in full: every key is one of Japan's
  // regions or chambers, so there is no "JP" key to find.
  if (/^(JP|TOTAL_JP)[_A-Z]/.test(name)) {
    return { shape: "whole-registry", value: registry ?? null };
  }
  if (!isObj(registry)) return { shape: "absent", value: null };
  if (COUNTRY in registry) {
    const value = registry[COUNTRY];
    const fns = fnKeys(value);
    return fns.length
      ? { shape: "function-valued", value: null, functionKeys: fns }
      : { shape: "country-first", value: value ?? null };
  }
  const outer: Record<string, unknown> = {};
  for (const [k, inner] of Object.entries(registry)) {
    if (isObj(inner) && COUNTRY in inner) outer[k] = inner[COUNTRY] ?? null;
  }
  if (Object.keys(outer).length) return { shape: "outer-keyed", value: outer };
  return { shape: "absent", value: null };
}

const snapshot = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>;
const before = Object.keys(snapshot).length;

for (const [name, registry] of Object.entries(ADDITIONS)) {
  if (name in snapshot) {
    // Skip, never overwrite: the existing entry is the pre-move record, and
    // after a phase rewires a registry the live value is the POST-move one.
    console.log(`skipped ${name} (already recorded)`);
    continue;
  }
  const entry = extract(name, registry);
  if (entry.shape === "absent") {
    throw new Error(`${name}: found no Japan entry. Verify by hand before appending.`);
  }
  snapshot[name] = entry;
  console.log(`appended ${name} (${entry.shape})`);
}

writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log(`fixture: ${before} -> ${Object.keys(snapshot).length} registries`);
