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
 * The denominator is a UNION OF FIVE GROUND TRUTHS. Each was added because the
 * previous set shipped green while missing real Japan payload:
 *
 *   1. JP object key       `JP:` / `"JP":` / `"JP:HOK"`, any surrounding type
 *   2. Japan-named file    basename token `jp`/`japan`, or under a `jp/` dir
 *   3. jp_<slug> key       `jp_national`, `jp_ldp`, `jp_resident_tax`
 *   4. country comparison  `=== "JP"` / `case "JP"` (no colon, so rule 1 misses it)
 *   5. Japan symbol decl   `export const JP_SHUGIIN_SEATS = ...` in a file that
 *                          is not Japan-named and has no JP key at all
 *
 * Rule 5 was the third recurrence of the same failure. Japan's canonical chamber
 * seat tables -- JP_SHUGIIN_SEATS (465), JP_SANGIIN_SEATS (248),
 * JP_GOVERNOR_SEATS -- live in constants/states.ts, which rules 1 to 4 all miss.
 * Ten files hold Japan payload that way.
 *
 * JPY, JPEG and JPG are not Japan. They are a currency and two image formats,
 * and matching them pulled in 130+ irrelevant files, so rule 5 excludes them and
 * looks for a DECLARATION rather than any mention.
 *
 * CONSUMERS ARE DELIBERATELY EXCLUDED. A file that merely imports
 * JP_SANGIIN_SEATS needs its import path updated, and `npm run typecheck` fails
 * loudly if a move breaks it. A file that DECLARES Japan payload gets no such
 * warning, which is why declarations are in scope and references are not.
 *
 * The walk covers scripts/ as well as src/, since generators and seed runners
 * hold Japan facts too. scripts/debug/ is excluded: it is a scratch area of
 * one-off investigation scripts, untracked in bulk.
 */
const JP_KEY = /(^|[^A-Za-z_"])JP\s*:|"JP"\s*:|"JP:/;
const JP_SLUG = /\bjp_[a-z0-9_]+/;
const JP_COMPARISON = /===\s*"JP"|"JP"\s*===|\bcase\s+"JP"\b/;
const JP_DECLARATION =
  /\b(?:export\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(JP[_A-Z][A-Za-z0-9_]*|Japan[A-Z][A-Za-z0-9_]*)/g;
/** A currency and two image formats, not a country. */
const NOT_JAPAN = /^(JPY|JPEG|JPG)([_A-Z]|$)/;

const ROOTS = ["src", "scripts"];

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

function declaresJapanSymbol(source: string): boolean {
  for (const match of source.matchAll(JP_DECLARATION)) {
    if (!NOT_JAPAN.test(match[1])) return true;
  }
  return false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(tsx?|mjs|cjs|js)$/.test(entry) && !entry.includes(".test.")) {
      out.push(full.split("\\").join("/"));
    }
  }
  return out;
}

function japanBearingFiles(): string[] {
  return (
    ROOTS.flatMap((root) => walk(root))
      // Only this module is excluded, so its own doc comment cannot pad the
      // denominator. The DESTINATION folder stays in scope on purpose: as bucket-D
      // files move into src/lib/countries/jp/, their roster entry must follow them,
      // which keeps the migration visible instead of silently emptying the set.
      .filter((f) => f !== "src/lib/countries/jpCoverage.ts")
      // Scratch area of one-off investigation scripts, untracked in bulk.
      .filter((f) => !f.startsWith("scripts/debug/"))
      .filter((f) => {
        if (isJapanNamed(f)) return true;
        const source = readFileSync(f, "utf8");
        return (
          JP_KEY.test(source) ||
          JP_SLUG.test(source) ||
          JP_COMPARISON.test(source) ||
          declaresJapanSymbol(source)
        );
      })
      .sort()
  );
}

const allBuckets = () => [
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
    const classified = new Set<string>(allBuckets());
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
    const duplicated = allBuckets().filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(duplicated, `classified in more than one bucket: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("lists no file that has stopped carrying Japan", () => {
    // Keeps the roster from rotting as the tree changes underneath it.
    const bearing = new Set(japanBearingFiles());
    const stale = allBuckets().filter((f) => !bearing.has(f));
    expect(stale, `no longer carries Japan: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives every out-of-scope entry a reason", () => {
    const unexplained = ACKNOWLEDGED_OUT_OF_SCOPE.filter((e) => e.why.trim().length < 15);
    expect(unexplained.map((e) => e.file)).toEqual([]);
  });
});
