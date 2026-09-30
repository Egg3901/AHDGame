import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { reconcileBundestagHolderOffices } from "./bundestagHolderOffices";

describe("Bundestag direct and list holder offices", () => {
  it("combines mandates, seats list-only winners, clears former holders and preserves executives", async () => {
    const memory = createInMemoryDb(),
      db = memory as unknown as Db;
    const direct = new ObjectId(),
      list = new ObjectId(),
      departed = new ObjectId(),
      executive = new ObjectId();
    await db.collection("characters").insertMany([
      {
        _id: direct,
        countryId: "DE",
        currentOffice: { type: "bundestag", state: "BW", seatsHeld: 28 },
      },
      { _id: list, countryId: "DE", currentOffice: { type: "landtag", state: "BW", seatsHeld: 5 } },
      {
        _id: departed,
        countryId: "DE",
        currentOffice: { type: "bundestag", state: "BW", seatsHeld: 12 },
      },
      { _id: executive, countryId: "DE", currentOffice: { type: "chancellor", state: "BY" } },
    ]);
    await db.collection("electedOfficials").insertMany([
      { countryId: "DE", officeType: "bundestag", state: "BW", characterId: direct, seatsHeld: 28 },
      {
        countryId: "DE",
        officeType: "bundestag",
        state: "BW",
        characterId: direct,
        seatsHeld: 413,
        seatSource: "list",
      },
      {
        countryId: "DE",
        officeType: "bundestag",
        state: "BW",
        characterId: list,
        seatsHeld: 30,
        seatSource: "list",
      },
      {
        countryId: "DE",
        officeType: "landtag",
        state: "BW",
        characterId: list,
        seatsHeld: 5,
        party: "1",
      },
      {
        countryId: "DE",
        officeType: "bundestag",
        state: "BY",
        characterId: executive,
        seatsHeld: 40,
      },
      { countryId: "DE", officeType: "chancellor", characterId: executive },
    ]);
    const now = new Date("1993-01-01Z");
    await reconcileBundestagHolderOffices(db, now);
    const office = async (_id: ObjectId) =>
      (await db.collection("characters").findOne({ _id }))?.currentOffice;
    expect(await office(direct)).toEqual({ type: "bundestag", state: "BW", seatsHeld: 441 });
    expect(await office(list)).toEqual({ type: "bundestag", state: "BW", seatsHeld: 30 });
    expect(await office(departed)).toBeNull();
    expect(await office(executive)).toEqual({ type: "chancellor", state: "BY" });
    const old = await db.collection("electedOfficials").findOne({ officeType: "landtag" });
    expect(old?.characterId).toBeNull();
    expect(old?.seatsHeld).toBeUndefined();
    expect(
      (await db.collection("electedOfficials").findOne({ officeType: "chancellor" }))?.characterId
    ).toEqual(executive);
    const before = await db.collection("characters").find({}).toArray();
    await reconcileBundestagHolderOffices(db, now);
    expect(await db.collection("characters").find({}).toArray()).toEqual(before);
  });

  it("keeps a shared NPP representative's office in its existing Land", async () => {
    const memory = createInMemoryDb(),
      db = memory as unknown as Db,
      nppId = new ObjectId();
    await db.collection("npps").insertOne({
      _id: nppId,
      countryId: "DE",
      currentOffice: { type: "bundestag", state: "BY", seatsHeld: 3 },
    });
    await db.collection("electedOfficials").insertMany([
      { countryId: "DE", officeType: "bundestag", state: "BW", nppId, seatsHeld: 20 },
      { countryId: "DE", officeType: "bundestag", state: "BY", nppId, seatsHeld: 3 },
      { countryId: "DE", officeType: "bundestag", state: "BY", nppId, seatsHeld: 7 },
    ]);
    await reconcileBundestagHolderOffices(db, new Date("1993-01-01Z"));
    expect((await db.collection("npps").findOne({ _id: nppId }))?.currentOffice).toEqual({
      type: "bundestag",
      state: "BY",
      seatsHeld: 10,
    });
  });
});
