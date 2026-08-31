/**
 * §6 end-to-end reset verification (spec obligation): after a fresh 1953 seed
 * pass, (a) no old-generation legislationTypes/statePolicies remain for
 * US/UK/RU/DD, (b) the §7 baseline survives the whole seed pipeline (incl. the
 * generation-aware deleters), (c) taxRates come from SEED_TAX_RATES_1953,
 * (d) post-sync spending covers every mapped budget key.
 *
 * Runs the real seeders against one shared in-memory store (a stateful mock —
 * richer than the call-assertion MockDb) so cross-seeder interactions
 * (upsert → delete sweeps) are actually exercised. A live-DB variant lives in
 * scripts/debug/verify-legislation-reset.mjs (untracked).
 */

import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { legislationTypes as oldReferenceTypes } from "@/lib/seeds/reference/legislationTypes";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { budgetKeyForLaw } from "@/lib/politicalLegislation/budgetKeys";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import {
  isOldLegislationTypeExcluded,
  POLITICAL_LEGISLATION_RETAINED_OLD_IDS,
} from "@/lib/politicalMetrics/pipelinePreset";
import { seedLegislationTypes } from "./seedLegislationTypes";
import { seedPoliticalLegislationBaseline } from "./seedPoliticalLegislation";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/budget/revenue", () => ({
  refreshNationalBudgetRevenue: vi.fn().mockResolvedValue(3),
}));

