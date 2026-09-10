import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ACKNOWLEDGED_OUT_OF_SCOPE,
  BUCKET_A_MOVES,
  BUCKET_B_RELATIONAL,
  BUCKET_C_DERIVED,
  BUCKET_D_RELOCATE,
  BUCKET_E_CLIENT,
  BUCKET_F_CONDITIONAL,
} from "./jpCoverage";

/**
 * Every Japan-bearing file is classified.
 *
 * The denominator is a UNION OF FOUR GROUND TRUTHS, not one test. The first
 * version of this file matched a JP object key and nothing else, which was the
 * rev-8 mistake one level up: it replaced a union of detection heuristics with a
 * single detection heuristic promoted to ground truth. Measured, it missed 47 of
 * the 48 Japan-NAMED source files (~17,000 LOC) -- a file that *is* Japan
 * carries no `JP:` key -- plus 32 files keyed `jp_<slug>` and 9 that branch on
 * `=== "JP"` (no colon, so outside a key regex).
 *
 *   1. JP object key       `JP:` / `"JP":` / `"JP:HOK"` -- any surrounding type
 *   2. Japan-named file    basename token `jp`/`japan`, or under a `jp/` dir
 *   3. jp_<slug> key       `jp_national`, `jp_ldp`, `jp_resident_tax`
 *   4. country comparison  `=== "JP"` / `case "JP"`
 *
 * Adding a Japan-bearing file fails this test until it is classified.
 */
const JP_KEY = /(^|[^A-Za-z_"])JP\s*:|"JP"\s*:|"JP:/;
const JP_SLUG = /\bjp_[a-z0-9_]+/;
const JP_COMPARISON = /===\s*"JP"|"JP"\s*===|\bcase\s+"JP"\b/;

const SRC = "src";

/** Split camelCase and delimiters so `seedJP.ts` and `JPDietPage.tsx` both tokenize. */
function nameTokens(file: string): Set<string> {
  const spaced = basename(file)
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ");
  return new Set(
    spaced
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase())
  );
}

function isJapanNamed(file: string): boolean {
  const tokens = nameTokens(file);
  return (
    tokens.has("jp") || tokens.has("japan") || file.includes("/jp/") || file.includes("/japan/")
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push(full.replace(/\\/g, "/"));
    }
  }
  return out;
}

function japanBearingFiles(): string[] {
  return (
    walk(SRC)
      // Only this module is excluded, so its own doc comment cannot pad the
      // denominator. The DESTINATION folder stays in scope on purpose: as bucket-D
      // files move into src/lib/countries/jp/, their roster entry must follow them,
      // which keeps the migration visible instead of silently emptying the set.
      .filter((f) => f !== "src/lib/countries/jpCoverage.ts")
      .filter((f) => {
        if (isJapanNamed(f)) return true;
        const source = readFileSync(f, "utf8");
        return JP_KEY.test(source) || JP_SLUG.test(source) || JP_COMPARISON.test(source);
      })
      .sort()
  );
}

const ALL_BUCKETS = () => [
  ...BUCKET_A_MOVES,
  ...BUCKET_B_RELATIONAL,
  ...BUCKET_C_DERIVED,
  ...BUCKET_D_RELOCATE,
  ...BUCKET_E_CLIENT,
  ...BUCKET_F_CONDITIONAL,
  ...ACKNOWLEDGED_OUT_OF_SCOPE.map((e) => e.file),
];

describe("Japan coverage", () => {
  it("classifies every file that carries Japan", () => {
    const classified = new Set<string>(ALL_BUCKETS());
    const unclassified = japanBearingFiles().filter((f) => !classified.has(f));

    expect(
      unclassified,
      `\n${unclassified.length} Japan-bearing file(s) are in no bucket:\n` +
        unclassified.map((f) => `  ${f}`).join("\n") +
        `\n\nAdd each to a bucket in jpCoverage.ts, or to ACKNOWLEDGED_OUT_OF_SCOPE with a reason.\n`
    ).toEqual([]);
  });

  it("puts each file in exactly one bucket", () => {
    const seen = new Set<string>();
    const duplicated = ALL_BUCKETS().filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(duplicated, `classified in more than one bucket: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("lists no file that has stopped carrying Japan", () => {
    // Keeps the roster from rotting as the tree changes underneath it.
    const bearing = new Set(japanBearingFiles());
    const stale = ALL_BUCKETS().filter((f) => !bearing.has(f));
    expect(stale, `no longer carries Japan: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives every out-of-scope entry a reason", () => {
    const unexplained = ACKNOWLEDGED_OUT_OF_SCOPE.filter((e) => e.why.trim().length < 15);
    expect(unexplained.map((e) => e.file)).toEqual([]);
  });
});
