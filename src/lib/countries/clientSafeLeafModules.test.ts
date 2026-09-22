import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
const CLIENT_SAFE = readdirSync("src/lib/countries")
  .filter((cc) => statSync(join("src/lib/countries", cc)).isDirectory())
  .flatMap((cc) => CLIENT_SAFE_MODULES.map((m) => `src/lib/countries/${cc}/${m}`))
  .filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });

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

/** `import ... from` that is not `import type ... from`, and not a bare side-effect import. */
const VALUE_IMPORT = /^import\s+(?!type\s)[^;]*?from\s+["'][^"']+["']/gm;

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
    // 29 countries x 4 always-present modules; the floor catches a discovery
    // walk that silently returns nothing.
    expect(CLIENT_SAFE.length).toBeGreaterThanOrEqual(29 * 4);
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
  it("finds no client-reachable registry importing a heavy folder module", () => {
    const CLIENT_ROOTS = ["src/app", "src/components", "src/hooks", "src/contexts"];
    const walk = (dir: string): string[] => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return [];
      }
      return entries.flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
      });
    };

    const clientSources = CLIENT_ROOTS.flatMap(walk)
      .map((file) => readFileSync(file, "utf8"))
      .filter((source) => /^\s*["']use client["']/.test(source));

    // Every `@/lib/...` module a client component imports directly.
    const reachable = new Set<string>();
    for (const source of clientSources) {
      for (const [, spec] of source.matchAll(/from\s+["'](@\/lib\/[^"']+)["']/g)) {
        reachable.add(`src/${spec.slice("@/".length)}.ts`);
      }
    }

    const offenders: string[] = [];
    for (const file of reachable) {
      if (INHERENTLY_HEAVY.includes(file)) continue;
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue; // .tsx, a directory index, or a path we do not resolve -- not ours to police
      }
      // ⚠️ ONE capture group, deliberately. An earlier draft wrapped the whole
      // statement in a second group and destructured `[stmt, spec]`, which
      // binds `spec` to the STATEMENT rather than the path. Every lookup then
      // threw, hit the `catch` below, and this assertion silently checked
      // nothing while reporting green. Mutation-testing the guard found it;
      // reading it did not.
      for (const match of source.matchAll(
        /(?:^|\n)import\s+(?!type\s)[^;]*?from\s+["'](@\/lib\/countries\/[a-z]{2,3}\/[^"']+)["']/g
      )) {
        const stmt = match[0];
        const spec = match[1];
        const target = `src/${spec.slice("@/".length)}.ts`;
        if (CLIENT_SAFE.includes(target)) continue;
        let targetSource: string;
        try {
          targetSource = readFileSync(target, "utf8");
        } catch {
          continue;
        }
        const heavy = (targetSource.match(VALUE_IMPORT) ?? []).length;
        if (heavy > 0) {
          offenders.push(`${file}\n    -> ${target} (${heavy} value imports)\n    ${stmt.trim()}`);
        }
      }
    }

    expect(
      offenders,
      `\n${offenders.length} client-reachable registr(y/ies) forward to a heavy folder module:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n\n") +
        `\n\nEither move the value to a sibling module with no value imports and\n` +
        `add it to CLIENT_SAFE, or stop the client from reaching this registry.\n`
    ).toEqual([]);
  });
});
