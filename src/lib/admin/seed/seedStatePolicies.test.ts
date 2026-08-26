/**
 * Ticket #1189 — the generation-aware stale sweep deletes any statePolicies row
 * whose legislationTypeId is no longer in the seed set. The three state
 * redistricting levers are retained from the old US catalog (they have no
 * new-generation equivalent and src/lib/redistricting/caps.ts reads them by id),
 * so a state's enacted redistricting authority must survive the sweep.
 */
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedStatePolicies } from "./seedStatePolicies";

const REDISTRICT_IDS = [
  "us_state_redistricting_authority",
  "us_state_compactness",
  "us_state_fairness",
];

describe("seedStatePolicies — stale sweep", () => {
  it("keeps enacted redistricting-lever rows on the political-legislation preset", async () => {
    const db = createMockDb() as unknown as MockDb;

    await seedStatePolicies(db as never, false, vi.fn(), "1953-default");

    const staleSweep = db.collectionMocks.statePolicies.deleteMany.mock.calls
      .map((call) => call[0] as { legislationTypeId?: { $nin?: string[] } })
      .find((filter) => Array.isArray(filter.legislationTypeId?.$nin));
    expect(staleSweep).toBeDefined();
    for (const id of REDISTRICT_IDS) {
      expect(staleSweep!.legislationTypeId!.$nin, id).toContain(id);
    }
  });

  it("still sweeps the rest of the old US catalog", async () => {
    const db = createMockDb() as unknown as MockDb;

    await seedStatePolicies(db as never, false, vi.fn(), "1953-default");

    const staleSweep = db.collectionMocks.statePolicies.deleteMany.mock.calls
      .map((call) => call[0] as { legislationTypeId?: { $nin?: string[] } })
      .find((filter) => Array.isArray(filter.legislationTypeId?.$nin))!;
    const keptOldUs = staleSweep
      .legislationTypeId!.$nin!.filter((id) => id.startsWith("us_"))
      .sort();
    expect(keptOldUs).toEqual([...REDISTRICT_IDS].sort());
  });
});
