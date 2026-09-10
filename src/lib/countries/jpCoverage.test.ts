import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACKNOWLEDGED_OUT_OF_SCOPE,
  BUCKET_A_MOVES,
  BUCKET_B_RELATIONAL,
  BUCKET_C_DERIVED,
  BUCKET_E_CLIENT,
  BUCKET_F_CONDITIONAL,
} from "./jpCoverage";

/**
 * Every Japan-bearing file is classified.
 *
 * ⚠️ The denominator is deliberately SHAPE-BLIND. Earlier attempts enumerated
 * files via detection heuristics — a `Record<CountryId` filter, a `jp*` glob, a
 * composite-key grep, a `=== "JP"` grep — and every one of those heuristics had
 * a blind spot the enumeration then inherited. Measured, they reached 71 of the
 * 129 files that actually carry a Japan key.
 *
 * So the rule is: match a Japan OBJECT KEY, whatever the surrounding type. Then
 * require every match to be classified. Heuristics can help you find things;
 * they cannot define what counts.
 */
const JP_KEY = /(^|[^A-Za-z_"])JP\s*:|"JP"\s*:|"JP:/;

const SRC = "src";

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
      // The destination folder is not a source of Japan facts; excluding it also
      // stops this module's own doc comment matching the denominator.
      .filter((f) => !f.startsWith("src/lib/countries/"))
      .filter((f) => JP_KEY.test(readFileSync(f, "utf8")))
      .sort()
  );
}

describe("Japan coverage", () => {
  it("classifies every file that carries a Japan key", () => {
    const classified = new Set<string>([
      ...BUCKET_A_MOVES,
      ...BUCKET_B_RELATIONAL,
      ...BUCKET_C_DERIVED,
      ...BUCKET_E_CLIENT,
      ...BUCKET_F_CONDITIONAL,
      ...ACKNOWLEDGED_OUT_OF_SCOPE.map((e) => e.file),
    ]);

    const unclassified = japanBearingFiles().filter((f) => !classified.has(f));

    expect(
      unclassified,
      `\n${unclassified.length} Japan-bearing file(s) are in no bucket:\n` +
        unclassified.map((f) => `  ${f}`).join("\n") +
        `\n\nAdd each to a bucket in jpCoverage.ts, or to ACKNOWLEDGED_OUT_OF_SCOPE with a reason.\n`
    ).toEqual([]);
  });

  it("puts each file in exactly one bucket", () => {
    const all = [
      ...BUCKET_A_MOVES,
      ...BUCKET_B_RELATIONAL,
      ...BUCKET_C_DERIVED,
      ...BUCKET_E_CLIENT,
      ...BUCKET_F_CONDITIONAL,
      ...ACKNOWLEDGED_OUT_OF_SCOPE.map((e) => e.file),
    ];
    const seen = new Set<string>();
    const duplicated = all.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(duplicated, `classified in more than one bucket: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("lists no file that has stopped carrying a Japan key", () => {
    // Keeps the lists from rotting as the tree changes underneath them.
    const bearing = new Set(japanBearingFiles());
    const stale = [
      ...BUCKET_A_MOVES,
      ...BUCKET_B_RELATIONAL,
      ...BUCKET_C_DERIVED,
      ...BUCKET_E_CLIENT,
      ...BUCKET_F_CONDITIONAL,
    ].filter((f) => !bearing.has(f));
    expect(stale, `no longer carries a JP key: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives every out-of-scope entry a reason", () => {
    const unexplained = ACKNOWLEDGED_OUT_OF_SCOPE.filter((e) => e.why.trim().length < 15);
    expect(unexplained.map((e) => e.file)).toEqual([]);
  });
});
