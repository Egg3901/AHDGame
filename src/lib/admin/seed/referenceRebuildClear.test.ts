import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Db } from "mongodb";
import {
  REFERENCE_REBUILD_CLEARED_COLLECTIONS,
  clearReferenceForRebuild,
} from "./referenceRebuildClear";
import { getCollectionCategory } from "./seedManifest";

describe("reference rebuild clear", () => {
  it("lists only reference collections, never preserved or runtime ones", () => {
    // Runtime collections are already dropped by the teardown sweep, and a
    // preserved collection (accounts, archives, audit trails) must survive.
    for (const { name } of REFERENCE_REBUILD_CLEARED_COLLECTIONS) {
      expect([name, getCollectionCategory(name)]).toEqual([name, "reference"]);
    }
  });

  it("never clears gameConfig, which carries ops state no seeder restores", () => {
    const names = REFERENCE_REBUILD_CLEARED_COLLECTIONS.map(({ name }) => name);
    for (const kept of ["gameConfig", "achievements", "users", "states", "politicalParties"]) {
      expect(names).not.toContain(kept);
    }
  });

  it("removes old-world rows the new roster does not write", async () => {
    const mem = createInMemoryDb();
    mem.seed("stateBaselines", [{ _id: "UKR_KYI" }, { _id: "CA" }]);
    mem.seed("stateRegistrationPool", [{ _id: "DD_BE", countryId: "DD", stateId: "BE" }]);
    mem.seed("demographicCategories", [{ _id: "ua_voterGroups" }]);
    mem.seed("gameConfig", [{ _id: "default", sandboxTesterAccessEnabled: true }]);
    const deleted = await clearReferenceForRebuild(mem as unknown as Db);
    expect(deleted).toMatchObject({
      stateBaselines: 2,
      stateRegistrationPool: 1,
      demographicCategories: 1,
    });
    expect(await mem.collection("stateBaselines").countDocuments()).toBe(0);
    expect(await mem.collection("gameConfig").countDocuments()).toBe(1);
  });
});
