import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { CONVERTED } from "./singleCountryData";

/**
 * Leaf modules that client-reachable registries read must stay weightless.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT `noClientBarrelImport.test.ts`. That
 * test bans client code from importing a country BARREL, because the barrel
 * composes the whole folder and reaches `getDb`. It says nothing about leaf
 * modules, and the assumption underneath it -- that a leaf is small -- is false
 * for `geography.ts`, which imports all seven eras of region, census,
 * demographic and metric data as VALUES.
 *
 * The failure this catches actually happened. Japan's map anchor and region
 * count were first parked on `geography.ts`, and two registries that client
 * components import (`maps/countryAnchors`, `politicalStrength/
 * strengthConstants`) were repointed at it. Everything compiled, every test
 * passed, and three numbers now dragged Japan's entire region dataset into the
 * browser bundle. Nothing fails when this happens; the page just gets bigger.
 *
 * So: a folder module named here is one a client-reachable registry reads, and
 * it must contain NO value imports. `import type` is free -- it is erased.
 */
const CLIENT_SAFE_MODULES = [
  "geographyFacts.ts",
  "institutionsFacts.ts",
  "economy.ts",
  "identity.ts",
  "cabinet/positions.ts",
];

/**
 * ⚠️ DERIVED ACROSS EVERY COUNTRY, not listed for one. The MODULE NAMES above are
 * the deliberate part -- each is a leaf a client-reachable registry reads. Which
 * COUNTRIES are covered is not a judgement call: the registries forward all 29
 * uniformly, so a list naming only Japan checked one twenty-ninth of the surface
 * it claimed to. It went stale the moment the second country moved, and stayed
 * that way until `COUNTRY_COMMAND_FLAVOR` -- read by `SituationBoardClient` --
 * started importing all 29 `identity.ts` modules.
 */
const COUNTRY_DIRS = readdirSync("src/lib/countries")
  .filter((cc) => statSync(join("src/lib/countries", cc)).isDirectory())
  .filter((cc) => /^[a-z]{2,3}$/.test(cc));

const CLIENT_SAFE = [
  ...COUNTRY_DIRS.flatMap((cc) =>
    CLIENT_SAFE_MODULES.map((m) => `src/lib/countries/${cc}/${m}`)
  ).filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  }),
  "src/lib/countries/ru/russian1991Config.ts",
];

/**
 * Registries whose weight is INHERENT, not introduced by the country move.
 *
 * ⚠️ THE BAR FOR THIS LIST IS EVIDENCE, NOT INCONVENIENCE. An entry belongs here
 * only if the registry was already pulling comparable data as values BEFORE
 * Japan moved, so pointing it at the folder changed nothing about what ships.
 * "It is awkward to split" is not a reason; it is the reason the list would rot.
 *
 * `regionCensusData` is the one case that clears it: at the branch point it
 * already had 63 value imports, one per country per era, because a registry of
 * every country's census bundles cannot be lighter than the bundles. Forwarding
 * Japan's slice to the folder replaced one heavy import with another.
 */
const INHERENTLY_HEAVY = ["src/lib/seeds/regionCensusData.ts"];

/**
 * Exact boundary inherited by the transitive graph walk when it was added.
 * The list is hashed so a new edge cannot hide inside a broad allowlist, while
 * keeping 200-plus historical source/target pairs out of this test file.
 */
const LEGACY_TRANSITIVE_COUNTRY_BOUNDARY = {
  count: 205,
  sha256: "b679a1aa1ee7e2ac28969af4791cdb55532b66dffdfa14ee86421fe3d085be6e",
} as const;

/** `import ... from` that is not `import type ... from`, and not a bare side-effect import. */
const VALUE_IMPORT = /^import\s+(?!type\s)[^;]*?from\s+["'][^"']+["']/gm;