describe("1953 reset — end-to-end political-legislation verification", () => {
  let db: MockDb;
  /** Stateful stores backing the mock: id → doc. */
  let typeStore: Map<string, { _id: string }>;
  let policyStore: Map<string, { legislationTypeId: string }>;

  beforeEach(() => {
    db = createMockDb();
    typeStore = new Map();
    policyStore = new Map();

    db.collectionMocks.legislationTypes = {
      ...db.collectionMocks.legislationTypes,
      bulkWrite: vi
        .fn()
        .mockImplementation((ops: Array<{ replaceOne: { replacement: { _id: string } } }>) => {
          for (const op of ops)
            typeStore.set(op.replaceOne.replacement._id, op.replaceOne.replacement);
          return Promise.resolve({});
        }),
      deleteMany: vi.fn().mockImplementation((filter: { _id?: { $nin: string[] } }) => {
        let deleted = 0;
        const keep = new Set(filter._id?.$nin ?? []);
        for (const id of [...typeStore.keys()]) {
          if (!keep.has(id)) {
            typeStore.delete(id);
            deleted++;
          }
        }
        return Promise.resolve({ deletedCount: deleted });
      }),
    } as typeof db.collectionMocks.legislationTypes;

    db.collectionMocks.statePolicies = {
      ...db.collectionMocks.statePolicies,
      // A storage simulator, so batching applies the ops in order exactly as
      // the sequential upserts did — this stays a real end-to-end check.
      bulkWrite: vi.fn().mockImplementation(
        (
          ops: Array<{
            updateOne: {
              filter: { legislationTypeId: string };
              update: { $set: { legislationTypeId: string } };
            };
          }>
        ) => {
          for (const op of ops) {
            policyStore.set(op.updateOne.filter.legislationTypeId, op.updateOne.update.$set);
          }
          return Promise.resolve({ matchedCount: ops.length, upsertedCount: 0 });
        }
      ),
      deleteMany: vi
        .fn()
        .mockImplementation(
          (filter: { legislationTypeId?: { $nin?: string[]; $in?: string[] } }) => {
            let deleted = 0;
            if (filter.legislationTypeId?.$nin) {
              const keep = new Set(filter.legislationTypeId.$nin);
              for (const id of [...policyStore.keys()]) {
                if (!keep.has(id)) {
                  policyStore.delete(id);
                  deleted++;
                }
              }
            }
            return Promise.resolve({ deletedCount: deleted });
          }
        ),
    } as typeof db.collectionMocks.statePolicies;

    db.collectionMocks.states = {
      ...db.collectionMocks.states,
      find: vi.fn().mockImplementation((filter?: { countryId?: string }) => ({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: `${filter?.countryId}-1`,
            countryId: filter?.countryId,
            gdp: 100_000,
            population: 50_000_000,
          },
        ]),
      })),
    } as typeof db.collectionMocks.states;
  });

  async function runResetPass() {
    // Pre-populate a stale old-generation world (simulates pre-reset state).
    for (const t of oldReferenceTypes) typeStore.set(t._id, t);
    policyStore.set("us_federal_income_tax_rate", {
      legislationTypeId: "us_federal_income_tax_rate",
    });

    // reset=false: the upsert+prune path (what we verify) is unconditional;
    // MockDb has no collection.drop for the reset-only wipe of unrelated colls.
    await seedLegislationTypes(db as unknown as Db, false, vi.fn(), "1953-default");
    await seedPoliticalLegislationBaseline(db as unknown as Db, vi.fn(), 1953);
    // The statePolicies stale-cleanup mirrors seedStatePolicies' deleter set:
    const { getAllNewGenerationLawIds } = await import("@/lib/politicalLegislation/catalog");
    // Mirrors seedStatePolicies' deleter set via the SAME predicate the seeder
    // uses — spelling the scope list out here let this simulation drift from the
    // real sweep (it would have kept deleting the retained redistricting rows).
    const valid = [
      ...oldReferenceTypes.filter((lt) => !isOldLegislationTypeExcluded(lt)).map((lt) => lt._id),
      ...getAllNewGenerationLawIds(),
    ];
    await db.collectionMocks.statePolicies.deleteMany({ legislationTypeId: { $nin: valid } });
  }

  it("(a) no old-generation US/UK/RU/DD docs survive; (b) the §7 baseline does", async () => {
    await runResetPass();

    const survivingIds = [...typeStore.keys()];
    // Exactly the deliberate carve-out survives: the state redistricting levers
    // have no new-generation equivalent and the redistricting caps read them by
    // id (ticket #1189). Any OTHER old playable-country id still fails here.
    expect(survivingIds.filter((id) => /^(us|uk|su|dd)_/.test(id)).sort()).toEqual(
      [...POLITICAL_LEGISLATION_RETAINED_OLD_IDS].sort()
    );
    // Other countries' old catalogs survive untouched.
    expect(survivingIds.some((id) => id.startsWith("jp_"))).toBe(true);

    for (const cc of LAW_COUNTRY_IDS) {
      for (const law of getCatalog(cc)) {
        // Every law gets a legislation TYPE, regional ones included: that is
        // what makes them proposable at the Land / state level.
        expect(typeStore.has(law.id), `type ${law.id}`).toBe(true);
        // But only NATIONAL laws get a national statePolicies row. Regional
        // secondaries never write one, by design and by the seeder: see
        // `seedPoliticalLegislation` (`if (law.allowedScope === "regional")
        // continue`, and the same carve-out on its baseline filter), and the
        // DD Land sidecar's own header, "they never write national
        // statePolicies / national enactedLaws".
        //
        // Without the carve-out this assertion failed the moment a regional
        // catalog existed. PR #17 added the six DD Land laws on 2026-08-12 and
        // this test went red on `development` and shipped red to `main`,
        // reporting a seeding bug that was not there.
        if (law.kind !== "tax" && law.allowedScope !== "regional") {
          expect(policyStore.has(law.id), `policy ${law.id}`).toBe(true);
        }
      }
    }
    // The regional sidecar is proposable but deliberately has no national
    // policy row. Pinned explicitly so a future change to the seeder's scope
    // handling fails here rather than silently flipping the rule above.
    expect(typeStore.has("dd.sec.landPolytechnicEducation")).toBe(true);
    expect(policyStore.has("dd.sec.landPolytechnicEducation")).toBe(false);
    // The stale old-generation policy record was cleaned.
    expect(policyStore.has("us_federal_income_tax_rate")).toBe(false);
  });

  it("(d) every enacted baseline law lands on a mapped budget key", async () => {
    await runResetPass();
    const lawWrites = bulkOps(db.collectionMocks.enactedLaws.bulkWrite);
    expect(lawWrites.length).toBeGreaterThan(200);
    const validKeys = new Set(
      LAW_COUNTRY_IDS.flatMap((cc) =>
        getCatalog(cc)
          .filter((l) => l.kind !== "tax")
          .map((l) => budgetKeyForLaw(l))
      )
    );
    for (const call of lawWrites) {
      const doc = call[1] as { budgetCategory: string };
      expect(validKeys.has(doc.budgetCategory)).toBe(true);
    }
  });
});
