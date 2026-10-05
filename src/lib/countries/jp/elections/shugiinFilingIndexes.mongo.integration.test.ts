/**
 * Optional real-Mongo filing race fixture, using only a generated empty local database.
 * Supply the test URI explicitly; every connected path closes the client and cleans its namespace.
 */

import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { expect, it } from "vitest";
import { ensureJapanShugiinFilingIndexes } from "./shugiinFilingIndexes";
import { isActiveJapanShugiinNominationDuplicateKey } from "@/lib/elections/duplicateKey";

const enabled = process.env.AHD_JP_SHUGIIN_REAL_MONGO === "1";

it.skipIf(!enabled)("serializes concurrent Japan mixed nomination filings", async () => {
  const uri = process.env.AHD_JP_SHUGIIN_TEST_MONGO_URI;
  if (!uri) throw new Error("Set AHD_JP_SHUGIIN_TEST_MONGO_URI for the local Mongo fixture");
  const target = new URL(uri);
  if (
    target.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Japan filing fixture requires a local Mongo server");
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const name = `ahd_sim_issue2564_jp_filing_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const db = client.db(name);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    expect(await db.listCollections().hasNext()).toBe(false);
    const candidates = db.collection("electionCandidates");
    const electionId = new ObjectId();
    await candidates.insertOne({
      electionId,
      countryId: "JP",
      characterId: "legacy-party-nominee",
      party: "8",
      constituencyId: "JP-KAN-13-01",
      status: "active",
    });
    await Promise.all([ensureJapanShugiinFilingIndexes(db), ensureJapanShugiinFilingIndexes(db)]);
    expect(
      (await candidates.findOne({ characterId: "legacy-party-nominee" }))
        ?.japanShugiinDistrictPartyKey
    ).toBe("8|JP-KAN-13-01");
    await expect(
      candidates.insertOne({
        electionId,
        countryId: "JP",
        characterId: "duplicate-legacy-party-nominee",
        party: "8",
        constituencyId: "JP-KAN-13-01",
        japanShugiinDistrictPartyKey: "8|JP-KAN-13-01",
        status: "active",
      })
    ).rejects.toMatchObject({ code: 11000 });

    await candidates.insertMany(
      ["independent-a", "independent-b"].map((characterId) => ({
        electionId,
        countryId: "JP",
        characterId,
        party: "independent",
        constituencyId: "JP-KAN-13-02",
        status: "active",
      }))
    );
    const districtRows = ["player-a", "player-b"].map((characterId) => ({
      electionId,
      countryId: "JP",
      characterId,
      party: "7",
      constituencyId: "JP-KAN-13-01",
      japanShugiinDistrictPartyKey: "7|JP-KAN-13-01",
      status: "active",
    }));
    const districtRace = await Promise.allSettled(
      districtRows.map((row) => candidates.insertOne(row))
    );
    expect(districtRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const districtRejection = districtRace.find((result) => result.status === "rejected");
    expect(districtRejection?.status).toBe("rejected");
    if (districtRejection?.status === "rejected")
      expect(isActiveJapanShugiinNominationDuplicateKey(districtRejection.reason)).toBe(true);

    const listRows = ["player-c", "player-d"].map((characterId) => ({
      electionId,
      countryId: "JP",
      characterId,
      party: "7",
      japanShugiinListOrder: 1,
      status: "active",
    }));
    const listRace = await Promise.allSettled(listRows.map((row) => candidates.insertOne(row)));
    expect(listRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const listRejection = listRace.find((result) => result.status === "rejected");
    expect(listRejection?.status).toBe("rejected");
    if (listRejection?.status === "rejected")
      expect(isActiveJapanShugiinNominationDuplicateKey(listRejection.reason)).toBe(true);
    expect(await candidates.countDocuments({})).toBe(5);
  } finally {
    try {
      if (connected) await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
});
