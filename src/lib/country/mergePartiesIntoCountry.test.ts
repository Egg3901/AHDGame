import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { reserveSequentialIds, realignPartyCountersToExisting } = vi.hoisted(() => ({
  reserveSequentialIds: vi.fn(async () => [7, 8]),
  realignPartyCountersToExisting: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/sequentialId", () => ({
  reserveSequentialIds,
  realignPartyCountersToExisting,
}));
const { resolveMergeFxScale } = vi.hoisted(() => ({
  resolveMergeFxScale: vi.fn(async () => 2),
}));
vi.mock("./mergeFxScale", () => ({ resolveMergeFxScale }));

import { mergePartiesIntoCountry } from "./mergePartiesIntoCountry";

const SED = new ObjectId();
const CDU = new ObjectId();

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

describe("mergePartiesIntoCountry", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    reserveSequentialIds.mockResolvedValue([7, 8]);
    db = createMockDb();
    db.collection("politicalParties").find.mockReturnValue(
      cursorOf([
        { _id: SED, countryId: "DD", sequentialId: 1, abbreviation: "SED" },
        { _id: CDU, countryId: "DD", sequentialId: 2, abbreviation: "CDU" },
      ])
    );
    db.collection("politicalParties").updateOne.mockResolvedValue({ modifiedCount: 1 });
    for (const c of ["characters", "electedOfficials", "orgRegLedger", "npps"]) {
      db.collection(c).updateMany.mockResolvedValue({ modifiedCount: 3 });
    }
  });

  const run = () =>
    mergePartiesIntoCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 470,
    });

  it("renumbers the moved parties onto the target country's counter", async () => {
    const res = await run();
    expect(reserveSequentialIds).toHaveBeenCalledWith(db, "party", 2, "DE");
    expect(res.partyIdMap).toEqual({ "1": "7", "2": "8" });
    expect(res.partiesMoved).toBe(2);
    expect(res.ok).toBe(true);
  });

  it("RE-KEYS statePartyOrg, whose _id embeds the sequentialId", async () => {
    // Ticket #1256. The field remap above renumbers `partyId`, but `_id` is
    // `${stateId}_${partyId}` and a Mongo `_id` cannot be updated -- so without
    // this the row disagrees with its own key. The state-party page reads by
    // `_id` and would render another party's organisation.
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        { _id: "SN_1", stateId: "SN", partyId: "7", countryId: "DE", organization: 62.9 },
        { _id: "SN_2", stateId: "SN", partyId: "8", countryId: "DE", organization: 6.1 },
      ])
    );

    await run();

    const inserts = db.collectionMocks["statePartyOrg"].insertOne.mock.calls.map((c) => c[0]);
    // Parked under a temporary id first: SN_1 must become SN_7 while SN_2
    // becomes SN_8, and a direct pass would collide on a key still occupied.
    expect(inserts.filter((d) => String(d._id).startsWith("__rekey__"))).toHaveLength(2);
    const landed = inserts.filter((d) => !String(d._id).startsWith("__rekey__"));
    expect(landed.map((d) => d._id).sort()).toEqual(["SN_7", "SN_8"]);
    expect(landed.find((d) => d._id === "SN_7")).toMatchObject({
      stateId: "SN",
      partyId: "7",
      organization: 62.9,
    });
  });

  it("leaves a statePartyOrg row whose key already agrees", async () => {
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([{ _id: "SN_7", stateId: "SN", partyId: "7", countryId: "DE", organization: 62.9 }])
    );

    await run();

    expect(db.collectionMocks["statePartyOrg"].insertOne).not.toHaveBeenCalled();
  });

  it("does NOT overwrite a key held by a row that is staying put", async () => {
    // Losing one party's organisation silently is worse than a key that still
    // disagrees, which the seed verifier can report later.
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        { _id: "SN_1", stateId: "SN", partyId: "7", countryId: "DE", organization: 62.9 },
        { _id: "SN_7", stateId: "SN", partyId: "7", countryId: "DE", organization: 11.1 },
      ])
    );

    await run();

    expect(db.collectionMocks["statePartyOrg"].deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["statePartyOrg"].insertOne).not.toHaveBeenCalled();
  });

  it("stamps mergedFrom so a re-run is idempotent", async () => {
    await run();
    const call = db.collectionMocks["politicalParties"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(SED)
    );
    expect(call?.[1].$set.countryId).toBe("DE");
    expect(call?.[1].$set.sequentialId).toBe(7);
    expect(call?.[1].$set.mergedFrom).toEqual({ countryId: "DD", sequentialId: 1, turn: 470 });
  });

  it("rebuilds the map from the stamp when the parties have already moved", async () => {
    // A re-run after a partial failure: nothing left in the source, but the
    // caller still needs the map to translate the absorbed ruling party.
    db.collection("politicalParties").find.mockImplementation((filter: Record<string, unknown>) =>
      filter.countryId === "DD"
        ? cursorOf([])
        : cursorOf([
            {
              _id: SED,
              countryId: "DE",
              sequentialId: 7,
              mergedFrom: { countryId: "DD", sequentialId: 1 },
            },
            {
              _id: CDU,
              countryId: "DE",
              sequentialId: 8,
              mergedFrom: { countryId: "DD", sequentialId: 2 },
            },
          ])
    );
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.partyIdMap).toEqual({ "1": "7", "2": "8" });
    expect(res.partiesMoved).toBe(0);
    // Critically, it must not reserve a second block of ids.
    expect(reserveSequentialIds).not.toHaveBeenCalled();
  });

  it("converts the moved treasuries once, stamped inside the same update", async () => {
    await run();
    const call = db.collectionMocks["politicalParties"].updateMany.mock.calls.find(
      (c) => c[0]["mergedFrom.countryId"] === "DD"
    );
    expect(call?.[0]).toMatchObject({
      countryId: "DE",
      "mergedFrom.countryId": "DD",
      "mergedFrom.treasuryConverted": { $ne: true },
    });
    expect(call?.[1].$mul).toEqual({ treasury: 2 });
    expect(call?.[1].$set["mergedFrom.treasuryConverted"]).toBe(true);
  });

  it("stamps without multiplying when the two sides share a currency (scale 1)", async () => {
    resolveMergeFxScale.mockResolvedValueOnce(1);
    await run();
    const call = db.collectionMocks["politicalParties"].updateMany.mock.calls.find(
      (c) => c[0]["mergedFrom.countryId"] === "DD"
    );
    expect(call?.[1].$mul).toBeUndefined();
    expect(call?.[1].$set["mergedFrom.treasuryConverted"]).toBe(true);
  });

  it("the already-moved path still converts an unstamped treasury", async () => {
    db.collection("politicalParties").find.mockImplementation((filter: Record<string, unknown>) =>
      filter.countryId === "DD"
        ? cursorOf([])
        : cursorOf([
            {
              _id: SED,
              countryId: "DE",
              sequentialId: 7,
              mergedFrom: { countryId: "DD", sequentialId: 1 },
            },
          ])
    );
    await run();
    const call = db.collectionMocks["politicalParties"].updateMany.mock.calls.find(
      (c) => c[0]["mergedFrom.countryId"] === "DD"
    );
    expect(call?.[1].$mul).toEqual({ treasury: 2 });
  });

  it("remaps a sequentialId reference in the source country only", async () => {
    await run();
    const call = db.collectionMocks["electedOfficials"].updateMany.mock.calls.find(
      (c) => c[0].party === "1"
    );
    expect(call?.[0]).toEqual({ countryId: "DD", party: "1" });
    expect(call?.[1].$set.party).toBe("7");
  });

  it("never remaps the orgRegLedger pool sentinel", async () => {
    await run();
    const calls = db.collectionMocks["orgRegLedger"].updateMany.mock.calls;
    expect(calls.every((c) => c[0].partyId !== "__pool__")).toBe(true);
  });

  it("realigns the target counter once every party has moved", async () => {
    await run();
    expect(realignPartyCountersToExisting).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the source has no parties", async () => {
    db.collection("politicalParties").find.mockReturnValue(cursorOf([]));
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.partiesMoved).toBe(0);
    expect(reserveSequentialIds).not.toHaveBeenCalled();
  });

  it("refuses to merge a country's parties into itself", async () => {
    const res = await mergePartiesIntoCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DD",
      currentTurn: 470,
    });
    expect(res.ok).toBe(false);
    expect(reserveSequentialIds).not.toHaveBeenCalled();
  });

  it("scopes a one-doc-per-country collection by its own id", () => {
    // `governmentFormations` carries no `countryId`, so filtering it on one
    // matches nothing and reports no error -- which is how its `governingPartyId`
    // survived a renumber still naming the pre-merge party.
    return (async () => {
      db.collection("governmentFormations").updateMany.mockResolvedValue({ modifiedCount: 1 });
      db.collection("governmentFormations").find.mockReturnValue(cursorOf([]));
      await mergePartiesIntoCountry(db as unknown as Db, {
        fromCountryId: "DD",
        toCountryId: "DE",
        currentTurn: 470,
      });
      const call = db.collectionMocks["governmentFormations"].updateMany.mock.calls.find(
        (c) => c[0]?.governingPartyId !== undefined
      );
      expect(call?.[0]._id).toBe("DD");
      expect(call?.[0].countryId).toBeUndefined();
    })();
  });

  it("rewrites the KEYS of a party-keyed map", async () => {
    // `$set` on a path rewrites a value and cannot rename a key, so this map has
    // to be read, rebuilt and written whole. Its keys are the party ids.
    db.collection("governmentFormations").find.mockReturnValue(
      cursorOf([{ _id: "DD", seatsByParty: { "1": 95, "2": 24 } }])
    );
    db.collection("governmentFormations").updateOne.mockResolvedValue({ modifiedCount: 1 });

    await mergePartiesIntoCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 470,
    });

    const call = db.collectionMocks["governmentFormations"].updateOne.mock.calls.find(
      (c) => c[1]?.$set?.seatsByParty !== undefined
    );
    // 1 -> 7 and 2 -> 8, the ids reserved for the moved parties.
    expect(call?.[1].$set.seatsByParty).toEqual({ "7": 95, "8": 24 });
  });

  it("SUMS seats when two old keys land on one new one", async () => {
    // Not hypothetical in a merge that dedupes: whichever party wins the key
    // would otherwise silently take the other's benches with it.
    reserveSequentialIds.mockResolvedValue([7, 7]);
    db.collection("governmentFormations").find.mockReturnValue(
      cursorOf([{ _id: "DD", seatsByParty: { "1": 95, "2": 24 } }])
    );
    db.collection("governmentFormations").updateOne.mockResolvedValue({ modifiedCount: 1 });

    await mergePartiesIntoCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 470,
    });

    const call = db.collectionMocks["governmentFormations"].updateOne.mock.calls.find(
      (c) => c[1]?.$set?.seatsByParty !== undefined
    );
    expect(call?.[1].$set.seatsByParty).toEqual({ "7": 119 });
  });

  it("leaves a map alone when no key moves", async () => {
    db.collection("governmentFormations").find.mockReturnValue(
      cursorOf([{ _id: "DD", seatsByParty: { "94": 3 } }])
    );
    db.collection("governmentFormations").updateOne.mockResolvedValue({ modifiedCount: 1 });

    await mergePartiesIntoCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 470,
    });

    const call = db.collectionMocks["governmentFormations"].updateOne.mock.calls.find(
      (c) => c[1]?.$set?.seatsByParty !== undefined
    );
    expect(call).toBeUndefined();
  });
});
