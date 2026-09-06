import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCollectionCategory } from "./seedManifest";

const COLLECTIONS_DIR = join(process.cwd(), "src/lib/db/collections");

/**
 * A collection missing from SEED_MANIFEST is invisible to `resetGameWorld`,
 * which sweeps `getRuntimeCollectionNames()` — so it silently survives every
 * world reset. `covertNuclearPrograms` did exactly that: per-country covert
 * programme stage, progress and breakout turn carried across resets, so a
 * fresh world could open with a country already mid-breakout (flagged in
 * #1246, fixed here).
 *
 * Nothing caught the omission, because the reset tests iterate the manifest —
 * they verify what IS classified, never what is missing. This closes that by
 * walking the other way: every collection name a `src/lib/db/collections/`
 * module declares must carry a manifest classification.
 */
describe("seed manifest classification coverage", () => {
  const declared = readdirSync(COLLECTIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => {
      const src = readFileSync(join(COLLECTIONS_DIR, f), "utf8");
      return [...src.matchAll(/export const [A-Z0-9_]*COLLECTION[A-Z0-9_]* = "([^"]+)"/g)].map(
        (m) => ({ file: f, name: m[1] })
      );
    });

  it("finds the declared collection constants to check", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)("classifies $name (declared in $file)", ({ name }) => {
    expect(
      getCollectionCategory(name),
      `collection "${name}" has no SEED_MANIFEST entry, so resetGameWorld will never wipe it — add it to SEED_MANIFEST`
    ).toBeDefined();
  });
});
