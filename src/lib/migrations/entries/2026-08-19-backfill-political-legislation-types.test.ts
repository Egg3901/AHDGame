import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-19-backfill-political-legislation-types";
import { getProjectedPoliticalLegislationTypes } from "@/lib/admin/seed/seedPoliticalLegislation";
import { BILL_CATEGORIES, CATEGORY_TO_POLICY_DOMAINS } from "@shared/constants/legislation";

const WORLD_YEAR = 1956;

/** The state-scope predicate GET /api/game/legislation-types applies for scope=state. */
function matchesStateScope(doc: { allowedScope?: string; nationalOnly?: boolean }): boolean {
  if (doc.allowedScope === "state" || doc.allowedScope === "both") return true;
  return doc.allowedScope === undefined && doc.nationalOnly !== true;
}

let db: MockDb;

function wire(existingIds: string[]) {
  db = createMockDb();
  db.collection("gameState");
  db.collection("legislationTypes");
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    preset: "1953",
    currentYear: WORLD_YEAR,
    currentTurn: 237,
    startingYear: 1953,
    eraSystemEnabled: true,
  });
  db.collectionMocks.legislationTypes.find.mockReturnValue({
    toArray: async () => existingIds.map((id) => ({ _id: id })),
  });
  db.collectionMocks.legislationTypes.bulkWrite.mockResolvedValue({ upsertedCount: 0 });
}

describe("migration: backfill-political-legislation-types", () => {
  beforeEach(() => wire([]));

  it("gives an NPP-held US governorship selectable state tax types (ticket #1106)", async () => {
    // The governor office QueueBillModal and the state legislature
    // ProposeStateBillModal both call
    // /api/game/legislation-types?category=tax&scope=state&country=us, which
    // reads Mongo. Before this migration a live world only held the six
    // federal `allowedScope: "national"` tax laws, so the Tax category
    // rendered with no selectable legislation type.
    await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as {
      updateOne: { filter: { _id: string }; update: { $setOnInsert: Record<string, unknown> } };
    }[];
    const inserted = ops.map((o) => o.updateOne.update.$setOnInsert) as {
      _id: string;
      countryScope?: string;
      policyDomain?: string;
      allowedScope?: string;
      nationalOnly?: boolean;
    }[];

    const taxDomains = CATEGORY_TO_POLICY_DOMAINS.tax!;
    const stateTax = inserted.filter(
      (d) =>
        d.countryScope === "us" &&
        taxDomains.includes(d.policyDomain!) &&
        matchesStateScope(d) &&
        // us.tax.stateIncomeTax and friends: the sidecar the picker needs.
        d._id.startsWith("us.tax.state")
    );

    expect(stateTax.length).toBeGreaterThan(0);
    expect(stateTax.map((d) => d._id)).toContain("us.tax.stateIncomeTax");
  });

  it("keeps 'tax' a proposable category for the US state picker", () => {
    // Guards the category itself, not just the docs: BILL_CATEGORIES must still
    // carry "tax" and it must map to the policyDomain the projection writes.
    expect(BILL_CATEGORIES).toContain("tax");
    const projected = getProjectedPoliticalLegislationTypes(WORLD_YEAR);
    const usStateTax = projected.filter(
      (t) =>
        t.countryScope === "us" &&
        CATEGORY_TO_POLICY_DOMAINS.tax!.includes(t.policyDomain) &&
        matchesStateScope(t)
    );
    expect(usStateTax.length).toBeGreaterThan(0);
    // Each carries the slider the propose path prices `proposedRate` against.
    for (const t of usStateTax) {
      expect(t.taxSlider).toBeDefined();
    }
  });

  it("never overwrites an existing doc: inserts use $setOnInsert only", async () => {
    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as unknown[];
    expect(JSON.stringify(ops)).not.toContain('"$set"');
  });

  it("is a no-op when every projected type already exists", async () => {
    wire(getProjectedPoliticalLegislationTypes(WORLD_YEAR).map((t) => String(t._id)));
    const res = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(res.documentsInserted).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const res = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(res.notes?.join(" ")).toContain("Dry run");
  });
});
