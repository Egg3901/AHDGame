import { describe, expect, it } from "vitest";
import { INDEX_DEFINITIONS } from "@/app/api/admin/migrations/create-indexes/route";
import {
  ALL_WRITE_GUARD_INDEXES,
  ELECTION_WRITE_GUARD_INDEXES,
  GOVERNANCE_WRITE_GUARD_INDEXES,
} from "./writeGuardSpecs";

const key = (t: readonly [string, unknown, unknown?]) =>
  `${t[0]}|${JSON.stringify(t[1])}|${JSON.stringify(t[2] ?? {})}`;

describe("write-guard index specs", () => {
  it("is the union of its two halves, in bootstrap order", () => {
    expect(ALL_WRITE_GUARD_INDEXES).toEqual([
      ...ELECTION_WRITE_GUARD_INDEXES,
      ...GOVERNANCE_WRITE_GUARD_INDEXES,
    ]);
  });

  it("every guard is created by the on-demand route too", () => {
    // The whole point of the shared list: the bootstrap seeder and the repair
    // route must create byte-identical indexes. Before consolidation the route
    // was missing three guards entirely (both uniq_open_vote_per_corp indexes
    // and uniq_ruling_party_per_country), so a route-repaired database lacked
    // race guards a bootstrapped one had.
    const routeKeys = new Set(
      INDEX_DEFINITIONS.map((d) => key(d as readonly [string, unknown, unknown?]))
    );
    const missing = ALL_WRITE_GUARD_INDEXES.filter(
      (g) => !routeKeys.has(key(g as readonly [string, unknown, unknown?]))
    );
    expect(missing).toEqual([]);
  });

  it("names every guard explicitly", () => {
    // An unnamed index gets an auto-generated name, and creating the same key
    // pattern under two different names is what made every embargo attempt
    // 500 on IndexOptionsConflict (#570).
    for (const [collection, , options] of ALL_WRITE_GUARD_INDEXES) {
      expect((options as { name?: string }).name, collection).toBeTruthy();
    }
  });

  it("keeps index names unique WITHIN each collection", () => {
    // Mongo scopes index names per collection, so the same name on two
    // different collections is fine — `uniq_open_vote_per_corp` is
    // deliberately reused across corporationPrivatizationVotes and
    // corporationVotes. A repeat within ONE collection would be a real clash.
    const seen = new Map<string, Set<string>>();
    for (const [collection, , options] of ALL_WRITE_GUARD_INDEXES) {
      const name = (options as { name: string }).name;
      const forCollection = seen.get(collection) ?? new Set<string>();
      expect(forCollection.has(name), `${collection}.${name}`).toBe(false);
      forCollection.add(name);
      seen.set(collection, forCollection);
    }
  });

  it("marks every guard unique — a non-unique 'guard' guards nothing", () => {
    for (const [collection, , options] of ALL_WRITE_GUARD_INDEXES) {
      expect((options as { unique?: boolean }).unique, collection).toBe(true);
    }
  });
});
