import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Election-type labels must come from the shared authority
 * (`formatElectionTypeLabel`) or from country config chamber names — never from a
 * hardcoded "U.S. House"/"U.S. Senate" string. This guard walks the election/UI
 * code and fails if a new hardcoded US label leaks in, so the label-fragmentation
 * bug class (US strings rendered for non-US countries) cannot come back.
 *
 * Excluded: `seeds/` and `wiki/` directories, which legitimately hold US-specific
 * descriptive PROSE (wiki articles, achievement text) about the actual US Congress
 * — that is not a per-country election label.
 *
 * ALLOWED_PROSE_FILES carries the same rationale for individual files outside
 * those directories. Keep it narrow: a file belongs here only if its US strings
 * are historical description that happens to name Congress, never if they are
 * labels rendered for a country's chamber.
 */
const EXCLUDED_DIRS = new Set(["node_modules", "seeds", "wiki"]);
const ALLOWED_PROSE_FILES = new Set([
  // SCOTUS case summaries. Wesberry v. Sanders is *about* congressional
  // districting, so its holding cannot be written without naming the US House.
  "src/lib/scotus/presetData/1953.ts",
]);
const US_LABEL = /U\.S\.\s+(House|Senate)/;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("no hardcoded US election labels outside the authority", () => {
  it("has no stray 'U.S. House'/'U.S. Senate' string in election/UI code", () => {
    const offenders = collectSourceFiles("src").filter(
      (f) => !ALLOWED_PROSE_FILES.has(f) && US_LABEL.test(readFileSync(f, "utf8"))
    );
    expect(offenders, `Hardcoded US labels found in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
