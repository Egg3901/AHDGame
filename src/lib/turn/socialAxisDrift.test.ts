import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { clearCountryStateCacheForDb } from "@/lib/countryState/cache";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processSocialAxisDrift } from "./socialAxisDrift";
import type { CountryState } from "@/lib/db/types/countryState";

/**
 * P6b — country social-axis drift. MockDb does NOT apply query filters, so
 * statePolicies rows are returned per `stateId` via a filter-aware `find`
 * stub, and the watermark window is asserted on the `find` filter argument
 * (the only place the watermark is observable through a mock).
 */

function cursorOf(rows: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

type PolicyRow = { legislationTypeId: string; social?: number };
type TypeRow = { _id: string; policyOptions?: Array<{ social?: number }> };

/** A socially differentiated legislation type (options span the social axis). */
const SOCIAL_TYPE: TypeRow = {
  _id: "social_law",
  policyOptions: [{ social: -5 }, { social: 0 }, { social: 5 }],
};
/** An economic-only legislation type (every option social = 0). */
const ECON_TYPE: TypeRow = {
  _id: "econ_law",
  policyOptions: [{ social: 0 }, { social: 0 }, { social: 0 }],
};

interface Harness {
  db: MockDb;
  patchFor: (countryId: string) => Partial<CountryState> | undefined;
  findFilterFor: (stateId: string) => Record<string, unknown> | undefined;
}

/**
 * Wire a MockDb where:
 *  - countryState.findOne returns `stateDoc` for `targetId` (else null → self-heal),
 *  - statePolicies.find returns `rows` for the target's national stateId (else []),
 *  - legislationTypes.find returns `types`,
 *  - findOneAndUpdate echoes the $set so the patch is inspectable.
 */
function harness(opts: {
  targetId: string;
  targetNationalStateId: string;
  stateDoc?: CountryState | null;
  rows?: PolicyRow[];
  types?: TypeRow[];
}): Harness {
  const db = createMockDb();
  db.collection("countryState");
  db.collection("statePolicies");
  db.collection("legislationTypes");
  clearCountryStateCacheForDb(db as unknown as Db);

  db.collectionMocks.countryState.findOne = vi
    .fn()
    .mockImplementation((filter: { _id: string }) => {
      if (opts.stateDoc !== undefined && filter._id === opts.targetId) {
        return Promise.resolve(opts.stateDoc);
      }
      return Promise.resolve(null);
    });

  const findFilters: Record<string, Record<string, unknown>> = {};
  db.collectionMocks.statePolicies.find = vi
    .fn()
    .mockImplementation((filter: { stateId: string }) => {
      findFilters[filter.stateId] = filter;
      if (filter.stateId === opts.targetNationalStateId) return cursorOf(opts.rows ?? []);
      return cursorOf([]);
    });

  db.collectionMocks.legislationTypes.find = vi.fn().mockReturnValue(cursorOf(opts.types ?? []));

  const patches: Record<string, Partial<CountryState>> = {};
  db.collectionMocks.countryState.findOneAndUpdate = vi
    .fn()
    .mockImplementation((filter: { _id: string }, update: { $set: Partial<CountryState> }) => {
      patches[filter._id] = update.$set;
      return Promise.resolve({ _id: filter._id, ...update.$set } as CountryState);
    });

  return {
    db,
    patchFor: (countryId) => patches[countryId],
    findFilterFor: (stateId) => findFilters[stateId],
  };
}

describe("processSocialAxisDrift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an authoritarian law (social +5) drifts the position up toward it", async () => {
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows: [{ legislationTypeId: "social_law", social: 5 }],
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // CN baseline 3.5; delta = 0.05 * (5 - 3.5) = 0.075 → 3.575 → 3.58 (2dp)
    expect(h.patchFor("CN")?.socialAxisPosition).toBeCloseTo(3.58, 2);
  });

  it("a libertarian law (social −4) drifts the position down", async () => {
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows: [{ legislationTypeId: "social_law", social: -4 }],
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // delta = 0.05 * (-4 - 3.5) = -0.375 → 3.125 → 3.13
    expect(h.patchFor("CN")?.socialAxisPosition).toBeCloseTo(3.13, 2);
  });

  it("an economic-only law does NOT drift the social axis", async () => {
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows: [{ legislationTypeId: "econ_law", social: 0 }],
      types: [ECON_TYPE],
    });
    const result = await processSocialAxisDrift(h.db as unknown as Db, 200);
    expect(h.patchFor("CN")?.socialAxisPosition).toBe(3.5); // unchanged baseline
    expect(result.lawsCounted).toBe(0);
  });

  it("a centrist option (social 0) of a SOCIAL law moderates toward 0", async () => {
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows: [{ legislationTypeId: "social_law", social: 0 }],
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // delta = 0.05 * (0 - 3.5) = -0.175 → 3.325 → 3.33
    expect(h.patchFor("CN")?.socialAxisPosition).toBeCloseTo(3.33, 2);
  });

  it("caps net per-turn drift at ±0.5 under a bill barrage", async () => {
    const rows: PolicyRow[] = Array.from({ length: 20 }, () => ({
      legislationTypeId: "social_law",
      social: 5,
    }));
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows,
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // raw 20 * 0.075 = 1.5 → capped 0.5 → 3.5 + 0.5 = 4.0
    expect(h.patchFor("CN")?.socialAxisPosition).toBeCloseTo(4.0, 2);
  });

  it("clamps the position at +5", async () => {
    const doc = seedCountryStateFromConfig("CN", new Date());
    doc.socialAxisPosition = 4.9;
    const rows: PolicyRow[] = Array.from({ length: 20 }, () => ({
      legislationTypeId: "social_law",
      social: 5,
    }));
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      stateDoc: doc,
      rows,
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // 4.9 + 0.5 cap = 5.4 → clamp 5.0
    expect(h.patchFor("CN")?.socialAxisPosition).toBe(5);
  });

  it("uses the stored watermark as the lower query bound", async () => {
    const doc = seedCountryStateFromConfig("CN", new Date());
    doc.socialAxisDriftTurn = 100;
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      stateDoc: doc,
      rows: [],
      types: [],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 105);
    expect(h.findFilterFor("cn_national")?.enactedTurn).toEqual({ $gt: 100, $lte: 105 });
    expect(h.patchFor("CN")?.socialAxisDriftTurn).toBe(105);
  });

  it("first run (no watermark) starts the window at currentTurn − 1", async () => {
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      rows: [],
      types: [],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 105);
    expect(h.findFilterFor("cn_national")?.enactedTurn).toEqual({ $gt: 104, $lte: 105 });
  });

  it("falls back to the config baseline when the live doc lacks the field", async () => {
    // A pre-P6b live doc: present but without socialAxisPosition.
    const doc = seedCountryStateFromConfig("CN", new Date());
    delete doc.socialAxisPosition;
    const h = harness({
      targetId: "CN",
      targetNationalStateId: "cn_national",
      stateDoc: doc,
      rows: [{ legislationTypeId: "social_law", social: 5 }],
      types: [SOCIAL_TYPE],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // baseline 3.5 used → 3.58
    expect(h.patchFor("CN")?.socialAxisPosition).toBeCloseTo(3.58, 2);
  });

  it("writes the field + watermark even for a country with zero enacted laws", async () => {
    const h = harness({
      targetId: "BR",
      targetNationalStateId: "br_national",
      rows: [],
      types: [],
    });
    await processSocialAxisDrift(h.db as unknown as Db, 200);
    // BR baseline 0, no laws → position stays 0, watermark advances (self-heal write)
    expect(h.patchFor("BR")?.socialAxisPosition).toBe(0);
    expect(h.patchFor("BR")?.socialAxisDriftTurn).toBe(200);
  });
});
