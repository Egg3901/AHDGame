import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { findCompetingSupplierInterest } from "./defenceMinisterInterests";

const MINISTER_USER = new ObjectId();
const MINISTER_CHAR = new ObjectId();
const TERMINATED_CORP = new ObjectId();

function stubDb(opts: {
  corporations: Record<string, unknown>[];
  defenceSectorCorpIds?: ObjectId[];
}): Db {
  return {
    collection: (name: string) => {
      if (name === "corporations") {
        return {
          find: () => ({
            project: () => ({ toArray: async () => opts.corporations }),
          }),
        };
      }
      return {
        find: () => ({
          project: () => ({
            toArray: async () =>
              (opts.defenceSectorCorpIds ?? []).map((corporationId) => ({
                _id: new ObjectId(),
                corporationId,
              })),
          }),
        }),
      };
    },
  } as unknown as Db;
}

const owned = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  name: "Todoroki Arms",
  countryId: "US",
  userId: MINISTER_USER,
  totalShares: 1_000,
  shareholders: [],
  ...over,
});

describe("findCompetingSupplierInterest", () => {
  it("finds a defence firm the minister owns outright", async () => {
    const corp = owned();
    const found = await findCompetingSupplierInterest(
      stubDb({ corporations: [corp], defenceSectorCorpIds: [corp._id] }),
      {
        countryId: "US",
        ministerUserId: MINISTER_USER,
        ministerCharacterId: MINISTER_CHAR,
        excludeCorporationId: TERMINATED_CORP,
      }
    );
    expect(found).toMatchObject({ name: "Todoroki Arms", basis: "owner" });
  });

  // A stake in a bakery is not a conflict on a submarine order. Only a company that could
  // actually pick up the work counts.
  it("ignores a company the minister owns that builds no defence materiel", async () => {
    const corp = owned({ name: "Todoroki Bakeries" });
    const found = await findCompetingSupplierInterest(
      stubDb({ corporations: [corp], defenceSectorCorpIds: [] }),
      {
        countryId: "US",
        ministerUserId: MINISTER_USER,
        ministerCharacterId: MINISTER_CHAR,
        excludeCorporationId: TERMINATED_CORP,
      }
    );
    expect(found).toBeNull();
  });

  it("ignores a holding below the materiality line", async () => {
    const corp = owned({
      userId: new ObjectId(),
      totalShares: 1_000,
      shareholders: [{ characterId: MINISTER_CHAR, shares: 10 }],
    });
    const found = await findCompetingSupplierInterest(
      stubDb({ corporations: [corp], defenceSectorCorpIds: [corp._id] }),
      {
        countryId: "US",
        ministerUserId: MINISTER_USER,
        ministerCharacterId: MINISTER_CHAR,
        excludeCorporationId: TERMINATED_CORP,
      }
    );
    expect(found).toBeNull();
  });

  it("counts a material shareholding in someone else's defence firm", async () => {
    const corp = owned({
      name: "Consolidated Ordnance",
      userId: new ObjectId(),
      totalShares: 1_000,
      shareholders: [{ characterId: MINISTER_CHAR, shares: 200 }],
    });
    const found = await findCompetingSupplierInterest(
      stubDb({ corporations: [corp], defenceSectorCorpIds: [corp._id] }),
      {
        countryId: "US",
        ministerUserId: MINISTER_USER,
        ministerCharacterId: MINISTER_CHAR,
        excludeCorporationId: TERMINATED_CORP,
      }
    );
    expect(found).toMatchObject({ basis: "shareholding", stakeShare: 0.2 });
  });

  // The disclosure should name the interest that is hardest to explain away.
  it("prefers outright ownership over a shareholding", async () => {
    const holding = owned({
      name: "Consolidated Ordnance",
      userId: new ObjectId(),
      shareholders: [{ characterId: MINISTER_CHAR, shares: 900 }],
    });
    const outright = owned({ name: "Todoroki Arms" });
    const found = await findCompetingSupplierInterest(
      stubDb({
        corporations: [holding, outright],
        defenceSectorCorpIds: [holding._id, outright._id],
      }),
      {
        countryId: "US",
        ministerUserId: MINISTER_USER,
        ministerCharacterId: MINISTER_CHAR,
        excludeCorporationId: TERMINATED_CORP,
      }
    );
    expect(found).toMatchObject({ name: "Todoroki Arms", basis: "owner" });
  });

  it("answers null for a minister with no corporate interests at all", async () => {
    const found = await findCompetingSupplierInterest(stubDb({ corporations: [] }), {
      countryId: "US",
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
      excludeCorporationId: TERMINATED_CORP,
    });
    expect(found).toBeNull();
  });

  it("does not query at all for an actor with neither identity", async () => {
    const found = await findCompetingSupplierInterest(stubDb({ corporations: [owned()] }), {
      countryId: "US",
      excludeCorporationId: TERMINATED_CORP,
    });
    expect(found).toBeNull();
  });
});