const STATIC_MODULE_REFERENCE =
  /(?:^|\n)\s*(?:(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']|import\s+["']([^"']+)["'])/g;
const DYNAMIC_MODULE_REFERENCE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

function moduleSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(STATIC_MODULE_REFERENCE)) {
    specs.push(match[1] ?? match[2]);
  }
  for (const match of source.matchAll(DYNAMIC_MODULE_REFERENCE)) specs.push(match[1]);
  return specs;
}

function resolveLocalModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join("src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;

  const candidates = /\.tsx?$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return relative(resolve("."), resolve(candidate)).split("\\").join("/");
      }
    } catch {
      // Try the next supported TypeScript module shape.
    }
  }
  return null;
}

describe("client-reachable country leaf modules carry no runtime imports", () => {
  it.each(CLIENT_SAFE)("%s has no value imports", (file) => {
    const source = readFileSync(file, "utf8");
    const offenders = source.match(VALUE_IMPORT) ?? [];
    expect(
      offenders,
      `\n${file} gained ${offenders.length} value import(s):\n` +
        offenders.map((o) => `  ${o.trim()}`).join("\n") +
        `\n\nA client component reads this module through a registry forwarder.\n` +
        `A value import here ships that module, and everything it imports, to the\n` +
        `browser. Use \`import type\`, or move the heavy part to a sibling module.\n`
    ).toEqual([]);
  });

  /**
   * Guards the guard. If a path in CLIENT_SAFE is renamed away, `readFileSync`
   * would throw -- but a path that is silently deleted from the list would let
   * the real assertion pass while checking nothing.
   */
  it("checks every listed module, and every listed module exists", () => {
    expect([...COUNTRY_DIRS].sort()).toEqual(CONVERTED.map((cc) => cc.toLowerCase()).sort());
    for (const cc of COUNTRY_DIRS) {
      for (const leafModule of [
        "geographyFacts.ts",
        "institutionsFacts.ts",
        "economy.ts",
        "identity.ts",
      ]) {
        expect(CLIENT_SAFE).toContain(`src/lib/countries/${cc}/${leafModule}`);
      }
    }
    for (const file of CLIENT_SAFE) {
      expect(statSync(file).isFile(), `${file} is missing`).toBe(true);
    }
  });

  /**
   * ⚠️ The list above is hand-maintained, so it can go stale in the one
   * direction that matters: a NEW registry starts forwarding to a heavy folder
   * module. This finds that case by walking the registries that client code
   * imports and checking what they pull out of the folder.
   */
  it("does not change the exact legacy transitive heavy-module boundary", () => {
    const CLIENT_ROOTS = ["src/app", "src/components", "src/hooks", "src/contexts"];
    const clientEntries = CLIENT_ROOTS.flatMap(sourceFiles)
      .map((file) => file.split("\\").join("/"))
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));

    // Walk the complete local runtime-import graph from every client entry.
    // Stopping after one hop missed client -> helper -> registry -> folder.
    const reachable = new Set<string>();
    const offenders = new Set<string>();
    const pending = [...clientEntries];
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file || reachable.has(file)) continue;
      reachable.add(file);
      if (INHERENTLY_HEAVY.includes(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        const target = resolveLocalModule(file, specifier);
        if (!target) continue;
        if (/^src\/lib\/countries\/[a-z]{2,3}\//.test(target)) {
          // Inspect the boundary edge, then stop. Once a heavy country module
          // is entered, reporting every descendant obscures the registry that
          // actually pulled it into the client graph.
          if (!CLIENT_SAFE.includes(target)) {
            const heavy = (readFileSync(target, "utf8").match(VALUE_IMPORT) ?? []).length;
            if (heavy > 0) offenders.add(`${file}\n    -> ${target} (${heavy} value imports)`);
          }
          continue;
        }
        if (!reachable.has(target)) pending.push(target);
      }
    }

    const offenderList = [...offenders].sort();
    const boundary = {
      count: offenderList.length,
      sha256: createHash("sha256").update(offenderList.join("\n")).digest("hex"),
    };

    expect(
      boundary,
      `\nThe client-reachable heavy country-module boundary changed:\n\n` +
        offenderList.map((o) => `  ${o}`).join("\n\n") +
        `\n\nIf an edge was removed, update the exact baseline. If one was added,\n` +
        `move the value to a client-safe leaf or stop the client from reaching it.\n`
    ).toEqual(LEGACY_TRANSITIVE_COUNTRY_BOUNDARY);
  });
});
