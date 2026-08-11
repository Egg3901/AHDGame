import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  syncPartyChairHeadOfState,
  syncAllPartyChairHeadsOfState,
  partyChairSyncCountries,
} from "./partyChairHeadOfState";

const CN = "CN";
const PRESIDENT = "president";

function makeRulingParty(opts: { chairId?: ObjectId | null; sequentialId?: number } = {}) {
  return {
    _id: new ObjectId(),
    countryId: CN,
    sequentialId: opts.sequentialId ?? 1,
    name: "Chinese Communist Party",
    chairId: opts.chairId === undefined ? new ObjectId() : opts.chairId,
    regimeStatus: "ruling" as const,
  };
}

function makePresidentRow(chairId: ObjectId | null) {
  return {
    _id: new ObjectId(),
    countryId: CN,
    officeType: PRESIDENT,
    characterId: chairId,
    party: "1",
  };
}

describe("syncPartyChairHeadOfState (CN)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("skips when no CN ruling party exists (degenerate state)", async () => {
    // Default MockDb returns null for findOne — both lookups miss.
    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("skipped_no_ruling_party");
    // electedOfficials collection should never be queried in this branch.
    expect(db.collectionMocks.electedOfficials).toBeUndefined();
  });

  it("noops when chairId is null and no President is seated", async () => {
    const ruling = makeRulingParty({ chairId: null });
    db.collection("politicalParties").findOne = (() => Promise.resolve(ruling)) as never;
    db.collection("electedOfficials").findOne = (() => Promise.resolve(null)) as never;

    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("noop");
    expect(db.collectionMocks.electedOfficials!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.deleteOne).not.toHaveBeenCalled();
  });

  it("vacates President when chair becomes null", async () => {
    const oldChair = new ObjectId();
    const ruling = makeRulingParty({ chairId: null });
    const seatedRow = makePresidentRow(oldChair);

    db.collection("politicalParties").findOne = (() => Promise.resolve(ruling)) as never;
    db.collection("electedOfficials").findOne = (() => Promise.resolve(seatedRow)) as never;

    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("vacated");
    expect(result.vacatedCharacterId).toEqual(oldChair);
    expect(db.collectionMocks.electedOfficials!.deleteOne).toHaveBeenCalledWith({
      _id: seatedRow._id,
    });
    expect(db.collectionMocks.electedOfficials!.insertOne).not.toHaveBeenCalled();
  });

  it("seats a new President when CCP has a chair and no current row exists", async () => {
    const chair = new ObjectId();
    const ruling = makeRulingParty({ chairId: chair });

    db.collection("politicalParties").findOne = (() => Promise.resolve(ruling)) as never;
    db.collection("electedOfficials").findOne = (() => Promise.resolve(null)) as never;

    const now = new Date("2026-05-28T00:00:00Z");
    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN", now);
    expect(result.action).toBe("seated");
    expect(result.seatedCharacterId).toEqual(chair);
    expect(db.collectionMocks.electedOfficials!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.insertOne).toHaveBeenCalledTimes(1);

    const inserted = db.collectionMocks.electedOfficials!.insertOne.mock.calls[0]![0] as {
      countryId: string;
      officeType: string;
      characterId: ObjectId;
      party: string;
      seatsHeld: number;
      electedAt: Date;
    };
    expect(inserted.countryId).toBe(CN);
    expect(inserted.officeType).toBe(PRESIDENT);
    expect(inserted.characterId).toEqual(chair);
    expect(inserted.party).toBe("1");
    expect(inserted.seatsHeld).toBe(1);
    expect(inserted.electedAt).toEqual(now);
  });

  it("replaces the President when CCP chair changes", async () => {
    const oldChair = new ObjectId();
    const newChair = new ObjectId();
    const ruling = makeRulingParty({ chairId: newChair });
    const seatedRow = makePresidentRow(oldChair);

    db.collection("politicalParties").findOne = (() => Promise.resolve(ruling)) as never;
    db.collection("electedOfficials").findOne = (() => Promise.resolve(seatedRow)) as never;

    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("replaced");
    expect(result.seatedCharacterId).toEqual(newChair);
    expect(result.vacatedCharacterId).toEqual(oldChair);

    expect(db.collectionMocks.electedOfficials!.deleteOne).toHaveBeenCalledWith({
      _id: seatedRow._id,
    });
    expect(db.collectionMocks.electedOfficials!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("noop when CCP chair matches the seated President (idempotent)", async () => {
    const chair = new ObjectId();
    const ruling = makeRulingParty({ chairId: chair });
    const seatedRow = makePresidentRow(chair);

    db.collection("politicalParties").findOne = (() => Promise.resolve(ruling)) as never;
    db.collection("electedOfficials").findOne = (() => Promise.resolve(seatedRow)) as never;

    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("noop");
    expect(db.collectionMocks.electedOfficials!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.insertOne).not.toHaveBeenCalled();
  });

  it("falls back to sequentialId=1 when no party carries regimeStatus", async () => {
    const chair = new ObjectId();
    const fallback = makeRulingParty({ chairId: chair, sequentialId: 1 });
    // Imitate the two-step lookup: first findOne (regimeStatus filter) returns null,
    // second findOne (sequentialId filter) returns the CCP doc.
    let call = 0;
    db.collection("politicalParties").findOne = (() => {
      return ((_filter: unknown) => {
        call++;
        return Promise.resolve(call === 1 ? null : fallback);
      }) as never;
    })();
    db.collection("electedOfficials").findOne = (() => Promise.resolve(null)) as never;

    const result = await syncPartyChairHeadOfState(db as unknown as Db, "CN");
    expect(result.action).toBe("seated");
    expect(result.seatedCharacterId).toEqual(chair);
  });
});

// The sync was hardcoded to CN, so the Warsaw Pact one-party states had no
// head-of-state office at all and rendered a permanent "Head of State: Vacant" —
// a player asked why East Germany's was vacant when the SED plainly had a chair.
describe("partyChairSyncCountries", () => {
  it("covers the Warsaw Pact one-party states alongside China", () => {
    const ids = partyChairSyncCountries();
    for (const id of ["CN", "DD", "PL", "HU", "RO", "BG", "CS", "YU", "BLR", "BAL"]) {
      expect(ids).toContain(id);
    }
  });

  // A country in the roll but with no isHeadOfState office would sync into nothing.
  it("gives every chair-synced country an office to seat them in", async () => {
    const { COUNTRY_CONFIGS, getHeadOfStateOfficeType } = await import("@/lib/constants/countries");
    const missing = partyChairSyncCountries().filter(
      (id) => getHeadOfStateOfficeType(COUNTRY_CONFIGS[id]) === null
    );
    expect(missing).toEqual([]);
  });
});

describe("syncPartyChairHeadOfState (East Germany)", () => {
  it("seats the ruling party's chair as Chairman of the Council of State", async () => {
    const ddDb = createMockDb();
    const chair = new ObjectId();
    ddDb.collection("politicalParties").findOne = (() =>
      Promise.resolve({
        _id: new ObjectId(),
        countryId: "DD",
        sequentialId: 1,
        name: "Sozialistische Einheitspartei Deutschlands",
        chairId: chair,
        regimeStatus: "ruling",
      })) as never;
    ddDb.collection("electedOfficials").findOne = (() => Promise.resolve(null)) as never;

    const result = await syncPartyChairHeadOfState(ddDb as unknown as Db, "DD");
    expect(result).toMatchObject({ countryId: "DD", action: "seated", seatedCharacterId: chair });
    const inserted = ddDb.collectionMocks.electedOfficials.insertOne.mock.calls[0][0];
    expect(inserted.officeType).toBe("chairmanOfStateCouncil");
    expect(inserted.countryId).toBe("DD");
  });
});

describe("syncAllPartyChairHeadsOfState", () => {
  it("reconciles every chair-synced country in one pass", async () => {
    const allDb = createMockDb();
    allDb.collection("politicalParties").findOne = (() => Promise.resolve(null)) as never;
    const results = await syncAllPartyChairHeadsOfState(allDb as unknown as Db);
    expect(results).toHaveLength(partyChairSyncCountries().length);
    expect(results.every((r) => r.action === "skipped_no_ruling_party")).toBe(true);
  });
});
