import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEED_MANIFEST } from "../../src/lib/admin/seed/seedManifest";
import { collectSeedIndexPlan } from "../../src/lib/admin/seed/indexes/plan";
import { missingCollectionIndexPolicies } from "./collectionIndexCoverage";

describe("new collection index lifecycle", () => {
  it("rejects a new world collection without bootstrap indexes or an explicit policy", () => {
    expect(
      missingCollectionIndexPolicies(
        [{ name: "newVotes", category: "runtime" }],
        new Set(),
        new Set()
      )
    ).toEqual(["newVotes"]);
  });
  it("accepts indexes recreated by bootstrap, or a reason for primary-key access", () => {
    expect(
      missingCollectionIndexPolicies(
        [{ name: "newVotes", category: "runtime" }],
        new Set(["newVotes"]),
        new Set()
      )
    ).toEqual([]);
    expect(
      missingCollectionIndexPolicies(
        [{ name: "newSingleton", category: "runtime" }],
        new Set(),
        new Set(),
        { newSingleton: "One singleton addressed by _id." }
      )
    ).toEqual([]);
  });
  it("rejects an empty justification", () => {
    expect(
      missingCollectionIndexPolicies(
        [{ name: "newVotes", category: "runtime" }],
        new Set(),
        new Set(),
        { newVotes: " " }
      )
    ).toEqual(["newVotes"]);
  });
  it("keeps every new world collection covered after indexes are dropped by reset", async () => {
    const legacy = JSON.parse(
      readFileSync("scripts/architecture/collectionIndexCoverage.legacy.json", "utf8")
    ) as { collections: string[] };
    const plan = await collectSeedIndexPlan();
    const missing = missingCollectionIndexPolicies(
      SEED_MANIFEST,
      new Set(plan.map((entry) => entry.collection)),
      new Set(legacy.collections)
    );
    expect(
      missing,
      "Add indexes to the bootstrap seed plan, or document a bounded primary-key-only access pattern. A historical migration marker does not restore dropped indexes."
    ).toEqual([]);
  });
});
