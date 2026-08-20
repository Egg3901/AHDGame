import { describe, expect, it } from "vitest";
import { INDEX_TARGETS, INDEX_TARGET_IDS } from "./indexTargets";
import { INDEX_MODULE_REGISTRY } from "./seedIndexes";

/**
 * The gap this suite exists to close: the id ↔ module pairing used to be
 * maintained by hand in three places — the module array, the seed route's
 * target list, and the Universal Seeder's rows. It drifted, and eight modules
 * ended up runnable only from bootstrap and full reset. On a world already
 * running they could not be reached at all.
 *
 * Most of the guarantee is now structural rather than tested: `INDEX_RUNNERS`
 * is a `Record<IndexTargetId, IndexModule>`, so a target with no runner is a
 * compile error, and both the route and the UI derive their lists from
 * `INDEX_TARGETS`. These hold the parts the type system cannot.
 */
describe("index seeder targets", () => {
  it("gives every target a runner, and every runner a target", () => {
    expect(INDEX_MODULE_REGISTRY.map((m) => m.id)).toEqual([...INDEX_TARGET_IDS]);
    for (const entry of INDEX_MODULE_REGISTRY) {
      expect(typeof entry.run, entry.id).toBe("function");
    }
  });

  it("has no duplicate ids", () => {
    // A duplicate would make the later entry unreachable through the route's
    // `includes` dispatch while still looking present in the UI.
    const ids = INDEX_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names every target so the seeder UI can group them", () => {
    for (const target of INDEX_TARGETS) {
      expect(target.id, target.id).toMatch(/^indexes[A-Z]/);
      expect(target.label, target.id).toMatch(/^Indexes — /);
      expect(target.description.length, target.id).toBeGreaterThan(20);
    }
  });

  it("covers the modules that carry a correctness guarantee, not just perf", () => {
    // These two are why the drift mattered: both create a UNIQUE index that
    // something else relies on for correctness, so a world missing them is
    // quietly broken rather than quietly slow.
    const ids = new Set<string>(INDEX_TARGET_IDS);
    expect(ids.has("indexesConflict")).toBe(true);
    expect(ids.has("indexesSettlement")).toBe(true);
  });

  it("stays client-safe — no db imports anywhere in its import graph", async () => {
    // The Universal Seeder is a client component and imports this module. If it
    // ever pulls in `mongodb`, `next build` breaks in a way neither typecheck
    // nor the rest of this suite can see.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./indexTargets.ts", import.meta.url), "utf-8")
    );
    expect(source).not.toMatch(/from\s+["']mongodb["']/);
    expect(source).not.toMatch(/from\s+["'].*\/(db|mongodb)["']/);
    expect(source).not.toMatch(/^import\s/m);
  });
});
