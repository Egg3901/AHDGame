import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No `"use client"` module imports a country barrel.
 *
 * ⚠️ WHY A SEPARATE TEST. The architecture audit already has a transitive
 * client-to-server-only import check, which covers the `getDb`/`mongodb` half of
 * this. It does NOT cover the bundle-size half: `countries/jp/index.ts` composes
 * identity, institutions, elections, economy, geography and all seven era files.
 * A client component that wanted one label would pull every one of them into the
 * browser bundle, and nothing would fail -- the page would just get bigger.
 *
 * The rule is LEAF MODULES ONLY from client code:
 *
 *   ✗ import { JP } from "@/lib/countries/jp";
 *   ✓ import { JP_IDENTITY } from "@/lib/countries/jp/identity";
 *
 * ⚠️ This checks DIRECT imports from files carrying the directive. A server
 * module imported by a client component is the transitive case the architecture
 * audit owns; duplicating its graph walk here would be a second implementation
 * to keep in sync.
 */
const ROOTS = ["src/app", "src/components", "src/lib", "src/contexts", "src/hooks"];

/** `@/lib/countries/<cc>` or a relative path ending there, with nothing after. */
const BARREL_IMPORT =
  /from\s+["'](?:@\/lib\/countries\/[a-z]{2}|(?:\.{1,2}\/)+countries\/[a-z]{2}|\.{1,2}\/(?:jp|us|uk|de|ie|br|cn|ng))["']/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push(full.split("\\").join("/"));
    }
  }
  return out;
}

function clientModules(): { file: string; source: string }[] {
  return ROOTS.flatMap(walk)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => {
      const head = source.trimStart();
      return head.startsWith('"use client"') || head.startsWith("'use client'");
    });
}

describe("country barrels are server-side only", () => {
  it("is checked against a non-trivial set of client modules", () => {
    // Guards the guard: a walk that silently found nothing would pass the real
    // assertion below while checking absolutely nothing.
    expect(clientModules().length).toBeGreaterThan(100);
  });

  it("has no client module importing a country barrel", () => {
    const offenders = clientModules()
      .filter(({ source }) => BARREL_IMPORT.test(source))
      .map(({ file }) => file);

    expect(
      offenders,
      `\n${offenders.length} client module(s) import a country barrel:\n` +
        offenders.map((f) => `  ${f}`).join("\n") +
        `\n\nImport the specific module instead -- e.g. countries/jp/identity, not countries/jp.\n` +
        `The barrel pulls elections (which reaches getDb) and all seven era files.\n`
    ).toEqual([]);
  });
});
