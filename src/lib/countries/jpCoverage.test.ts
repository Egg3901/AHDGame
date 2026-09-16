import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ACKNOWLEDGED_OUT_OF_SCOPE, JP_COVERAGE, type Phase } from "./jpCoverage";

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

/**
 * ⚠️ MEMOISED. Each test needs the same denominator, and computing it means
 * walking src/ and scripts/ and reading every file. Doing that four times took
 * long enough to trip the 15s timeout under full-suite parallel load -- a
 * failure that looked like a coverage finding and was really just this test
 * being wasteful.
 */
let cached: string[] | undefined;

function japanBearingFiles(): string[] {
  if (cached) return cached;
  cached = computeJapanBearingFiles();
  return cached;
}

function computeJapanBearingFiles(): string[] {
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
  ...JP_COVERAGE.map((e) => e.file),
  ...ACKNOWLEDGED_OUT_OF_SCOPE.map((e) => e.file),
];

const PHASES: readonly Phase[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];

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

  /**
   * The gap that let the streak continue: coverage was mechanical, assignment
   * was prose, and 126 files sat classified-but-unplanned while this suite went
   * green. `phase` being required makes that a compile error rather than a
   * silent omission; this asserts the value is a real phase and not a typo that
   * would quietly create a phase nobody runs.
   */
  it("gives every classified file a real phase", () => {
    const bad = JP_COVERAGE.filter((e) => !PHASES.includes(e.phase));
    expect(
      bad.map((e) => `${e.file} -> ${e.phase}`),
      "phase must be one of D1-D8"
    ).toEqual([]);
  });

  it("assigns every file that moves to a phase that does the moving", () => {
    // D8 is the gate: it audits and decides, it does not move data. A bucket-A
    // or bucket-D file parked there would be a file nobody actually relocates.
    const parked = JP_COVERAGE.filter(
      (e) => (e.bucket === "A" || e.bucket === "D") && e.phase === "D8"
    );
    expect(
      parked.map((e) => e.file),
      "D8 is the gate; these files move but no phase moves them"
    ).toEqual([]);
  });
});
